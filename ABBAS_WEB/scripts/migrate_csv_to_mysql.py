#!/usr/bin/env python3
"""One-time CSV -> MySQL(MariaDB) migration for for_rnd_web.

✅ 허용 범위:
 - 기존 CSV를 '입력 소스'로만 읽어서 DB로 옮김

🚫 운영 중에는 이 스크립트를 제외하고, for_rnd_web가 CSV를 저장/조회하면 안 됩니다.

실행:
  python scripts/migrate_csv_to_mysql.py
"""

from __future__ import annotations

import csv
from datetime import datetime
from typing import Optional
from pathlib import Path

from core.env_loader import load_settings_env

from DB import data_repo, device_repo, log_repo, user_repo


def _read_csv_dicts(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open("r", newline="", encoding="utf-8-sig") as f:
        dr = csv.DictReader(f)
        out: list[dict[str, str]] = []
        for r in dr:
            out.append({k: (v or "").strip() for k, v in (r or {}).items()})
        return out


def migrate_devices(project_root: Path) -> int:
    csv_path = project_root / "Data" / "deviceList.csv"
    rows = _read_csv_dicts(csv_path)
    if not rows:
        print(f"[devices] skip (no file): {csv_path}")
        return 0

    n = 0
    for r in rows:
        name = (r.get("디바이스명") or "").strip()
        ip = (r.get("IP") or "").strip()
        customer = (r.get("거래처") or "-").strip() or "-"
        token = (r.get("token") or "").strip()
        device_id = (r.get("device_id") or "").strip()
        if not (name or ip or device_id):
            continue
        # DB 저장소는 IP가 반드시 필요(기존 UI/로직 보존)
        if not ip:
            # 그래도 데이터 이관을 위해 최소 placeholder를 둡니다.
            ip = "0.0.0.0"
        try:
            device_repo.upsert_device(name=name or ip or device_id, ip=ip, customer=customer, token=token, device_id=device_id)
            n += 1
        except Exception as e:
            print(f"[devices] fail: {device_id or ip} -> {e}")
    print(f"[devices] migrated: {n}")
    return n


def migrate_users(project_root: Path) -> int:
    user_dir = project_root / "userData"
    if not user_dir.is_dir():
        print(f"[users] skip (no dir): {user_dir}")
        return 0
    n = 0
    for p in sorted(user_dir.glob("*.csv")):
        try:
            rows = _read_csv_dicts(p)
            if not rows:
                continue
            r = rows[0]
            user_id = (r.get("ID") or "").strip()
            pw_hash = (r.get("PW_HASH") or "").strip()
            email = (r.get("EMAIL") or "").strip()
            birth = (r.get("BIRTH") or "").strip()
            name = (r.get("NAME") or "").strip()
            nickname = (r.get("NICKNAME") or "").strip()
            join_date = (r.get("JOIN_DATE") or "").strip()
            if not user_id:
                continue
            ok, _ = user_repo.create_user_row(
                user_id=user_id,
                pw_hash=pw_hash,
                email=email,
                birth=birth,
                name=name,
                nickname=nickname,
                join_date=join_date,
                email_verified=True,
            )
            if ok:
                n += 1
        except Exception as e:
            print(f"[users] fail: {p.name} -> {e}")
    print(f"[users] migrated: {n}")
    return n


def migrate_logs(project_root: Path) -> int:
    csv_path = project_root / "Data" / "serverLogs.csv"
    rows = _read_csv_dicts(csv_path)
    if not rows:
        print(f"[logs] skip (no file): {csv_path}")
        return 0
    n = 0
    for r in rows:
        t = (r.get("TIME") or "").strip()
        device = (r.get("DEVICE") or "-").strip() or "-"
        type_ = (r.get("TYPE") or "정보").strip() or "정보"
        msg = (r.get("MESSAGE") or "").strip()

        dt: Optional[datetime] = None
        if t:
            try:
                dt = datetime.strptime(t, "%Y-%m-%d %H:%M:%S")
            except Exception:
                dt = None

        try:
            log_repo.append_log(device=device, type_=type_, message=msg, time=dt)
            n += 1
        except Exception as e:
            print(f"[logs] fail: {t} {device} -> {e}")
    print(f"[logs] migrated (attempted): {n} (duplicates are ignored by unique hash)")
    return n


def migrate_device_data(project_root: Path) -> tuple[int, int]:
    base = project_root / "Data" / "deviceData"
    if not base.is_dir():
        print(f"[data] skip (no dir): {base}")
        return (0, 0)

    proc_files = list(base.glob("*/procedure/*.csv"))
    surv_files = list(base.glob("*/survey/*.csv"))

    proc_ins = 0
    surv_ins = 0

    # procedure
    for p in sorted(proc_files):
        device_id = p.parent.parent.name  # .../deviceData/<device_id>/procedure/<file>
        try:
            rows = _read_csv_dicts(p)
            if not rows:
                continue
            proc_ins += data_repo.insert_procedure_rows(device_id=device_id, source_filename=p.name, rows=rows)
        except Exception as e:
            print(f"[data][procedure] fail: {p} -> {e}")

    # survey
    for p in sorted(surv_files):
        device_id = p.parent.parent.name
        try:
            rows = _read_csv_dicts(p)
            if not rows:
                continue
            surv_ins += data_repo.insert_survey_rows(device_id=device_id, source_filename=p.name, rows=rows)
        except Exception as e:
            print(f"[data][survey] fail: {p} -> {e}")

    print(f"[data] procedure inserted: {proc_ins}")
    print(f"[data] survey inserted: {surv_ins}")
    return (proc_ins, surv_ins)


def main() -> int:
    load_settings_env()
    project_root = Path(__file__).resolve().parents[1]

    # 연결 확인
    from DB.runtime import get_mysql

    get_mysql().ping()

    print("==============================")
    print("for_rnd_web CSV -> MySQL migration")
    print(f"project_root: {project_root}")
    print("==============================")

    migrate_devices(project_root)
    migrate_users(project_root)
    migrate_logs(project_root)
    migrate_device_data(project_root)

    print("\n✅ Migration done.")
    print("- 운영 중에는 CSV 저장/조회 경로가 없어야 하며, DB만 사용합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
