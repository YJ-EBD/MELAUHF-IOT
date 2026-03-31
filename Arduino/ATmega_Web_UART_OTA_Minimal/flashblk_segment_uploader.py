#!/usr/bin/env python3
import argparse
import sys
import time
from pathlib import Path

import serial


def parse_ihex_records(path):
    base = 0
    records = []
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line[0] != ":":
            continue
        count = int(line[1:3], 16)
        addr = int(line[3:7], 16)
        rectype = int(line[7:9], 16)
        data_hex = line[9:9 + count * 2]
        if rectype == 0x00:
            records.append({"abs": base + addr, "data": bytes.fromhex(data_hex)})
        elif rectype == 0x04:
            base = int(data_hex, 16) << 16
        elif rectype == 0x02:
            base = int(data_hex, 16) << 4
    return records


def segment_records(records, payload_cap, high_to_low):
    segments = []
    cur = []
    acc = 0
    for rec in records:
        rec_len = len(rec["data"])
        if acc + rec_len > payload_cap and cur:
            segments.append(cur)
            cur = []
            acc = 0
        cur.append(rec)
        acc += rec_len
    if cur:
        segments.append(cur)
    if high_to_low:
        segments.reverse()
    return segments


def segment_to_blocks(seg, chunk):
    blocks = []
    cur_addr = None
    cur = bytearray()

    for rec in seg:
        abs_addr = rec["abs"]
        data = rec["data"]
        offset = 0
        while offset < len(data):
            if not cur:
                cur_addr = abs_addr
            elif abs_addr != cur_addr + len(cur) or len(cur) >= chunk:
                blocks.append((cur_addr, bytes(cur)))
                cur_addr = abs_addr
                cur = bytearray()

            room = chunk - len(cur)
            take = min(room, len(data) - offset)
            cur.extend(data[offset:offset + take])
            abs_addr += take
            offset += take

            if len(cur) >= chunk:
                blocks.append((cur_addr, bytes(cur)))
                cur_addr = None
                cur = bytearray()

    if cur:
        blocks.append((cur_addr, bytes(cur)))
    return blocks


class FlashBlkUploader:
    def __init__(self, args):
        self.args = args
        self.ser = serial.Serial(args.port, args.baud, timeout=0.05)
        self.ser.dtr = False
        self.ser.rts = False
        self.buf = bytearray()
        self.start = time.monotonic()

    def close(self):
        try:
            self.ser.close()
        except Exception:
            pass

    def log(self, msg):
        dt = time.monotonic() - self.start
        print(f"[{dt:8.3f}] {msg}")

    def drain_boot(self):
        self.log(f"wait boot {self.args.boot_wait_sec:.1f}s")
        time.sleep(self.args.boot_wait_sec)
        boot = bytearray()
        while self.ser.in_waiting:
            boot += self.ser.read(self.ser.in_waiting)
        if boot:
            text = boot.decode("utf-8", "replace").rstrip()
            if text:
                print(text)
        self.ser.reset_input_buffer()
        self.ser.reset_output_buffer()

    def read_events(self, timeout):
        end = time.time() + timeout
        events = []
        while time.time() < end:
            n = self.ser.in_waiting
            if n:
                self.buf.extend(self.ser.read(n))
                while b"\n" in self.buf:
                    raw, _, rest = self.buf.partition(b"\n")
                    self.buf[:] = rest
                    txt = raw.decode("utf-8", "replace").strip("\r").strip()
                    events.append(txt)
                end = time.time() + 0.2
            else:
                time.sleep(0.005)
        return events

    def wait_for(self, predicate, timeout):
        end = time.time() + timeout
        while time.time() < end:
            for txt in self.read_events(0.2):
                if not txt:
                    continue
                if txt != "+":
                    self.log(txt)
                if predicate(txt):
                    return txt
        return None

    def send_cmd(self, cmd):
        self.ser.write((cmd + "\n").encode())
        self.ser.flush()

    def apply_perf(self):
        for cmd in [
            "perf reset",
            f"perf gap {self.args.gap_us}",
            "perf inter 0",
            f"perf settle {self.args.settle_ms}",
            f"perf session {self.args.rollover_blocks}",
            f"perf chunk {self.args.chunk}",
        ]:
            self.send_cmd(cmd)
            seen = self.wait_for(lambda s: s.startswith("[PERF]"), 5)
            if seen is None:
                raise RuntimeError(f"perf command timed out: {cmd}")

    def start_segment(self):
        self.send_cmd("flashblk")
        seen = self.wait_for(
            lambda s: "[FLASHBLK] ready:" in s or "[FLASHBLK] result=fail" in s,
            10,
        )
        if seen is None:
            raise RuntimeError("flashblk ready timeout")
        if "[FLASHBLK] result=fail" in seen:
            raise RuntimeError(f"flashblk start failed: {seen}")

    def stream_blocks(self, blocks):
        total = len(blocks)
        sent = 0
        acked = 0
        fail_reason = None
        last_progress = time.monotonic()

        while acked < total:
            while sent < total and (sent - acked) < self.args.window_blocks:
                addr, data = blocks[sent]
                line = f"@{addr:05X}|{data.hex().upper()}\n"
                self.ser.write(line.encode())
                sent += 1
            self.ser.flush()

            events = self.read_events(0.2)
            for txt in events:
                if txt == "+":
                    acked += 1
                    continue
                if not txt:
                    continue
                if "[FLASHBLK] result=fail" in txt:
                    fail_reason = txt
                    break
                self.log(txt)
            if fail_reason:
                break

            now = time.monotonic()
            if now - last_progress >= 1.0:
                self.log(f"ack {acked}/{total}")
                last_progress = now

            if not events and (now - last_progress) > self.args.line_timeout_sec:
                raise RuntimeError(f"ack timeout after {acked}/{total} blocks")

        if fail_reason:
            raise RuntimeError(fail_reason)

        self.send_cmd("!EOF")
        seen = self.wait_for(
            lambda s: "[FLASHBLK] result=ok" in s or "[FLASHBLK] result=fail" in s,
            30,
        )
        if seen is None:
            raise RuntimeError("eof result timeout")
        if "[FLASHBLK] result=fail" in seen:
            raise RuntimeError(seen)

    def run_health_checks(self):
        for cmd, tag, timeout in [
            ("ping", "[PING]", 5),
            ("probe", "[PROBE]", 15),
            ("peek 245000 200 1200", "[PEEK]", 15),
        ]:
            self.send_cmd(cmd)
            seen = self.wait_for(lambda s, tag=tag: tag in s, timeout)
            if seen is None:
                raise RuntimeError(f"health check timeout: {cmd}")


def main():
    parser = argparse.ArgumentParser(description="Segmented flashblk uploader for ATmega_Web_UART_OTA_Minimal")
    parser.add_argument("--port", default="/dev/ttyACM0")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--hex", default="/home/abbas/Desktop/Arduino/build/melauhf_atmega_app/hi-aba.hex")
    parser.add_argument("--chunk", type=int, default=256)
    parser.add_argument("--segment-blocks", type=int, default=12)
    parser.add_argument("--rollover-blocks", type=int, default=65535)
    parser.add_argument("--gap-us", type=int, default=250)
    parser.add_argument("--settle-ms", type=int, default=100)
    parser.add_argument("--window-blocks", type=int, default=6)
    parser.add_argument("--boot-wait-sec", type=float, default=10.0)
    parser.add_argument("--line-timeout-sec", type=float, default=10.0)
    parser.add_argument("--segment-delay-sec", type=float, default=1.0)
    parser.add_argument("--start-retries", type=int, default=3)
    parser.add_argument("--start-retry-delay-sec", type=float, default=1.5)
    parser.add_argument("--order", choices=["high", "low"], default="high")
    parser.add_argument("--block-order", choices=["low", "high"], default="low")
    parser.add_argument("--max-segments", type=int, default=0, help="0 means all segments")
    parser.add_argument("--skip-segments", type=int, default=0)
    args = parser.parse_args()

    hex_path = Path(args.hex)
    if not hex_path.exists():
        print(f"missing hex: {hex_path}", file=sys.stderr)
        return 2

    payload_cap = args.chunk * args.segment_blocks
    records = parse_ihex_records(hex_path)
    segments = segment_records(records, payload_cap, args.order == "high")
    if args.skip_segments > 0:
        segments = segments[args.skip_segments:]
    if args.max_segments > 0:
        segments = segments[:args.max_segments]
    segment_blocks = []
    for seg in segments:
        blocks = segment_to_blocks(seg, args.chunk)
        if args.block_order == "high":
            blocks.reverse()
        segment_blocks.append(blocks)

    print(f"hex={hex_path}")
    print(
        f"chunk={args.chunk} gap_us={args.gap_us} settle_ms={args.settle_ms} "
        f"segment_blocks={args.segment_blocks} rollover_blocks={args.rollover_blocks} "
        f"payload_cap={payload_cap} block_order={args.block_order}"
    )
    for i, seg in enumerate(segments, 1):
        start = seg[0]["abs"]
        end = seg[-1]["abs"] + len(seg[-1]["data"]) - 1
        payload = sum(len(r["data"]) for r in seg)
        print(f"seg{i:02d}: 0x{start:05X}-0x{end:05X} payload={payload} blocks={len(segment_blocks[i - 1])}")

    uploader = FlashBlkUploader(args)
    try:
        uploader.drain_boot()
        uploader.apply_perf()

        overall_start = time.monotonic()
        for i, blocks in enumerate(segment_blocks, 1):
            seg_start = time.monotonic()
            uploader.log(f"segment {i}/{len(segment_blocks)} start")
            last_start_exc = None
            for attempt in range(1, max(1, args.start_retries) + 1):
                try:
                    uploader.start_segment()
                    last_start_exc = None
                    break
                except Exception as exc:
                    last_start_exc = exc
                    if attempt >= max(1, args.start_retries):
                        raise
                    uploader.log(
                        f"segment {i}/{len(segment_blocks)} start retry "
                        f"{attempt}/{max(1, args.start_retries)} reason={exc}"
                    )
                    time.sleep(args.start_retry_delay_sec)
            if last_start_exc is not None:
                raise last_start_exc
            uploader.stream_blocks(blocks)
            uploader.log(f"segment {i}/{len(segment_blocks)} ok elapsed={time.monotonic() - seg_start:.3f}s")
            time.sleep(args.segment_delay_sec)

        total = time.monotonic() - overall_start
        uploader.log(f"all segments ok total={total:.3f}s")
        uploader.run_health_checks()
        return 0
    except Exception as exc:
        uploader.log(f"upload failed: {exc}")
        return 1
    finally:
        uploader.close()


if __name__ == "__main__":
    sys.exit(main())
