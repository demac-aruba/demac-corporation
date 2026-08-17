#!/usr/bin/env bash
set -euo pipefail

BRIDGE=demac-whatsapp-bridge-v8-test.service
SYNC=demac-wacli-sync-v8-test.service

echo '=== DEMAC WACLI LIVE DIAGNOSTIC ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo
echo '=== SYSTEMD STATE ==='
for svc in "$BRIDGE" "$SYNC"; do
  echo "--- $svc ---"
  systemctl show "$svc" \
    -p ActiveState -p SubState -p MainPID -p NRestarts -p Result \
    -p ExecMainStartTimestamp -p ActiveEnterTimestamp --no-pager
 done

echo
echo '=== SYNC PROCESS ==='
PID="$(systemctl show -p MainPID --value "$SYNC")"
printf 'pid=%s\n' "$PID"
if [[ "$PID" =~ ^[0-9]+$ ]] && (( PID > 0 )); then
  ps -o pid=,ppid=,user=,stat=,lstart=,etime=,cmd= -p "$PID" || true
  echo
  echo 'cmdline:'
  tr '\0' ' ' < "/proc/$PID/cmdline" 2>/dev/null || true
  echo
fi

echo
echo '=== PORT 8787 LISTENER / CONNECTIONS ==='
ss -lnt '( sport = :8787 )' || true
ss -nt '( sport = :8787 or dport = :8787 )' || true

echo
echo '=== BRIDGE HEALTH ==='
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool

echo
echo '=== MOST RECENT LOCAL MESSAGES ==='
sudo -n /usr/local/sbin/demac-wacli-ro messages list --limit 20

echo
echo '=== SYNC JOURNAL SINCE PROCESS START ==='
START="$(systemctl show -p ExecMainStartTimestamp --value "$SYNC")"
printf 'sync_started=%s\n' "$START"
journalctl -u "$SYNC" --since "$START" --no-pager | tail -n 200 || true

echo
echo '=== BRIDGE JOURNAL LAST 2H ==='
journalctl -u "$BRIDGE" --since '2 hours ago' --no-pager | tail -n 120 || true

echo
echo '=== UNIT EXECSTART ==='
systemctl show -p ExecStart --value "$SYNC"

echo
echo 'WACLI_LIVE_DIAGNOSTIC_COMPLETE'
