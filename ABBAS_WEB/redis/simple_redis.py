from __future__ import annotations

import os
import socket
import threading
from dataclasses import dataclass
from typing import Any, Optional


class RedisError(RuntimeError):
    """Minimal Redis client error."""


@dataclass
class RedisConfig:
    host: str = "127.0.0.1"
    port: int = 6379
    db: int = 0
    password: str = ""
    timeout_sec: float = 2.5


def config_from_env() -> RedisConfig:
    """Load Redis connection settings from environment variables."""
    host = os.getenv("REDIS_HOST", "127.0.0.1")
    port = int(os.getenv("REDIS_PORT", "6379"))
    db = int(os.getenv("REDIS_DB", "0"))
    password = os.getenv("REDIS_PASSWORD", "")
    timeout_sec = float(os.getenv("REDIS_TIMEOUT_SEC", "2.5"))
    return RedisConfig(host=host, port=port, db=db, password=password, timeout_sec=timeout_sec)


def _to_bytes(v: Any) -> bytes:
    if v is None:
        return b""
    if isinstance(v, bytes):
        return v
    if isinstance(v, (int, float)):
        return str(v).encode("utf-8")
    return str(v).encode("utf-8")


def _encode_command(parts: list[Any]) -> bytes:
    # RESP: *<n>\r\n $<len>\r\n<data>\r\n ...
    out = [f"*{len(parts)}\r\n".encode("utf-8")]
    for p in parts:
        b = _to_bytes(p)
        out.append(f"${len(b)}\r\n".encode("utf-8"))
        out.append(b)
        out.append(b"\r\n")
    return b"".join(out)


def _strip_crlf(line: bytes) -> bytes:
    if line.endswith(b"\r\n"):
        return line[:-2]
    if line.endswith(b"\n"):
        return line[:-1]
    return line


class SimpleRedis:
    """Very small synchronous Redis client.

    Implemented operations:
    - GET, SET, SETEX, DEL, EXISTS, PING, EXPIRE, SCAN

    This is intentionally minimal to satisfy the project constraint
    (redis/ directory 구현 + 최소 변경 원칙) without adding heavy deps.
    """

    def __init__(self, config: Optional[RedisConfig] = None):
        self.cfg = config or config_from_env()
        self._sock: Optional[socket.socket] = None
        self._file = None
        self._lock = threading.Lock()

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _close_locked(self) -> None:
        try:
            if self._file is not None:
                try:
                    self._file.close()
                except Exception:
                    pass
        finally:
            self._file = None

        try:
            if self._sock is not None:
                try:
                    self._sock.close()
                except Exception:
                    pass
        finally:
            self._sock = None

    def _connect_locked(self) -> None:
        self._close_locked()

        try:
            sock = socket.create_connection((self.cfg.host, self.cfg.port), timeout=self.cfg.timeout_sec)
            sock.settimeout(self.cfg.timeout_sec)
            self._sock = sock
            self._file = sock.makefile("rb")
        except Exception as e:
            self._close_locked()
            raise RedisError(f"redis connect failed: {e}")

        # AUTH / SELECT
        try:
            # AUTH (if required)
            if self.cfg.password:
                r = self._execute_no_retry_locked(["AUTH", self.cfg.password])
                if str(r).upper() != "OK":
                    raise RedisError(f"redis AUTH failed: {r!r}")

            # SELECT DB (optional)
            if int(self.cfg.db or 0) != 0:
                r = self._execute_no_retry_locked(["SELECT", str(int(self.cfg.db))])
                if str(r).upper() != "OK":
                    raise RedisError(f"redis SELECT failed: {r!r}")
        except RedisError:
            # Bubble up RedisError as-is
            raise
        except Exception as e:
            raise RedisError(f"redis AUTH/SELECT failed: {e}")
    def _read_line_locked(self) -> bytes:
        if self._file is None:
            raise RedisError("redis not connected")
        line = self._file.readline()
        if not line:
            raise RedisError("redis connection closed")
        return _strip_crlf(line)

    def _read_exact_locked(self, n: int) -> bytes:
        if self._file is None:
            raise RedisError("redis not connected")
        data = self._file.read(n)
        if data is None or len(data) != n:
            raise RedisError("redis short read")
        return data

    def _parse_reply_locked(self) -> Any:
        line = self._read_line_locked()
        if not line:
            raise RedisError("empty reply")
        prefix = line[:1]
        payload = line[1:]

        if prefix == b"+":
            return payload.decode("utf-8", errors="replace")
        if prefix == b"-":
            raise RedisError(payload.decode("utf-8", errors="replace"))
        if prefix == b":":
            try:
                return int(payload)
            except Exception:
                return 0
        if prefix == b"$":
            try:
                length = int(payload)
            except Exception:
                raise RedisError("invalid bulk length")
            if length == -1:
                return None
            data = self._read_exact_locked(length)
            # consume CRLF
            _ = self._read_exact_locked(2)
            return data
        if prefix == b"*":
            try:
                count = int(payload)
            except Exception:
                raise RedisError("invalid array length")
            if count == -1:
                return None
            arr = []
            for _ in range(count):
                arr.append(self._parse_reply_locked())
            return arr

        raise RedisError("unknown reply prefix")

    def _execute_no_retry_locked(self, parts: list[Any]) -> Any:
        if self._sock is None or self._file is None:
            self._connect_locked()

        assert self._sock is not None

        data = _encode_command(parts)
        try:
            self._sock.sendall(data)
            return self._parse_reply_locked()
        except RedisError:
            raise
        except Exception as e:
            raise RedisError(f"redis command failed: {e}")

    def execute(self, *parts: Any) -> Any:
        with self._lock:
            try:
                return self._execute_no_retry_locked(list(parts))
            except RedisError:
                # 1회 재연결 후 재시도
                try:
                    self._connect_locked()
                    return self._execute_no_retry_locked(list(parts))
                except Exception:
                    raise

    # -------------- Convenience APIs --------------
    def ping(self) -> bool:
        try:
            r = self.execute("PING")
            return str(r).upper() == "PONG"
        except Exception:
            return False

    def get(self, key: str) -> Optional[bytes]:
        v = self.execute("GET", key)
        if v is None:
            return None
        if isinstance(v, bytes):
            return v
        return _to_bytes(v)

    def get_str(self, key: str) -> Optional[str]:
        b = self.get(key)
        if b is None:
            return None
        try:
            return b.decode("utf-8")
        except Exception:
            return b.decode("utf-8", errors="replace")

    def set(self, key: str, value: str, ex: int | None = None) -> bool:
        if ex is not None:
            r = self.execute("SET", key, value, "EX", int(ex))
        else:
            r = self.execute("SET", key, value)
        return str(r).upper() == "OK"

    def setex(self, key: str, seconds: int, value: str) -> bool:
        r = self.execute("SETEX", key, int(seconds), value)
        return str(r).upper() == "OK"

    def delete(self, *keys: str) -> int:
        if not keys:
            return 0
        r = self.execute("DEL", *list(keys))
        try:
            return int(r)
        except Exception:
            return 0

    def expire(self, key: str, seconds: int) -> bool:
        """Set TTL (seconds) for a key."""
        r = self.execute("EXPIRE", key, int(seconds))
        try:
            return int(r) == 1
        except Exception:
            return False

    def scan(self, cursor: int = 0, *, match: str | None = None, count: int = 200) -> tuple[int, list[str]]:
        """Run SCAN and return (next_cursor, keys)."""
        parts: list[Any] = ["SCAN", int(cursor)]
        if match:
            parts += ["MATCH", match]
        if count:
            parts += ["COUNT", int(count)]
        r = self.execute(*parts)

        # Expected reply: [b'<cursor>', [b'k1', b'k2', ...]]
        if not isinstance(r, list) or len(r) != 2:
            return 0, []

        cur_raw, keys_raw = r[0], r[1]
        try:
            if isinstance(cur_raw, bytes):
                next_cursor = int(cur_raw.decode("utf-8", errors="replace") or "0")
            else:
                next_cursor = int(cur_raw)
        except Exception:
            next_cursor = 0

        keys: list[str] = []
        if isinstance(keys_raw, list):
            for k in keys_raw:
                if k is None:
                    continue
                if isinstance(k, bytes):
                    keys.append(k.decode("utf-8", errors="replace"))
                else:
                    keys.append(str(k))

        return next_cursor, keys

    def scan_iter(self, match: str, *, count: int = 200):
        """Yield keys matching a pattern using SCAN."""
        cursor = 0
        while True:
            cursor, keys = self.scan(cursor, match=match, count=count)
            for k in keys:
                yield k
            if cursor == 0:
                break

    def exists(self, key: str) -> bool:
        r = self.execute("EXISTS", key)
        try:
            return int(r) > 0
        except Exception:
            return False
