#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

"$PROJECT_DIR/scripts/livekit_local.sh" start
"$PROJECT_DIR/scripts/abbas_web_service.sh" restart

echo
echo "Current status"
"$PROJECT_DIR/scripts/livekit_local.sh" status || true
"$PROJECT_DIR/scripts/abbas_web_service.sh" status || true
