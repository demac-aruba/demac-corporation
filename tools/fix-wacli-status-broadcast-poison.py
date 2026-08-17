from pathlib import Path

path = Path('ops/digitalocean/deploy/server-v2.mjs')
text = path.read_text(encoding='utf-8')

if 'function shouldIgnoreInboundPayload(payload)' in text:
    raise SystemExit('status-broadcast filter already present')

signature_block = """function wacliSignatureFor(rawBody) {\n  return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;\n}\n\n"""
filter_block = """function wacliSignatureFor(rawBody) {\n  return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;\n}\n\nfunction shouldIgnoreInboundPayload(payload) {\n  if (payload?.EventType) return false;\n  const chat = String(payload?.Chat || '').trim().toLowerCase();\n  return chat === 'status@broadcast';\n}\n\n"""
if text.count(signature_block) != 1:
    raise SystemExit('unexpected wacliSignatureFor structure')
text = text.replace(signature_block, filter_block, 1)

forward_old = """  let rawBody = Buffer.from(record.bodyBase64, 'base64');\n  let payload = JSON.parse(rawBody.toString('utf8'));\n\n  if (!payload.EventType && payload.Media && !(payload.Media.mediaUrl || payload.Media.url)) {\n"""
forward_new = """  let rawBody = Buffer.from(record.bodyBase64, 'base64');\n  let payload = JSON.parse(rawBody.toString('utf8'));\n\n  if (shouldIgnoreInboundPayload(payload)) {\n    await fs.unlink(filePath);\n    lastForwardError = null;\n    return true;\n  }\n\n  if (!payload.EventType && payload.Media && !(payload.Media.mediaUrl || payload.Media.url)) {\n"""
if text.count(forward_old) != 1:
    raise SystemExit('unexpected forwardRecord structure')
text = text.replace(forward_old, forward_new, 1)

handler_old = """    const original = JSON.parse(rawBody.toString('utf8'));\n    const enriched = await enrichIncomingPayload(original);\n"""
handler_new = """    const original = JSON.parse(rawBody.toString('utf8'));\n    if (shouldIgnoreInboundPayload(original)) {\n      json(response, 202, { accepted: true, ignored: true, reason: 'status-broadcast' });\n      return;\n    }\n    const enriched = await enrichIncomingPayload(original);\n"""
if text.count(handler_old) != 1:
    raise SystemExit('unexpected handleWacliEvent structure')
text = text.replace(handler_old, handler_new, 1)

path.write_text(text, encoding='utf-8')
print('STATUS_BROADCAST_FILTER_APPLIED')
