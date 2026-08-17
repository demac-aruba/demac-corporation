from pathlib import Path

path = Path('ops/digitalocean/deploy/server-v2.mjs')
text = path.read_text(encoding='utf-8')


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{label}: expected exactly 1 match, found {count}')
    text = text.replace(old, new, 1)

replace_once(
    "const ERP_WEBHOOK_URL = 'https://us-central1-demac-corporation.cloudfunctions.net/wacliWebhook';",
    "const FIREBASE_FUNCTIONS_BASE = 'https://us-central1-demac-corporation.cloudfunctions.net';\nconst ERP_WEBHOOK_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliWebhook`;\nconst MEDIA_INGEST_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliMediaIngest`;\nconst OUTBOUND_POLL_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliOutboundPoll`;\nconst OUTBOUND_ACK_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliOutboundAck`;",
    'firebase endpoint constants',
)
replace_once(
    "const OUTBOX_DIR = path.join(STATE_DIR, 'webhook-outbox');\nconst TEMP_DIR = path.join(STATE_DIR, 'media-temp');",
    "const OUTBOX_DIR = path.join(STATE_DIR, 'webhook-outbox');\nconst OUTBOUND_ACK_DIR = path.join(STATE_DIR, 'outbound-acks');\nconst TEMP_DIR = path.join(STATE_DIR, 'media-temp');",
    'state directories',
)
replace_once(
    "const MAX_MEDIA_BYTES = 50 * 1024 * 1024;",
    "const MAX_MEDIA_BYTES = 25 * 1024 * 1024;",
    'media limit alignment',
)
replace_once(
    "const RETRY_INTERVAL_MS = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS || 5000);",
    "const RETRY_INTERVAL_MS = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS || 5000);\nconst OUTBOUND_POLL_INTERVAL_MS = Math.max(1000, Number(process.env.WACLI_OUTBOUND_POLL_INTERVAL_MS || 2000));",
    'outbound poll interval',
)
replace_once(
    "let lastMediaError = null;\nlet forwarding = false;",
    "let lastMediaError = null;\nlet lastOutboundPollAt = null;\nlet lastOutboundAckAt = null;\nlet lastOutboundError = null;\nlet forwarding = false;\nlet outboundPolling = false;",
    'outbound state telemetry',
)

start = text.index('function authorized(request) {')
end = text.index('function json(response, status, payload) {', start)
text = text[:start] + text[end:]

old_persist = '''async function persistWebhookEvent(rawBody) {\n  await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });\n  const filename = outboxFileName();\n  const temporary = path.join(OUTBOX_DIR, `.${filename}.tmp`);\n  const finalPath = path.join(OUTBOX_DIR, filename);\n  await fs.writeFile(temporary, JSON.stringify({\n    receivedAt: new Date().toISOString(),\n    bodyBase64: rawBody.toString('base64'),\n  }), { mode: 0o600 });\n  await fs.rename(temporary, finalPath);\n  return finalPath;\n}\n'''
new_persist = '''async function atomicWriteJson(finalPath, payload) {\n  const temporary = `${finalPath}.${crypto.randomUUID()}.tmp`;\n  await fs.writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });\n  await fs.rename(temporary, finalPath);\n}\n\nasync function persistWebhookEvent(rawBody) {\n  await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });\n  const filename = outboxFileName();\n  const finalPath = path.join(OUTBOX_DIR, filename);\n  await atomicWriteJson(finalPath, {\n    receivedAt: new Date().toISOString(),\n    bodyBase64: rawBody.toString('base64'),\n  });\n  return finalPath;\n}\n\nasync function rewriteWebhookRecord(filePath, record, rawBody) {\n  await atomicWriteJson(filePath, { ...record, bodyBase64: rawBody.toString('base64') });\n}\n\nfunction mediaField(media, ...names) {\n  for (const name of names) {\n    if (media?.[name] !== undefined && media?.[name] !== null && String(media[name]).trim() !== '') return media[name];\n  }\n  return null;\n}\n\nasync function downloadInboundMedia(chat, messageId) {\n  await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });\n  const output = path.join(TEMP_DIR, `inbound-${safeName(messageId, crypto.randomUUID())}`);\n  let downloadError = null;\n  try {\n    for (let attempt = 1; attempt <= MEDIA_DOWNLOAD_ATTEMPTS; attempt += 1) {\n      await fs.unlink(output).catch(() => undefined);\n      try {\n        await execFileAsync(WACLI_BINARY, [\n          '--store', WACLI_STORE_DIR, '--read-only', 'media', 'download',\n          '--chat', chat, '--id', messageId, '--output', output,\n        ], {\n          timeout: 60000,\n          maxBuffer: 4 * 1024 * 1024,\n          env: process.env,\n          windowsHide: true,\n        });\n        downloadError = null;\n        break;\n      } catch (error) {\n        downloadError = error;\n        if (attempt < MEDIA_DOWNLOAD_ATTEMPTS) await sleep(MEDIA_DOWNLOAD_RETRY_MS * attempt);\n      }\n    }\n    if (downloadError) throw downloadError;\n    const buffer = await fs.readFile(output);\n    if (!buffer.length) throw new Error('Downloaded WhatsApp media is empty.');\n    if (buffer.length > MAX_MEDIA_BYTES) throw new Error('WhatsApp media exceeds the 25 MB connector limit.');\n    return buffer;\n  } finally {\n    await fs.unlink(output).catch(() => undefined);\n  }\n}\n\nasync function uploadInboundMedia(payload) {\n  const media = payload?.Media;\n  if (!media || typeof media !== 'object') return payload;\n  const existingUrl = String(media.mediaUrl || media.url || '').trim();\n  if (existingUrl) return payload;\n\n  const chat = String(payload.Chat || '').trim();\n  const messageId = String(payload.ID || '').trim();\n  if (!chat || !messageId) throw new Error('Inbound media requires Chat and ID before forwarding.');\n\n  try {\n    const bytes = await downloadInboundMedia(chat, messageId);\n    const fileName = String(mediaField(media, 'Filename', 'filename', 'fileName') || '').trim();\n    const mediaType = String(mediaField(media, 'Type', 'type', 'kind') || '').trim().toLowerCase();\n    const mimeType = String(mediaField(media, 'MimeType', 'mimeType', 'mime_type') || 'application/octet-stream').trim();\n    const endpoint = new URL(MEDIA_INGEST_URL);\n    endpoint.searchParams.set('chat', chat);\n    endpoint.searchParams.set('messageId', messageId);\n    if (fileName) endpoint.searchParams.set('fileName', fileName);\n    if (mediaType) endpoint.searchParams.set('mediaType', mediaType);\n\n    const response = await fetch(endpoint, {\n      method: 'POST',\n      headers: {\n        Authorization: `Bearer ${BRIDGE_TOKEN}`,\n        'Content-Type': mimeType || 'application/octet-stream',\n      },\n      body: bytes,\n      signal: AbortSignal.timeout(120000),\n    });\n    const body = await response.json().catch(() => ({}));\n    if (!response.ok || body?.ok !== true || !body?.mediaUrl) {\n      throw new Error(body?.error || `Firebase media ingest returned HTTP ${response.status}`);\n    }\n\n    const resolvedMime = String(body.mediaMimeType || mimeType || 'application/octet-stream');\n    const resolvedSize = Number(body.mediaSize || bytes.length);\n    lastMediaSuccessAt = new Date().toISOString();\n    lastMediaError = null;\n    return {\n      ...payload,\n      Media: {\n        ...media,\n        mediaUrl: body.mediaUrl,\n        url: body.mediaUrl,\n        MimeType: resolvedMime,\n        mimeType: resolvedMime,\n        FileLength: resolvedSize,\n        size: resolvedSize,\n      },\n    };\n  } catch (error) {\n    lastMediaError = (error instanceof Error ? error.message : String(error)).split('\\n')[0].slice(0, 300);\n    throw error;\n  }\n}\n'''
replace_once(old_persist, new_persist, 'durable outbox helpers')

start = text.index('async function forwardRecord(filePath) {')
end = text.index('async function flushWebhookOutbox()', start)
new_forward = '''async function forwardRecord(filePath) {\n  const record = JSON.parse(await fs.readFile(filePath, 'utf8'));\n  let rawBody = Buffer.from(record.bodyBase64, 'base64');\n  let payload = JSON.parse(rawBody.toString('utf8'));\n\n  if (!payload.EventType && payload.Media && !(payload.Media.mediaUrl || payload.Media.url)) {\n    payload = await uploadInboundMedia(payload);\n    rawBody = Buffer.from(JSON.stringify(payload));\n    await rewriteWebhookRecord(filePath, record, rawBody);\n  }\n\n  const response = await fetch(ERP_WEBHOOK_URL, {\n    method: 'POST',\n    headers: {\n      'Content-Type': 'application/json',\n      Authorization: `Bearer ${BRIDGE_TOKEN}`,\n    },\n    body: rawBody,\n    signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),\n  });\n  if (!response.ok) {\n    throw new Error(`ERP webhook returned HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);\n  }\n  await fs.unlink(filePath);\n  lastForwardSuccessAt = new Date().toISOString();\n  lastForwardError = null;\n  return true;\n}\n\n'''
text = text[:start] + new_forward + text[end:]

start = text.index('async function handleMedia(request, response) {')
end = text.index('async function handleWacliEvent(request, response) {', start)
new_outbound = '''async function pendingOutboundAckCount() {\n  try {\n    return (await fs.readdir(OUTBOUND_ACK_DIR)).filter((name) => name.endsWith('.json')).length;\n  } catch {\n    return 0;\n  }\n}\n\nasync function persistOutboundAck(payload) {\n  await fs.mkdir(OUTBOUND_ACK_DIR, { recursive: true, mode: 0o700 });\n  const filePath = path.join(OUTBOUND_ACK_DIR, `${Date.now().toString().padStart(13, '0')}-${safeName(payload.queueId, crypto.randomUUID())}.json`);\n  await atomicWriteJson(filePath, payload);\n  return filePath;\n}\n\nasync function postFirebaseJson(endpoint, payload, timeout = 30000) {\n  const response = await fetch(endpoint, {\n    method: 'POST',\n    headers: {\n      Authorization: `Bearer ${BRIDGE_TOKEN}`,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify(payload),\n    signal: AbortSignal.timeout(timeout),\n  });\n  const body = await response.json().catch(() => ({}));\n  if (!response.ok) {\n    const error = new Error(body?.error || `Firebase connector returned HTTP ${response.status}`);\n    error.statusCode = response.status;\n    throw error;\n  }\n  return body;\n}\n\nasync function flushOutboundAcks() {\n  await fs.mkdir(OUTBOUND_ACK_DIR, { recursive: true, mode: 0o700 });\n  const files = (await fs.readdir(OUTBOUND_ACK_DIR)).filter((name) => name.endsWith('.json')).sort();\n  for (const filename of files) {\n    const filePath = path.join(OUTBOUND_ACK_DIR, filename);\n    const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));\n    await postFirebaseJson(OUTBOUND_ACK_URL, payload, 60000);\n    await fs.unlink(filePath);\n    lastOutboundAckAt = new Date().toISOString();\n    lastOutboundError = null;\n  }\n  return true;\n}\n\nasync function pollOutboundCommand() {\n  const body = await postFirebaseJson(OUTBOUND_POLL_URL, { bridgeId: os.hostname() }, 30000);\n  lastOutboundPollAt = new Date().toISOString();\n  lastOutboundError = null;\n  return body?.command || null;\n}\n\nasync function processOutboundCycle() {\n  if (outboundPolling) return;\n  outboundPolling = true;\n  try {\n    await flushOutboundAcks();\n    const command = await pollOutboundCommand();\n    if (!command) return;\n\n    const queueId = String(command.queueId || '').trim();\n    const claimToken = String(command.claimToken || '').trim();\n    if (!queueId || !claimToken) throw new Error('Firebase returned an outbound command without queueId/claimToken.');\n\n    let ack;\n    try {\n      const to = validateRecipient(command.to);\n      const textValue = String(command.text || '');\n      const media = command.media && typeof command.media === 'object' ? command.media : null;\n      if (!textValue.trim() && !media) throw new Error('Outbound command contains neither text nor media.');\n      const result = await sendItem({ to, text: textValue, media });\n      lastSendSuccessAt = new Date().toISOString();\n      lastSendError = null;\n      ack = {\n        queueId,\n        claimToken,\n        sent: true,\n        messageId: result.messageId || null,\n        storeWarning: result.storeWarning || null,\n      };\n    } catch (error) {\n      lastSendError = error instanceof Error ? error.message : String(error);\n      ack = { queueId, claimToken, sent: false, error: lastSendError };\n    }\n\n    await persistOutboundAck(ack);\n    await flushOutboundAcks();\n  } catch (error) {\n    lastOutboundError = (error instanceof Error ? error.message : String(error)).split('\\n')[0].slice(0, 400);\n  } finally {\n    outboundPolling = false;\n  }\n}\n\n'''
text = text[:start] + new_outbound + text[end:]

replace_once(
    "    bridgeAuth: 'bearer-v1',\n    erpWebhookUrl: ERP_WEBHOOK_URL,",
    "    bridgeAuth: 'bearer-v1',\n    connectorMode: 'outbound-only-v1',\n    erpWebhookUrl: ERP_WEBHOOK_URL,\n    mediaIngestUrl: MEDIA_INGEST_URL,\n    outboundPollUrl: OUTBOUND_POLL_URL,",
    'health connector mode',
)
replace_once(
    "    lastMediaSuccessAt,\n    lastMediaError,",
    "    lastMediaSuccessAt,\n    lastMediaError,\n    pendingOutboundAcks: await pendingOutboundAckCount(),\n    lastOutboundPollAt,\n    lastOutboundAckAt,\n    lastOutboundError,",
    'health outbound telemetry',
)
replace_once(
    "await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });\nawait fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });",
    "await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });\nawait fs.mkdir(OUTBOUND_ACK_DIR, { recursive: true, mode: 0o700 });\nawait fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });",
    'ack directory initialization',
)
replace_once(
    "    if (request.method === 'GET' && url.pathname === '/health') return await handleHealth(response);\n    if (request.method === 'POST' && url.pathname === '/v1/send') return await handleSend(request, response);\n    if (request.method === 'POST' && url.pathname === '/v1/media') return await handleMedia(request, response);\n    if (request.method === 'POST' && url.pathname === '/v1/events') return await handleWacliEvent(request, response);",
    "    if (request.method === 'GET' && url.pathname === '/health') return await handleHealth(response);\n    if (request.method === 'POST' && url.pathname === '/v1/events') return await handleWacliEvent(request, response);",
    'private HTTP routes',
)
replace_once(
    "const retryTimer = setInterval(() => flushWebhookOutbox().catch(() => undefined), RETRY_INTERVAL_MS);\nretryTimer.unref();",
    "const retryTimer = setInterval(() => flushWebhookOutbox().catch(() => undefined), RETRY_INTERVAL_MS);\nretryTimer.unref();\nconst outboundTimer = setInterval(() => processOutboundCycle().catch(() => undefined), OUTBOUND_POLL_INTERVAL_MS);\noutboundTimer.unref();\nqueueMicrotask(() => processOutboundCycle().catch(() => undefined));",
    'outbound polling timer',
)
replace_once(
    "    clearInterval(retryTimer);\n    server.close(() => process.exit(0));",
    "    clearInterval(retryTimer);\n    clearInterval(outboundTimer);\n    server.close(() => process.exit(0));",
    'shutdown timers',
)

for retired in ["url.pathname === '/v1/send'", "url.pathname === '/v1/media'", 'handleMedia(', 'handleSend(', 'function authorized(request)']:
    if retired in text:
        raise SystemExit(f'retired inbound bridge surface remains: {retired}')
for required in ['wacliMediaIngest', 'wacliOutboundPoll', 'wacliOutboundAck', "connectorMode: 'outbound-only-v1'", 'processOutboundCycle', 'OUTBOUND_ACK_DIR']:
    if required not in text:
        raise SystemExit(f'missing outbound-only bridge component: {required}')

path.write_text(text, encoding='utf-8')
print('DigitalOcean bridge converted to outbound-only Firebase connector.')
