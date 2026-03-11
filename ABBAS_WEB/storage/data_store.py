"""Legacy storage shim (DB-backed)."""

from __future__ import annotations

from services.data_store import (
    ingest_csv_bytes_to_db,
    normalize_device_id,
    read_rows_paginated,
)

__all__ = [
    "normalize_device_id",
    "ingest_csv_bytes_to_db",
    "read_rows_paginated",
]
