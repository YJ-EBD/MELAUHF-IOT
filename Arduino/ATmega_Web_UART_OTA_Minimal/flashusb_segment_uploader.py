#!/usr/bin/env python3
import argparse
import sys
import time
from pathlib import Path

import serial


def ihex_checksum(values):
    return (-sum(values)) & 0xFF


def ela_line(upper16):
    rec = [0x02, 0x00, 0x00, 0x04, (upper16 >> 8) & 0xFF, upper16 & 0xFF]
    return ":" + "".join(f"{b:02X}" for b in rec) + f"{ihex_checksum(rec):02X}"


def parse_ihex_records(path):
    base = 0
    records = []
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line:
            continue
        count = int(line[1:3], 16)
        addr = int(line[3:7], 16)
        rectype = int(line[7:9], 16)
        data = line[9:9 + count * 2]
        if rectype == 0x00:
            records.append({"abs": base + addr, "count": count, "line": line})
        elif rectype == 0x04:
            base = int(data, 16) << 16
        elif rectype == 0x02:
            base = int(data, 16) << 4
    return records


def segment_records(records, payload_cap, high_to_low):
    segments = []
    cur = []
    acc = 0
    for rec in records:
        if acc + rec["count"] > payload_cap and cur:
            segments.append(cur)
            cur = []
            acc = 0
        cur.append(rec)
        acc += rec["count"]
    if cur:
        segments.append(cur)
    if high_to_low:
        segments.reverse()
    return segments


def segment_to_lines(seg):
    lines = []
    current_upper = None
    for rec in seg:
        upper = rec["abs"] >> 16
        if upper != current_upper:
            lines.append(ela_line(upper))
            current_upper = upper
        lines.append(rec["line"])
    lines.append(":00000001FF")
    return lines


class FlashUsbUploader:
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
                    line = raw.decode("utf-8", "replace").strip("\r")
                    txt = line.strip()
                    events.append(txt)
                end = time.time() + 0.2
            else:
                time.sleep(0.005)
        return events

    def wait_for(self, predicate, timeout):
        end = time.time() + timeout
        while time.time() < end:
            events = self.read_events(0.2)
            for txt in events:
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
        self.send_cmd("flashusb")
        seen = self.wait_for(
            lambda s: "[FLASHUSB] ready:" in s or "[FLASHUSB] result=fail" in s,
            10,
        )
        if seen is None:
            raise RuntimeError("flashusb ready timeout")
        if "[FLASHUSB] result=fail" in seen:
            raise RuntimeError(f"flashusb start failed: {seen}")

    def stream_lines(self, lines):
        non_eof = lines[:-1]
        total = len(non_eof)
        sent = 0
        acked = 0
        last_progress = time.monotonic()
        fail_reason = None

        while acked < total:
            while sent < total and (sent - acked) < self.args.window_lines:
                self.ser.write((non_eof[sent] + "\n").encode())
                sent += 1
            self.ser.flush()

            events = self.read_events(0.2)
            for txt in events:
                if txt == "+":
                    acked += 1
                    continue
                if not txt:
                    continue
                if "[FLASHUSB] result=fail" in txt:
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
                raise RuntimeError(f"ack timeout after {acked}/{total} lines")

        if fail_reason:
            raise RuntimeError(fail_reason)

        self.ser.write((lines[-1] + "\n").encode())
        self.ser.flush()
        seen = self.wait_for(
            lambda s: "[FLASHUSB] result=ok" in s or "[FLASHUSB] result=fail" in s,
            20,
        )
        if seen is None:
            raise RuntimeError("eof result timeout")
        if "[FLASHUSB] result=fail" in seen:
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
    parser = argparse.ArgumentParser(description="Segmented flashusb uploader for ATmega_Web_UART_OTA_Minimal")
    parser.add_argument("--port", default="/dev/ttyACM0")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--hex", default="/home/abbas/Desktop/Arduino/build/melauhf_atmega_app/hi-aba.hex")
    parser.add_argument("--chunk", type=int, default=128)
    parser.add_argument("--session-blocks", type=int, default=48)
    parser.add_argument("--rollover-blocks", type=int, default=24)
    parser.add_argument("--gap-us", type=int, default=250)
    parser.add_argument("--settle-ms", type=int, default=400)
    parser.add_argument("--window-lines", type=int, default=64)
    parser.add_argument("--boot-wait-sec", type=float, default=10.0)
    parser.add_argument("--line-timeout-sec", type=float, default=10.0)
    parser.add_argument("--segment-delay-sec", type=float, default=1.5)
    parser.add_argument("--order", choices=["high", "low"], default="high")
    parser.add_argument("--max-segments", type=int, default=0, help="0 means all segments")
    args = parser.parse_args()

    hex_path = Path(args.hex)
    if not hex_path.exists():
        print(f"missing hex: {hex_path}", file=sys.stderr)
        return 2

    payload_cap = args.chunk * args.session_blocks
    records = parse_ihex_records(hex_path)
    segments = segment_records(records, payload_cap, args.order == "high")
    if args.max_segments > 0:
        segments = segments[:args.max_segments]
    segment_lines = [segment_to_lines(seg) for seg in segments]

    print(f"hex={hex_path}")
    print(
        f"chunk={args.chunk} gap_us={args.gap_us} "
        f"settle_ms={args.settle_ms} segment_blocks={args.session_blocks} "
        f"rollover_blocks={args.rollover_blocks} "
        f"payload_cap={payload_cap}"
    )
    for i, seg in enumerate(segments, 1):
        start = seg[0]["abs"]
        end = seg[-1]["abs"] + seg[-1]["count"] - 1
        payload = sum(r["count"] for r in seg)
        print(f"seg{i:02d}: 0x{start:05X}-0x{end:05X} payload={payload} lines={len(segment_lines[i - 1])}")

    uploader = FlashUsbUploader(args)
    try:
        uploader.drain_boot()
        uploader.apply_perf()

        overall_start = time.monotonic()
        for i, lines in enumerate(segment_lines, 1):
            seg_start = time.monotonic()
            uploader.log(f"segment {i}/{len(segment_lines)} start")
            uploader.start_segment()
            uploader.stream_lines(lines)
            uploader.log(f"segment {i}/{len(segment_lines)} ok elapsed={time.monotonic() - seg_start:.3f}s")
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
