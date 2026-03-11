"""Database layer for for_rnd_web (MySQL/MariaDB).

All DB access (connections, SQL queries, repositories) must live under this
package.
"""

from __future__ import annotations

from .mysql import MySQL, MySQLSettings

__all__ = ["MySQL", "MySQLSettings"]
