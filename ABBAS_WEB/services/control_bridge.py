from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Awaitable, Callable, Optional


LogCallback = Callable[[str], Awaitable[None]]


@dataclass
class ControlBridgeConfig:
    ip: str
    port: int = 5000
    connect_timeout_sec: float = 5.0
    read_chunk_size: int = 4096


class ControlBridge:
    """TCP 기반 디바이스 콘솔 브릿지.

    - connect(): TCP 연결
    - send_line(): 명령 전송 (Arduino Serial Monitor와 동일하게 CRLF(\r\n) 사용)
    - start_reader(): 수신 로그를 callback으로 전달
    - close(): 종료

    NOTE
    ----
    사용자가 Arduino IDE 시리얼 모니터에서 `ping`, `page1` 등을 입력할 때
    라인 종결자가 CRLF(\r\n)로 설정되는 경우가 흔합니다.

    펌웨어가 '\r' 기반으로 명령을 파싱하면 '\n'만 보냈을 때 일부 명령이
    정상 인식되지 않을 수 있어, 웹 콘솔도 동일하게 CRLF로 맞춥니다.
    """

    def __init__(self, cfg: ControlBridgeConfig):
        self.cfg = cfg
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._closing = False

    @property
    def connected(self) -> bool:
        return self._writer is not None and not self._writer.is_closing()

    async def connect(self) -> None:
        if self.connected:
            return
        self._closing = False
        try:
            coro = asyncio.open_connection(self.cfg.ip, self.cfg.port)
            self._reader, self._writer = await asyncio.wait_for(
                coro, timeout=self.cfg.connect_timeout_sec
            )
        except Exception:
            self._reader = None
            self._writer = None
            raise

    async def send_line(self, line: str) -> None:
        if not self.connected or self._writer is None:
            raise RuntimeError("not connected")

        # IMPORTANT: Use CRLF to match Arduino Serial Monitor (Both NL & CR)
        data = (line.rstrip("\r\n") + "\r\n").encode("utf-8", errors="replace")
        self._writer.write(data)
        await self._writer.drain()

    async def start_reader(self, on_log: LogCallback) -> None:
        if self._reader_task and not self._reader_task.done():
            return
        if not self._reader:
            raise RuntimeError("reader not ready")
        self._reader_task = asyncio.create_task(self._run_reader(on_log))

    async def _run_reader(self, on_log: LogCallback) -> None:
        assert self._reader is not None
        buf = b""
        try:
            while not self._closing:
                chunk = await self._reader.read(self.cfg.read_chunk_size)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    try:
                        text = line.decode("utf-8", errors="replace").rstrip("\r")
                    except Exception:
                        text = str(line)
                    if text:
                        await on_log(text)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            try:
                await on_log(f"[TCP] read error: {e}")
            except Exception:
                pass

    async def close(self) -> None:
        self._closing = True
        try:
            if self._reader_task and not self._reader_task.done():
                self._reader_task.cancel()
        except Exception:
            pass

        try:
            if self._writer:
                self._writer.close()
                try:
                    await self._writer.wait_closed()
                except Exception:
                    pass
        finally:
            self._reader = None
            self._writer = None
            self._reader_task = None
