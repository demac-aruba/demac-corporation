#!/usr/bin/env bash
set -euo pipefail

STAGED=/home/demac-deploy/stage/server-v2.mjs
DEPLOYED=/opt/demac-whatsapp-bridge/server-v2.mjs
EXPECTED_BASE='https://us-central1-demac-corporation.cloudfunctions.net'
EXPECTED_WEBHOOK="${EXPECTED_BASE}/wacliWebhook"
EXPECTED_MEDIA="${EXPECTED_BASE}/wacliMediaIngest"
EXPECTED_POLL="${EXPECTED_BASE}/wacliOutboundPoll"
EXPECTED_STORE='/var/lib/demac-wacli-test'

echo '=== DEMAC OUTBOUND-ONLY WACLI CONNECTOR DEPLOY ==='
printf 'time_utc=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo '=== PRE-DEPLOY SNAPSHOT ==='
if pre_health="$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null)"; then
  printf '%s' "$pre_health" | python3 -m json.tool
else
  echo 'bridge_health_unavailable'
fi
printf 'bridge_service=%s\n' "$(systemctl is-active demac-whatsapp-bridge-v8-test.service 2>/dev/null || true)"
printf 'sync_service=%s\n' "$(systemctl is-active demac-wacli-sync-v8-test.service 2>/dev/null || true)"
printf 'wacli_version='; /usr/local/bin/wacli --version 2>/dev/null || true
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo 'ERROR: ffmpeg is required for browser-recorded WhatsApp voice notes.' >&2
  exit 1
fi
printf 'ffmpeg_version='; ffmpeg -version 2>/dev/null | head -n 1

test -s "$STAGED"
node --check "$STAGED"

for retired in \
  "url.pathname === '/v1/send'" \
  "url.pathname === '/v1/media'" \
  'WACLI_BRIDGE_URL' \
  'X-Demac-Bridge-Signature' \
  'BRIDGE_SIGNING_KEY' \
  'wacliMediaUploadTicketV2'; do
  if grep -Fq "$retired" "$STAGED"; then
    echo "ERROR: staged bridge still contains retired connector surface: $retired" >&2
    exit 1
  fi
done

for required in \
  "const FIREBASE_FUNCTIONS_BASE = '${EXPECTED_BASE}';" \
  '`${FIREBASE_FUNCTIONS_BASE}/wacliWebhook`' \
  '`${FIREBASE_FUNCTIONS_BASE}/wacliMediaIngest`' \
  '`${FIREBASE_FUNCTIONS_BASE}/wacliOutboundPoll`' \
  '`${FIREBASE_FUNCTIONS_BASE}/wacliOutboundAck`' \
  "connectorMode: 'outbound-only-v1'" \
  "const WACLI_STORE_DIR = String(process.env.WACLI_STORE_DIR || '/var/lib/demac-wacli-test').trim()" \
  "const DEAD_LETTER_DIR = path.join(STATE_DIR, 'webhook-dead-letter');" \
  'pendingDeadLetterEvents: await pendingDeadLetterCount()' \
  "if (media.kind === 'voice')"; do
  if ! grep -Fq "$required" "$STAGED"; then
    echo "ERROR: staged bridge is missing required outbound-only component: $required" >&2
    exit 1
  fi
done

if ! grep -Fq 'Authorization: `Bearer ${BRIDGE_TOKEN}`' "$STAGED"; then
  echo 'ERROR: staged bridge is missing the standard Bearer boundary.' >&2
  exit 1
fi

echo 'staged_bridge_sha256='"$(sha256sum "$STAGED" | awk '{print $1}')"
sudo -n /usr/local/sbin/demac-deploy-bridge
node --check "$DEPLOYED"
echo 'deployed_bridge_sha256='"$(sha256sum "$DEPLOYED" | awk '{print $1}')"

echo '=== VERIFY PRIVATE LOCAL SURFACE ==='
for retired_path in /v1/send /v1/media; do
  status="$(curl -sS -o /tmp/demac-retired-route.json -w '%{http_code}' -X POST "http://127.0.0.1:8787${retired_path}" -H 'Content-Type: application/json' -d '{}')"
  if [ "$status" != '404' ]; then
    echo "ERROR: retired route ${retired_path} returned HTTP ${status}; expected 404." >&2
    cat /tmp/demac-retired-route.json || true
    exit 1
  fi
  echo "retired_route=${retired_path} status=404"
done

echo '=== VERIFY OUTBOUND-ONLY HEALTH AND FIREBASE REACHABILITY ==='
for attempt in $(seq 1 45); do
  health="$(curl -fsS http://127.0.0.1:8787/health 2>/dev/null || true)"
  if [ -n "$health" ]; then
    values="$(printf '%s' "$health" | python3 -c '
import json,sys
p=json.load(sys.stdin)
print("|".join([
 str(p.get("ok",False)).lower(),
 str(p.get("connectorMode") or ""),
 str(p.get("wacliStoreDir") or ""),
 str(p.get("erpWebhookUrl") or ""),
 str(p.get("mediaIngestUrl") or ""),
 str(p.get("outboundPollUrl") or ""),
 str(p.get("pendingWebhookEvents",-1)),
 str(p.get("pendingDeadLetterEvents",-1)),
 str(p.get("pendingOutboundAcks",-1)),
 str(p.get("lastForwardError") or ""),
 str(p.get("lastOutboundPollAt") or ""),
 str(p.get("lastOutboundError") or ""),
]))')"
    IFS='|' read -r ok mode store webhook media poll_url pending dead_letters acks forward_error poll_at outbound_error <<<"$values"
    printf 'attempt=%s ok=%s mode=%s pending=%s dead_letters=%s acks=%s poll=%s outbound_error=%s\n' \
      "$attempt" "$ok" "$mode" "$pending" "$dead_letters" "$acks" "${poll_at:-none}" "$([ -n "$outbound_error" ] && echo yes || echo no)"
    if [ "$ok" = 'true' ] \
      && [ "$mode" = 'outbound-only-v1' ] \
      && [ "$store" = "$EXPECTED_STORE" ] \
      && [ "$webhook" = "$EXPECTED_WEBHOOK" ] \
      && [ "$media" = "$EXPECTED_MEDIA" ] \
      && [ "$poll_url" = "$EXPECTED_POLL" ] \
      && [ "$pending" = '0' ] \
      && [ "$acks" = '0' ] \
      && [ -z "$forward_error" ] \
      && [ -n "$poll_at" ] \
      && [ -z "$outbound_error" ]; then
      echo 'OUTBOUND_ONLY_BRIDGE_READY'
      curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool
      exit 0
    fi
  fi
  sleep 2
done

echo 'ERROR: outbound-only bridge did not reach a healthy Firebase-connected state.' >&2
curl -fsS http://127.0.0.1:8787/health | python3 -m json.tool || true
exit 1
