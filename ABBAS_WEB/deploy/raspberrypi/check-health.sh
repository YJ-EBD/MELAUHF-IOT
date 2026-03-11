#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1}"
PORT="${2:-8000}"

curl -fsS "${BASE_URL}:${PORT}/api/health/live"
echo
curl -fsS "${BASE_URL}:${PORT}/api/health/ready"
echo
