from __future__ import annotations

import os
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any, Dict


try:
    import pymysql
    import pymysql.cursors
except Exception as e:  # pragma: no cover
    pymysql = None  # type: ignore
    _IMPORT_ERR = e
else:
    _IMPORT_ERR = None


@dataclass(frozen=True)
class MySQLSettings:
    host: str
    port: int
    user: str
    password: str
    database: str
    charset: str = "utf8mb4"


class MySQL:
    """Thin MySQL/MariaDB connector wrapper.

    - Keeps DB concerns inside DB/.
    - Uses PyMySQL (pure python).
    """

    def __init__(self, settings: MySQLSettings):
        if _IMPORT_ERR is not None:
            raise RuntimeError(
                "PyMySQL is required for MySQL/MariaDB support. "
                "Install dependencies: pip install -r requirements.txt"
            ) from _IMPORT_ERR
        self._settings = settings

    @staticmethod
    def from_env() -> "MySQL":
        """Load settings from environment (settings.env via env_loader)."""
        host = (os.getenv("MYSQL_HOST") or "127.0.0.1").strip()
        port_s = (os.getenv("MYSQL_PORT") or "3306").strip()
        user = (os.getenv("MYSQL_USER") or "root").strip()
        password = os.getenv("MYSQL_PASSWORD") or ""
        database = (os.getenv("MYSQL_DATABASE") or "for_rnd").strip()
        charset = (os.getenv("MYSQL_CHARSET") or "utf8mb4").strip() or "utf8mb4"

        try:
            port = int(port_s)
        except Exception:
            port = 3306

        return MySQL(
            MySQLSettings(
                host=host,
                port=port,
                user=user,
                password=password,
                database=database,
                charset=charset,
            )
        )

    def connect(self):
        """Create a new DB connection.

        NOTE:
          - We intentionally use short-lived connections for simplicity and
            operational safety (small admin console). For bulk inserts (upload/
            migration), keep one connection per request.
        """
        assert pymysql is not None
        return pymysql.connect(
            host=self._settings.host,
            port=self._settings.port,
            user=self._settings.user,
            password=self._settings.password,
            database=self._settings.database,
            charset=self._settings.charset,
            autocommit=False,
            cursorclass=pymysql.cursors.DictCursor,
        )

    @contextmanager
    def conn(self):
        """Context manager returning a connection with automatic commit/rollback."""
        c = self.connect()
        try:
            yield c
            c.commit()
        except Exception:
            try:
                c.rollback()
            except Exception:
                pass
            raise
        finally:
            try:
                c.close()
            except Exception:
                pass

    def ping(self) -> Dict[str, Any]:
        """Best-effort connectivity check."""
        with self.conn() as c:
            with c.cursor() as cur:
                cur.execute("SELECT 1 AS ok")
                row = cur.fetchone() or {}
        return {"ok": bool(row.get("ok"))}
