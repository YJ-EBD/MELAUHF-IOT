#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SETTINGS_FILE="$PROJECT_DIR/settings.env"
BIN_DIR="$PROJECT_DIR/bin"
LIVEKIT_BIN="$BIN_DIR/livekit-server"
CONFIG_FILE="$PROJECT_DIR/deploy/livekit/livekit.yml"
LOG_FILE="$PROJECT_DIR/livekit.log"
PID_FILE="$PROJECT_DIR/livekit.pid"
SYSTEMD_SERVICE="abbas-livekit.service"

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

detect_host_ip() {
  hostname -I 2>/dev/null | awk '{print $1}'
}

ensure_binary() {
  mkdir -p "$BIN_DIR"
  if [[ -x "$LIVEKIT_BIN" ]]; then
    return 0
  fi
  INSTALL_PATH="$BIN_DIR" bash -c "$(curl -fsSL https://get.livekit.io)"
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

start_server() {
  load_env
  ensure_binary

  if has_systemd_service; then
    sudo systemctl daemon-reload
    sudo systemctl restart "$SYSTEMD_SERVICE"
    sleep 2
    if ! systemctl is-active --quiet "$SYSTEMD_SERVICE"; then
      echo "LiveKit failed to start. Recent logs:" >&2
      sudo journalctl -u "$SYSTEMD_SERVICE" -n 60 --no-pager >&2 || true
      exit 1
    fi
    echo "LiveKit started"
    echo "URL: ${LIVEKIT_URL:-}"
    return 0
  fi

  if is_running; then
    echo "LiveKit already running (pid=$(read_pid))"
    exit 0
  fi

  local bind_ip="${LIVEKIT_BIND_IP:-0.0.0.0}"
  local livekit_api_key="${LIVEKIT_API_KEY:-}"
  local livekit_api_secret="${LIVEKIT_API_SECRET:-}"

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "LiveKit config file is missing: $CONFIG_FILE" >&2
    exit 1
  fi

  if [[ -z "$livekit_api_key" || -z "$livekit_api_secret" ]]; then
    echo "LIVEKIT_API_KEY / LIVEKIT_API_SECRET are required" >&2
    exit 1
  fi

  cd "$PROJECT_DIR"
  nohup env -u REDIS_HOST -u REDIS_PASSWORD -u REDIS_DB -u REDIS_TIMEOUT_SEC \
    "$LIVEKIT_BIN" --bind "$bind_ip" --config "$CONFIG_FILE" --keys "${livekit_api_key}: ${livekit_api_secret}" > "$LOG_FILE" 2>&1 &
  echo "$!" > "$PID_FILE"
  sleep 2

  if ! is_running; then
    echo "LiveKit failed to start. Recent log:" >&2
    tail -n 40 "$LOG_FILE" >&2 || true
    exit 1
  fi

  echo "LiveKit started"
  echo "PID: $(read_pid)"
  echo "URL: ${LIVEKIT_URL:-}"
}

stop_server() {
  if has_systemd_service; then
    sudo systemctl stop "$SYSTEMD_SERVICE" >/dev/null 2>&1 || true
    rm -f "$PID_FILE"
    echo "LiveKit stopped"
    exit 0
  fi

  if ! is_running; then
    rm -f "$PID_FILE"
    echo "LiveKit is not running"
    exit 0
  fi

  local pid
  pid="$(read_pid)"
  kill "$pid" 2>/dev/null || true
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$PID_FILE"
  echo "LiveKit stopped"
}

status_server() {
  load_env
  if has_systemd_service; then
    if systemctl is-active --quiet "$SYSTEMD_SERVICE"; then
      echo "LiveKit running ($SYSTEMD_SERVICE)"
      echo "URL: ${LIVEKIT_URL:-}"
      exit 0
    fi
    echo "LiveKit not running"
    exit 1
  fi
  if is_running; then
    echo "LiveKit running (pid=$(read_pid))"
    echo "URL: ${LIVEKIT_URL:-}"
    exit 0
  fi
  echo "LiveKit not running"
  exit 1
}

show_logs() {
  if has_systemd_service; then
    sudo journalctl -u "$SYSTEMD_SERVICE" -n 80 --no-pager
    return 0
  fi
  touch "$LOG_FILE"
  tail -n 60 "$LOG_FILE"
}

case "${1:-start}" in
  install)
    ensure_binary
    echo "Installed: $LIVEKIT_BIN"
    ;;
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
    echo "Usage: $0 {install|start|stop|restart|status|logs}" >&2
    exit 1
    ;;
esac
