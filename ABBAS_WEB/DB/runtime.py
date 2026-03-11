from __future__ import annotations

from typing import Optional

from .mysql import MySQL


_MYSQL: Optional[MySQL] = None


def get_mysql() -> MySQL:
    """Lazily create a MySQL connector from env.

    The env is loaded by core.env_loader at application startup.
    """
    global _MYSQL
    if _MYSQL is None:
        _MYSQL = MySQL.from_env()
    return _MYSQL
