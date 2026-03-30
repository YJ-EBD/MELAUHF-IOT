#!/usr/bin/env python3
import argparse
from pathlib import Path


def parse_ihex(path: Path) -> dict[int, int]:
    data: dict[int, int] = {}
    upper = 0
    segment = 0

    for lineno, raw in enumerate(path.read_text().splitlines(), start=1):
      line = raw.strip()
      if not line:
        continue
      if not line.startswith(":"):
        raise ValueError(f"{path}:{lineno}: missing ':'")

      count = int(line[1:3], 16)
      addr = int(line[3:7], 16)
      rectype = int(line[7:9], 16)
      payload = bytes.fromhex(line[9:9 + count * 2])
      checksum = int(line[9 + count * 2:11 + count * 2], 16)

      total = count + (addr >> 8) + (addr & 0xFF) + rectype + sum(payload) + checksum
      if (total & 0xFF) != 0:
        raise ValueError(f"{path}:{lineno}: checksum mismatch")

      if rectype == 0x00:
        base = upper + segment + addr
        for index, value in enumerate(payload):
          absolute = base + index
          existing = data.get(absolute)
          if existing is not None and existing != value:
            raise ValueError(f"{path}:{lineno}: overlap at 0x{absolute:05X}")
          data[absolute] = value
      elif rectype == 0x01:
        break
      elif rectype == 0x02:
        segment = int.from_bytes(payload, "big") << 4
        upper = 0
      elif rectype == 0x04:
        upper = int.from_bytes(payload, "big") << 16
        segment = 0
      elif rectype in (0x03, 0x05):
        continue
      else:
        raise ValueError(f"{path}:{lineno}: unsupported record type {rectype:02X}")

    return data


def emit_record(count: int, addr: int, rectype: int, payload: bytes) -> str:
    total = count + (addr >> 8) + (addr & 0xFF) + rectype + sum(payload)
    checksum = (-total) & 0xFF
    return ":" + f"{count:02X}{addr:04X}{rectype:02X}" + payload.hex().upper() + f"{checksum:02X}"


def write_ihex(path: Path, merged: dict[int, int]) -> None:
    lines: list[str] = []
    current_upper = None
    addresses = sorted(merged)
    index = 0

    while index < len(addresses):
      start = addresses[index]
      upper = start >> 16
      if upper != current_upper:
        current_upper = upper
        lines.append(emit_record(2, 0, 0x04, upper.to_bytes(2, "big")))

      chunk = bytearray()
      base = start & 0xFFFF
      while index < len(addresses):
        address = addresses[index]
        if (address >> 16) != current_upper:
          break
        if len(chunk) >= 16:
          break
        expected = start + len(chunk)
        if address != expected:
          break
        chunk.append(merged[address])
        index += 1

      lines.append(emit_record(len(chunk), base, 0x00, bytes(chunk)))

    lines.append(":00000001FF")
    path.write_text("\n".join(lines) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Merge non-overlapping Intel HEX files.")
    parser.add_argument("inputs", nargs="+", help="input Intel HEX files")
    parser.add_argument("-o", "--output", required=True, help="output Intel HEX file")
    args = parser.parse_args()

    merged: dict[int, int] = {}
    for input_name in args.inputs:
      path = Path(input_name)
      for address, value in parse_ihex(path).items():
        existing = merged.get(address)
        if existing is not None and existing != value:
          raise ValueError(f"overlap at 0x{address:05X} while merging {path}")
        merged[address] = value

    write_ihex(Path(args.output), merged)


if __name__ == "__main__":
    main()
