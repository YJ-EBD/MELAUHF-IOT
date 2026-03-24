#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_FILE="$PROJECT_DIR/settings.env"
UVICORN_BIN="$PROJECT_DIR/venv/bin/uvicorn"
LOG_FILE="$PROJECT_DIR/uvicorn.log"
PID_FILE="$PROJECT_DIR/uvicorn.pid"
SYSTEMD_SERVICE="abbas-web.service"
LEGACY_SERVICE="for_rnd_web.service"

load_env() {
  local line key value
  [[ -f "$SETTINGS_FILE" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line// }" ]] && continue
    [[ "$line" == \#* ]] && continue
    [[ "$line" != *=* ]] && continue
    key="${line%%=*}"
    value="${line#*=}"
    key="${key#"${key%%[![:space:]]*}"}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value%$'\r'}"
    export "$key=$value"
  done < "$SETTINGS_FILE"
}

read_pid() {
  if [[ -f "$PID_FILE" ]]; then
    tr -dc '0-9' < "$PID_FILE"
  fi
}

is_running() {
  local pid
  pid="$(read_pid)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

has_systemd_service() {
  command -v systemctl >/dev/null 2>&1 && systemctl list-unit-files "$SYSTEMD_SERVICE" >/dev/null 2>&1
}

stop_server() {
  if has_systemd_service; then
    sudo systemctl disable --now "$LEGACY_SERVICE" >/dev/null 2>&1 || true
    sudo systemctl stop "$SYSTEMD_SERVICE" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
    echo "ABBAS_WEB stopped"
    return 0
  fi

  local pattern="uvicorn main:app"
  local pid

  if is_running; then
    pid="$(read_pid)"
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi

  while read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done < <(pgrep -f "$pattern" || true)

  sleep 1

  rm -f "$PID_FILE"
  echo "ABBAS_WEB stopped"
}

start_server() {
  load_env
  local host="${FOR_RND_WEB_HOST:-0.0.0.0}"
  local port="${FOR_RND_WEB_PORT:-8000}"

  if has_systemd_service; then
    sudo systemctl disable --now "$LEGACY_SERVICE" >/dev/null 2>&1 || true
    sudo systemctl daemon-reload
    sudo systemctl restart "$SYSTEMD_SERVICE"
    sleep 2
    if ! systemctl is-active --quiet "$SYSTEMD_SERVICE"; then
      echo "ABBAS_WEB failed to start. Recent logs:" >&2
      sudo journalctl -u "$SYSTEMD_SERVICE" -n 60 --no-pager >&2 || true
      exit 1
    fi
    echo "ABBAS_WEB started"
    echo "URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${port}"
    return 0
  fi

  if is_running; then
    echo "ABBAS_WEB already running (pid=$(read_pid))"
    exit 0
  fi

  cd "$PROJECT_DIR"
  nohup "$UVICORN_BIN" main:app --host "$host" --port "$port" > "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  sleep 2

  if ! is_running; then
    echo "ABBAS_WEB failed to start. Recent log:" >&2
    tail -n 60 "$LOG_FILE" >&2 || true
    exit 1
  fi

  echo "ABBAS_WEB started"
  echo "PID: $(read_pid)"
  echo "URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${port}"
}

status_server() {
  load_env
  local port="${FOR_RND_WEB_PORT:-8000}"
  if has_systemd_service; then
    if systemctl is-active --quiet "$SYSTEMD_SERVICE"; then
      echo "ABBAS_WEB running ($SYSTEMD_SERVICE)"
      echo "URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${port}"
      exit 0
    fi
    echo "ABBAS_WEB not running"
    exit 1
  fi
  if is_running; then
    echo "ABBAS_WEB running (pid=$(read_pid))"
    echo "URL: http://$(hostname -I 2>/dev/null | awk '{print $1}'):${port}"
    exit 0
  fi
  echo "ABBAS_WEB not running"
  exit 1
}

show_logs() {
  if has_systemd_service; then
    sudo journalctl -u "$SYSTEMD_SERVICE" -n 80 --no-pager
    return 0
  fi
  touch "$LOG_FILE"
  tail -n 80 "$LOG_FILE"
}

case "${1:-restart}" in
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server || true
    start_server
    ;;
  status)
    status_server
    ;;
  logs)
    show_logs
    ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|logs}" >&2
    exit 1
    ;;
esac
