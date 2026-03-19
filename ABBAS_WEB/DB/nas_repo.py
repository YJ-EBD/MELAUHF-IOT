from __future__ import annotations

import hashlib
from typing import Any, Dict, Iterable, List

from .runtime import get_mysql


_SCHEMA_READY = False


def _normalize_rel_path(value: Any) -> str:
    return str(value or "").strip()


def _normalize_rel_paths(values: Iterable[Any]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values or []:
        rel_path = _normalize_rel_path(value)
        if (not rel_path) or (rel_path in seen):
            continue
        seen.add(rel_path)
        normalized.append(rel_path)
    return normalized


def _path_hash(rel_path: str) -> str:
    return hashlib.sha256(_normalize_rel_path(rel_path).encode("utf-8")).hexdigest()


def _like_prefix_pattern(rel_path: str) -> str:
    escaped = rel_path.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"{escaped}/%"


def _ensure_schema_with_cur(cur) -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS nas_item_uploaders (
          rel_path_hash CHAR(64) NOT NULL,
          rel_path TEXT NOT NULL,
          user_id VARCHAR(64) NOT NULL DEFAULT '',
          nickname VARCHAR(255) NOT NULL DEFAULT '',
          name VARCHAR(255) NOT NULL DEFAULT '',
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (rel_path_hash),
          KEY idx_nas_item_uploaders_user (user_id),
          KEY idx_nas_item_uploaders_updated (updated_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    _SCHEMA_READY = True


def ensure_schema() -> None:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)


def _rows_by_prefix_with_cur(cur, rel_path: str) -> list[dict[str, Any]]:
    normalized_path = _normalize_rel_path(rel_path)
    if (not normalized_path) or normalized_path == "/":
        return []

    cur.execute(
        """
        SELECT
          rel_path,
          COALESCE(user_id, '') AS user_id,
          COALESCE(nickname, '') AS nickname,
          COALESCE(name, '') AS name,
          DATE_FORMAT(updated_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS updated_at
        FROM nas_item_uploaders
        WHERE rel_path=%s
           OR rel_path LIKE %s ESCAPE '\\\\'
        """,
        (normalized_path, _like_prefix_pattern(normalized_path)),
    )
    return cur.fetchall() or []


def get_uploader_rows(rel_paths: Iterable[Any]) -> dict[str, dict[str, Any]]:
    normalized_paths = _normalize_rel_paths(rel_paths)
    if not normalized_paths:
        return {}

    hashes = [_path_hash(rel_path) for rel_path in normalized_paths]
    placeholders = ", ".join(["%s"] * len(hashes))
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                f"""
                SELECT
                  rel_path,
                  COALESCE(user_id, '') AS user_id,
                  COALESCE(nickname, '') AS nickname,
                  COALESCE(name, '') AS name,
                  DATE_FORMAT(updated_at, '%%Y-%%m-%%d %%H:%%i:%%s') AS updated_at
                FROM nas_item_uploaders
                WHERE rel_path_hash IN ({placeholders})
                """,
                tuple(hashes),
            )
            rows = cur.fetchall() or []

    allowed_paths = set(normalized_paths)
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        rel_path = _normalize_rel_path(row.get("rel_path"))
        if rel_path not in allowed_paths:
            continue
        result[rel_path] = {
            "rel_path": rel_path,
            "user_id": _normalize_rel_path(row.get("user_id")),
            "nickname": _normalize_rel_path(row.get("nickname")),
            "name": _normalize_rel_path(row.get("name")),
            "updated_at": _normalize_rel_path(row.get("updated_at")),
        }
    return result


def upsert_uploader_rows(rows: Iterable[dict[str, Any]]) -> int:
    normalized_rows: dict[str, tuple[str, str, str, str, str]] = {}
    for row in rows or []:
        rel_path = _normalize_rel_path((row or {}).get("rel_path"))
        if not rel_path:
            continue
        normalized_rows[rel_path] = (
            _path_hash(rel_path),
            rel_path,
            _normalize_rel_path((row or {}).get("user_id")),
            _normalize_rel_path((row or {}).get("nickname")),
            _normalize_rel_path((row or {}).get("name")),
        )

    if not normalized_rows:
        return 0

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.executemany(
                """
                INSERT INTO nas_item_uploaders (
                  rel_path_hash, rel_path, user_id, nickname, name, updated_at, created_at
                )
                VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                  rel_path=VALUES(rel_path),
                  user_id=VALUES(user_id),
                  nickname=VALUES(nickname),
                  name=VALUES(name),
                  updated_at=NOW()
                """,
                list(normalized_rows.values()),
            )
    return len(normalized_rows)


def delete_uploader_prefix(rel_path: str) -> int:
    normalized_path = _normalize_rel_path(rel_path)
    if (not normalized_path) or normalized_path == "/":
        return 0

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                DELETE FROM nas_item_uploaders
                WHERE rel_path=%s
                   OR rel_path LIKE %s ESCAPE '\\\\'
                """,
                (normalized_path, _like_prefix_pattern(normalized_path)),
            )
            return int(cur.rowcount or 0)


def remap_uploader_prefix(old_rel_path: str, new_rel_path: str) -> int:
    source_path = _normalize_rel_path(old_rel_path)
    target_path = _normalize_rel_path(new_rel_path)
    if (not source_path) or source_path == "/" or (not target_path) or source_path == target_path:
        return 0

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            rows = _rows_by_prefix_with_cur(cur, source_path)
            if not rows:
                return 0

            next_rows: list[tuple[str, str, str, str, str]] = []
            for row in rows:
                current_path = _normalize_rel_path(row.get("rel_path"))
                if not current_path:
                    continue
                suffix = current_path[len(source_path):]
                next_path = (target_path.rstrip("/") + suffix) if target_path != "/" else (suffix or "/")
                next_path = _normalize_rel_path(next_path)
                if not next_path:
                    continue
                next_rows.append(
                    (
                        _path_hash(next_path),
                        next_path,
                        _normalize_rel_path(row.get("user_id")),
                        _normalize_rel_path(row.get("nickname")),
                        _normalize_rel_path(row.get("name")),
                    )
                )

            if next_rows:
                cur.executemany(
                    """
                    INSERT INTO nas_item_uploaders (
                      rel_path_hash, rel_path, user_id, nickname, name, updated_at, created_at
                    )
                    VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
                    ON DUPLICATE KEY UPDATE
                      rel_path=VALUES(rel_path),
                      user_id=VALUES(user_id),
                      nickname=VALUES(nickname),
                      name=VALUES(name),
                      updated_at=NOW()
                    """,
                    next_rows,
                )

            old_hashes = [(_path_hash(_normalize_rel_path(row.get("rel_path"))),) for row in rows if _normalize_rel_path(row.get("rel_path"))]
            if old_hashes:
                cur.executemany("DELETE FROM nas_item_uploaders WHERE rel_path_hash=%s", old_hashes)
            return len(next_rows)


def anonymize_uploader_user(user_id: str, fallback_nickname: str = "") -> int:
    uid = _normalize_rel_path(user_id)
    if not uid:
        return 0

    nickname = _normalize_rel_path(fallback_nickname)
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                UPDATE nas_item_uploaders
                SET user_id='-',
                    nickname=CASE
                        WHEN TRIM(COALESCE(nickname, ''))='' THEN %s
                        ELSE nickname
                    END,
                    name='',
                    updated_at=NOW()
                WHERE user_id=%s
                """,
                (nickname, uid),
            )
            return int(cur.rowcount or 0)
