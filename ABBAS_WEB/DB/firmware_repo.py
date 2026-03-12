from __future__ import annotations

from datetime import datetime
import os
from typing import Any, Dict, List, Optional

from .runtime import get_mysql


_SCHEMA_READY = False


def _norm_device_id(v: str) -> str:
    s = (v or "").strip().lower()
    if not s:
        return ""
    hex_only = "".join(ch for ch in s if ch in "0123456789abcdef")
    if len(hex_only) == 12:
        return ":".join(hex_only[i : i + 2] for i in range(0, 12, 2))
    return s


def _dt_text(v: Any) -> str:
    if isinstance(v, datetime):
        return v.strftime("%Y-%m-%d %H:%M:%S")
    s = str(v or "").strip()
    return s


def _ensure_schema_with_cur(cur) -> None:
    global _SCHEMA_READY
    if _SCHEMA_READY:
        return

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS firmware_releases (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          family VARCHAR(64) NOT NULL,
          version VARCHAR(64) NOT NULL,
          build_id VARCHAR(64) NOT NULL DEFAULT '',
          filename VARCHAR(255) NOT NULL,
          stored_name VARCHAR(255) NOT NULL,
          file_path VARCHAR(512) NOT NULL,
          sha256 CHAR(64) NOT NULL,
          size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
          notes TEXT NULL,
          uploaded_by VARCHAR(64) NULL,
          force_update TINYINT(1) NOT NULL DEFAULT 0,
          is_enabled TINYINT(1) NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uq_firmware_releases_identity (family, version, build_id),
          KEY idx_firmware_releases_family (family, is_enabled, id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS device_firmware_state (
          device_id VARCHAR(64) NOT NULL,
          customer VARCHAR(128) NOT NULL DEFAULT '-',
          device_name VARCHAR(255) NOT NULL DEFAULT '',
          last_seen_ip VARCHAR(45) NOT NULL DEFAULT '',
          current_family VARCHAR(64) NOT NULL DEFAULT '',
          current_version VARCHAR(64) NOT NULL DEFAULT '',
          current_build_id VARCHAR(64) NOT NULL DEFAULT '',
          current_fw_text VARCHAR(128) NOT NULL DEFAULT '',
          target_release_id BIGINT UNSIGNED NULL,
          target_assigned_by VARCHAR(64) NULL,
          target_assigned_at DATETIME NULL,
          ota_state VARCHAR(24) NOT NULL DEFAULT 'idle',
          ota_message TEXT NULL,
          last_check_at DATETIME NULL,
          last_report_at DATETIME NULL,
          last_result_ok TINYINT(1) NULL,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (device_id),
          KEY idx_device_firmware_target (target_release_id),
          KEY idx_device_firmware_state (ota_state)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """
    )
    _SCHEMA_READY = True


def ensure_schema() -> None:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)


def _shape_release_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not row:
        return None
    return {
        "id": int(row.get("id") or 0),
        "family": str(row.get("family") or "").strip(),
        "version": str(row.get("version") or "").strip(),
        "build_id": str(row.get("build_id") or "").strip(),
        "filename": str(row.get("filename") or "").strip(),
        "stored_name": str(row.get("stored_name") or "").strip(),
        "file_path": str(row.get("file_path") or "").strip(),
        "sha256": str(row.get("sha256") or "").strip().lower(),
        "size_bytes": int(row.get("size_bytes") or 0),
        "notes": str(row.get("notes") or "").strip(),
        "uploaded_by": str(row.get("uploaded_by") or "").strip(),
        "force_update": bool(row.get("force_update")),
        "is_enabled": bool(row.get("is_enabled")),
        "created_at": _dt_text(row.get("created_at")),
        "updated_at": _dt_text(row.get("updated_at")),
    }


def list_releases(*, family: str = "") -> List[Dict[str, Any]]:
    family = (family or "").strip()
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            if family:
                cur.execute(
                    """
                    SELECT
                      id, family, version, build_id, filename, stored_name, file_path,
                      sha256, size_bytes, notes, uploaded_by, force_update, is_enabled,
                      created_at, updated_at
                    FROM firmware_releases
                    WHERE family=%s
                    ORDER BY created_at DESC, id DESC
                    """,
                    (family,),
                )
            else:
                cur.execute(
                    """
                    SELECT
                      id, family, version, build_id, filename, stored_name, file_path,
                      sha256, size_bytes, notes, uploaded_by, force_update, is_enabled,
                      created_at, updated_at
                    FROM firmware_releases
                    ORDER BY created_at DESC, id DESC
                    """
                )
            return [_shape_release_row(row) for row in (cur.fetchall() or []) if row]


def get_release_by_id(release_id: int) -> Optional[Dict[str, Any]]:
    try:
        rid = int(release_id)
    except Exception:
        return None
    if rid <= 0:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  id, family, version, build_id, filename, stored_name, file_path,
                  sha256, size_bytes, notes, uploaded_by, force_update, is_enabled,
                  created_at, updated_at
                FROM firmware_releases
                WHERE id=%s
                LIMIT 1
                """,
                (rid,),
            )
            return _shape_release_row(cur.fetchone())


def create_release(
    *,
    family: str,
    version: str,
    build_id: str,
    filename: str,
    stored_name: str,
    file_path: str,
    sha256: str,
    size_bytes: int,
    notes: str = "",
    uploaded_by: str = "",
    force_update: bool = False,
) -> Dict[str, Any]:
    family = (family or "").strip()
    version = (version or "").strip()
    build_id = (build_id or "").strip()
    filename = (filename or "").strip()
    stored_name = (stored_name or "").strip()
    file_path = (file_path or "").strip()
    sha256 = (sha256 or "").strip().lower()
    notes = (notes or "").strip()
    uploaded_by = (uploaded_by or "").strip()

    if not family:
        raise ValueError("family required")
    if not version:
        raise ValueError("version required")
    if not filename or not stored_name or not file_path:
        raise ValueError("firmware file metadata required")
    if len(sha256) != 64:
        raise ValueError("sha256 required")
    try:
        size_value = int(size_bytes)
    except Exception as exc:
        raise ValueError("invalid size_bytes") from exc
    if size_value <= 0:
        raise ValueError("size_bytes required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT id
                FROM firmware_releases
                WHERE family=%s AND version=%s AND build_id=%s
                LIMIT 1
                """,
                (family, version, build_id),
            )
            exists = cur.fetchone()
            if exists:
                raise ValueError("release already exists")

            cur.execute(
                """
                INSERT INTO firmware_releases (
                  family, version, build_id, filename, stored_name, file_path,
                  sha256, size_bytes, notes, uploaded_by, force_update, is_enabled
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 1)
                """,
                (
                    family,
                    version,
                    build_id,
                    filename,
                    stored_name,
                    file_path,
                    sha256,
                    size_value,
                    notes or None,
                    uploaded_by or None,
                    1 if force_update else 0,
                ),
            )
            rid = int(cur.lastrowid)
            cur.execute(
                """
                SELECT
                  id, family, version, build_id, filename, stored_name, file_path,
                  sha256, size_bytes, notes, uploaded_by, force_update, is_enabled,
                  created_at, updated_at
                FROM firmware_releases
                WHERE id=%s
                LIMIT 1
                """,
                (rid,),
            )
            row = cur.fetchone()
            shaped = _shape_release_row(row)
            if not shaped:
                raise ValueError("release insert failed")
            return shaped


def list_device_rows() -> List[Dict[str, Any]]:
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  COALESCE(d.device_id, s.device_id, '') AS device_id,
                  COALESCE(d.name, s.device_name, '') AS device_name,
                  COALESCE(d.customer, s.customer, '-') AS customer,
                  COALESCE(d.ip, s.last_seen_ip, '') AS ip,
                  COALESCE(d.last_fw, s.current_fw_text, '') AS current_fw_text,
                  COALESCE(s.current_family, '') AS current_family,
                  COALESCE(s.current_version, '') AS current_version,
                  COALESCE(s.current_build_id, '') AS current_build_id,
                  COALESCE(s.ota_state, 'idle') AS ota_state,
                  COALESCE(s.ota_message, '') AS ota_message,
                  DATE_FORMAT(s.last_check_at, '%Y-%m-%d %H:%i:%s') AS last_check_at,
                  DATE_FORMAT(s.last_report_at, '%Y-%m-%d %H:%i:%s') AS last_report_at,
                  COALESCE(s.last_result_ok, NULL) AS last_result_ok,
                  COALESCE(s.target_release_id, 0) AS target_release_id,
                  DATE_FORMAT(s.target_assigned_at, '%Y-%m-%d %H:%i:%s') AS target_assigned_at,
                  COALESCE(s.target_assigned_by, '') AS target_assigned_by,
                  COALESCE(r.family, '') AS target_family,
                  COALESCE(r.version, '') AS target_version,
                  COALESCE(r.build_id, '') AS target_build_id,
                  COALESCE(r.force_update, 0) AS target_force_update,
                  COALESCE(r.is_enabled, 0) AS target_is_enabled,
                  DATE_FORMAT(d.last_seen_at, '%Y-%m-%d %H:%i:%s') AS device_last_seen_at
                FROM devices d
                LEFT JOIN device_firmware_state s
                  ON s.device_id = d.device_id
                LEFT JOIN firmware_releases r
                  ON r.id = s.target_release_id
                ORDER BY d.customer ASC, d.name ASC, d.ip ASC
                """
            )
            rows = cur.fetchall() or []
            out: List[Dict[str, Any]] = []
            for row in rows:
                out.append(
                    {
                        "device_id": str(row.get("device_id") or "").strip(),
                        "device_name": str(row.get("device_name") or "").strip(),
                        "customer": str(row.get("customer") or "-").strip() or "-",
                        "ip": str(row.get("ip") or "").strip(),
                        "current_fw_text": str(row.get("current_fw_text") or "").strip(),
                        "current_family": str(row.get("current_family") or "").strip(),
                        "current_version": str(row.get("current_version") or "").strip(),
                        "current_build_id": str(row.get("current_build_id") or "").strip(),
                        "ota_state": str(row.get("ota_state") or "idle").strip() or "idle",
                        "ota_message": str(row.get("ota_message") or "").strip(),
                        "last_check_at": str(row.get("last_check_at") or "").strip(),
                        "last_report_at": str(row.get("last_report_at") or "").strip(),
                        "last_result_ok": row.get("last_result_ok"),
                        "target_release_id": int(row.get("target_release_id") or 0),
                        "target_assigned_at": str(row.get("target_assigned_at") or "").strip(),
                        "target_assigned_by": str(row.get("target_assigned_by") or "").strip(),
                        "target_family": str(row.get("target_family") or "").strip(),
                        "target_version": str(row.get("target_version") or "").strip(),
                        "target_build_id": str(row.get("target_build_id") or "").strip(),
                        "target_force_update": bool(row.get("target_force_update")),
                        "target_is_enabled": bool(row.get("target_is_enabled")),
                        "device_last_seen_at": str(row.get("device_last_seen_at") or "").strip(),
                    }
                )
            return out


def touch_device_state(
    *,
    device_id: str,
    customer: str,
    device_name: str,
    ip: str,
    current_family: str,
    current_version: str,
    current_build_id: str,
    current_fw_text: str,
) -> None:
    did = _norm_device_id(device_id)
    if not did:
        return

    customer = (customer or "-").strip() or "-"
    device_name = (device_name or "").strip()
    ip = (ip or "").strip()
    current_family = (current_family or "").strip()
    current_version = (current_version or "").strip()
    current_build_id = (current_build_id or "").strip()
    current_fw_text = (current_fw_text or "").strip()

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO device_firmware_state (
                  device_id, customer, device_name, last_seen_ip,
                  current_family, current_version, current_build_id, current_fw_text,
                  ota_state
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'idle')
                ON DUPLICATE KEY UPDATE
                  customer=VALUES(customer),
                  device_name=VALUES(device_name),
                  last_seen_ip=VALUES(last_seen_ip),
                  current_family=VALUES(current_family),
                  current_version=VALUES(current_version),
                  current_build_id=VALUES(current_build_id),
                  current_fw_text=VALUES(current_fw_text),
                  updated_at=NOW()
                """,
                (did, customer, device_name, ip, current_family, current_version, current_build_id, current_fw_text),
            )

            if current_family and current_version:
                cur.execute(
                    """
                    SELECT
                      s.target_release_id,
                      COALESCE(r.family, '') AS target_family,
                      COALESCE(r.version, '') AS target_version,
                      COALESCE(r.build_id, '') AS target_build_id
                    FROM device_firmware_state s
                    LEFT JOIN firmware_releases r
                      ON r.id = s.target_release_id
                    WHERE s.device_id=%s
                    LIMIT 1
                    """,
                    (did,),
                )
                row = cur.fetchone() or {}
                target_release_id = int(row.get("target_release_id") or 0)
                target_family = str(row.get("target_family") or "").strip()
                target_version = str(row.get("target_version") or "").strip()
                target_build_id = str(row.get("target_build_id") or "").strip()
                if target_release_id > 0 and current_family == target_family and current_version == target_version:
                    if not target_build_id or current_build_id == target_build_id:
                        cur.execute(
                            """
                            UPDATE device_firmware_state
                            SET
                              target_release_id=NULL,
                              target_assigned_by=NULL,
                              target_assigned_at=NULL,
                              ota_state='success',
                              ota_message='current firmware matches assigned release',
                              last_report_at=NOW(),
                              last_result_ok=1
                            WHERE device_id=%s
                            """,
                            (did,),
                        )


def assign_release_to_devices(*, release_id: int, device_ids: List[str], assigned_by: str = "") -> int:
    try:
        rid = int(release_id)
    except Exception:
        raise ValueError("invalid release_id")
    if rid <= 0:
        raise ValueError("invalid release_id")

    dids = [_norm_device_id(v) for v in (device_ids or []) if _norm_device_id(v)]
    if not dids:
        raise ValueError("device_ids required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute("SELECT id FROM firmware_releases WHERE id=%s LIMIT 1", (rid,))
            if not cur.fetchone():
                raise ValueError("release not found")

            count = 0
            for did in dids:
                cur.execute(
                    """
                    SELECT
                      COALESCE(name, '') AS name,
                      COALESCE(customer, '-') AS customer,
                      COALESCE(ip, '') AS ip
                    FROM devices
                    WHERE device_id=%s
                    LIMIT 1
                    """,
                    (did,),
                )
                dev = cur.fetchone() or {}
                cur.execute(
                    """
                    INSERT INTO device_firmware_state (
                      device_id, customer, device_name, last_seen_ip,
                      target_release_id, target_assigned_by, target_assigned_at,
                      ota_state, ota_message
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, NOW(), 'available', 'release assigned')
                    ON DUPLICATE KEY UPDATE
                      customer=VALUES(customer),
                      device_name=VALUES(device_name),
                      last_seen_ip=VALUES(last_seen_ip),
                      target_release_id=VALUES(target_release_id),
                      target_assigned_by=VALUES(target_assigned_by),
                      target_assigned_at=VALUES(target_assigned_at),
                      ota_state='available',
                      ota_message='release assigned',
                      updated_at=NOW()
                    """,
                    (
                        did,
                        str(dev.get("customer") or "-").strip() or "-",
                        str(dev.get("name") or "").strip(),
                        str(dev.get("ip") or "").strip(),
                        rid,
                        (assigned_by or "").strip() or None,
                    ),
                )
                count += 1
            return count


def clear_targets(*, device_ids: List[str]) -> int:
    dids = [_norm_device_id(v) for v in (device_ids or []) if _norm_device_id(v)]
    if not dids:
        raise ValueError("device_ids required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            count = 0
            for did in dids:
                cur.execute(
                    """
                    UPDATE device_firmware_state
                    SET
                      target_release_id=NULL,
                      target_assigned_by=NULL,
                      target_assigned_at=NULL,
                      ota_state='idle',
                      ota_message='target cleared',
                      last_result_ok=NULL
                    WHERE device_id=%s
                    """,
                    (did,),
                )
                count += int(cur.rowcount or 0)
            return count


def delete_releases(*, release_ids: List[int]) -> Dict[str, Any]:
    normalized_ids: List[int] = []
    seen_ids = set()
    for value in release_ids or []:
        try:
            rid = int(value)
        except Exception:
            continue
        if rid <= 0 or rid in seen_ids:
            continue
        seen_ids.add(rid)
        normalized_ids.append(rid)

    if not normalized_ids:
        raise ValueError("release_ids required")

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)

            placeholders = ",".join(["%s"] * len(normalized_ids))
            cur.execute(
                f"""
                SELECT id, file_path
                FROM firmware_releases
                WHERE id IN ({placeholders})
                """,
                tuple(normalized_ids),
            )
            release_rows = cur.fetchall() or []
            found_ids = [int(row.get("id") or 0) for row in release_rows if int(row.get("id") or 0) > 0]
            if not found_ids:
                raise ValueError("release not found")

            found_placeholders = ",".join(["%s"] * len(found_ids))
            cur.execute(
                f"""
                UPDATE device_firmware_state
                SET
                  target_release_id=NULL,
                  target_assigned_by=NULL,
                  target_assigned_at=NULL,
                  ota_state='idle',
                  ota_message='release deleted',
                  last_result_ok=NULL
                WHERE target_release_id IN ({found_placeholders})
                """,
                tuple(found_ids),
            )
            cleared_targets = int(cur.rowcount or 0)

            cur.execute(
                f"""
                DELETE FROM firmware_releases
                WHERE id IN ({found_placeholders})
                """,
                tuple(found_ids),
            )
            deleted = int(cur.rowcount or 0)

    file_delete_failures: List[str] = []
    for row in release_rows:
        file_path = str(row.get("file_path") or "").strip()
        if not file_path:
            continue
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
        except Exception:
            file_delete_failures.append(file_path)

    return {
        "deleted": deleted,
        "cleared_targets": cleared_targets,
        "release_ids": found_ids,
        "file_delete_failures": file_delete_failures,
    }


def record_device_check(*, device_id: str) -> None:
    did = _norm_device_id(device_id)
    if not did:
        return
    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO device_firmware_state (device_id, ota_state, last_check_at)
                VALUES (%s, 'idle', NOW())
                ON DUPLICATE KEY UPDATE
                  last_check_at=NOW(),
                  updated_at=NOW()
                """,
                (did,),
            )


def get_target_release_for_device(*, device_id: str) -> Optional[Dict[str, Any]]:
    did = _norm_device_id(device_id)
    if not did:
        return None

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                SELECT
                  COALESCE(s.device_id, '') AS device_id,
                  COALESCE(s.current_family, '') AS current_family,
                  COALESCE(s.current_version, '') AS current_version,
                  COALESCE(s.current_build_id, '') AS current_build_id,
                  COALESCE(s.current_fw_text, '') AS current_fw_text,
                  COALESCE(s.target_release_id, 0) AS target_release_id,
                  COALESCE(r.family, '') AS target_family,
                  COALESCE(r.version, '') AS target_version,
                  COALESCE(r.build_id, '') AS target_build_id,
                  COALESCE(r.filename, '') AS filename,
                  COALESCE(r.stored_name, '') AS stored_name,
                  COALESCE(r.file_path, '') AS file_path,
                  COALESCE(r.sha256, '') AS sha256,
                  COALESCE(r.size_bytes, 0) AS size_bytes,
                  COALESCE(r.force_update, 0) AS force_update,
                  COALESCE(r.is_enabled, 0) AS is_enabled
                FROM device_firmware_state s
                LEFT JOIN firmware_releases r
                  ON r.id = s.target_release_id
                WHERE s.device_id=%s
                LIMIT 1
                """,
                (did,),
            )
            row = cur.fetchone()
            if not row:
                return None
            return {
                "device_id": str(row.get("device_id") or "").strip(),
                "current_family": str(row.get("current_family") or "").strip(),
                "current_version": str(row.get("current_version") or "").strip(),
                "current_build_id": str(row.get("current_build_id") or "").strip(),
                "current_fw_text": str(row.get("current_fw_text") or "").strip(),
                "target_release_id": int(row.get("target_release_id") or 0),
                "target_family": str(row.get("target_family") or "").strip(),
                "target_version": str(row.get("target_version") or "").strip(),
                "target_build_id": str(row.get("target_build_id") or "").strip(),
                "filename": str(row.get("filename") or "").strip(),
                "stored_name": str(row.get("stored_name") or "").strip(),
                "file_path": str(row.get("file_path") or "").strip(),
                "sha256": str(row.get("sha256") or "").strip().lower(),
                "size_bytes": int(row.get("size_bytes") or 0),
                "force_update": bool(row.get("force_update")),
                "is_enabled": bool(row.get("is_enabled")),
            }


def report_device_ota(
    *,
    device_id: str,
    customer: str = "-",
    device_name: str = "",
    ip: str = "",
    state: str,
    message: str = "",
    release_id: int = 0,
    current_family: str = "",
    current_version: str = "",
    current_build_id: str = "",
    current_fw_text: str = "",
) -> None:
    did = _norm_device_id(device_id)
    state = (state or "").strip().lower()
    if not did or not state:
        return

    customer = (customer or "-").strip() or "-"
    device_name = (device_name or "").strip()
    ip = (ip or "").strip()
    current_family = (current_family or "").strip()
    current_version = (current_version or "").strip()
    current_build_id = (current_build_id or "").strip()
    current_fw_text = (current_fw_text or "").strip()
    message = (message or "").strip()
    try:
        rid = int(release_id)
    except Exception:
        rid = 0

    result_ok: Optional[int] = None
    if state in {"success", "up_to_date"}:
        result_ok = 1
    elif state in {"failed", "error"}:
        result_ok = 0

    db = get_mysql()
    with db.conn() as conn:
        with conn.cursor() as cur:
            _ensure_schema_with_cur(cur)
            cur.execute(
                """
                INSERT INTO device_firmware_state (
                  device_id, customer, device_name, last_seen_ip,
                  current_family, current_version, current_build_id, current_fw_text,
                  ota_state, ota_message, last_report_at, last_result_ok
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                ON DUPLICATE KEY UPDATE
                  customer=VALUES(customer),
                  device_name=VALUES(device_name),
                  last_seen_ip=VALUES(last_seen_ip),
                  current_family=VALUES(current_family),
                  current_version=VALUES(current_version),
                  current_build_id=VALUES(current_build_id),
                  current_fw_text=VALUES(current_fw_text),
                  ota_state=VALUES(ota_state),
                  ota_message=VALUES(ota_message),
                  last_report_at=NOW(),
                  last_result_ok=VALUES(last_result_ok),
                  updated_at=NOW()
                """,
                (
                    did,
                    customer,
                    device_name,
                    ip,
                    current_family,
                    current_version,
                    current_build_id,
                    current_fw_text,
                    state,
                    message or None,
                    result_ok,
                ),
            )

            if rid > 0 and state in {"success", "up_to_date"}:
                cur.execute(
                    """
                    UPDATE device_firmware_state
                    SET
                      target_release_id=NULL,
                      target_assigned_by=NULL,
                      target_assigned_at=NULL
                    WHERE device_id=%s AND target_release_id=%s
                    """,
                    (did, rid),
                )
            elif current_family and current_version and state in {"success", "up_to_date"}:
                cur.execute(
                    """
                    SELECT
                      s.target_release_id,
                      COALESCE(r.family, '') AS target_family,
                      COALESCE(r.version, '') AS target_version,
                      COALESCE(r.build_id, '') AS target_build_id
                    FROM device_firmware_state s
                    LEFT JOIN firmware_releases r
                      ON r.id = s.target_release_id
                    WHERE s.device_id=%s
                    LIMIT 1
                    """,
                    (did,),
                )
                row = cur.fetchone() or {}
                target_release_id = int(row.get("target_release_id") or 0)
                target_family = str(row.get("target_family") or "").strip()
                target_version = str(row.get("target_version") or "").strip()
                target_build_id = str(row.get("target_build_id") or "").strip()
                if target_release_id > 0 and current_family == target_family and current_version == target_version:
                    if not target_build_id or current_build_id == target_build_id:
                        cur.execute(
                            """
                            UPDATE device_firmware_state
                            SET
                              target_release_id=NULL,
                              target_assigned_by=NULL,
                              target_assigned_at=NULL
                            WHERE device_id=%s
                            """,
                            (did,),
                        )
