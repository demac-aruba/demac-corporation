#!/usr/bin/env bash
set -euo pipefail

FILE=/opt/demac-whatsapp-bridge/server-v2.mjs

echo '=== DEMAC BRIDGE STARTUP INSPECTION ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== LINES 1-100 ==='
nl -ba "$FILE" | sed -n '1,100p'

echo
echo '=== LINES 235-315 ==='
nl -ba "$FILE" | sed -n '235,315p'

echo 'BRIDGE_STARTUP_INSPECTION_COMPLETE'
