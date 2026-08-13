import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const WACLI_BINARY = process.env.WACLI_BINARY || 'wacli';
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || '').trim();
const WEBHOOK_SECRET = String(process.env.WACLI_WEBHOOK_SECRET || '').trim();
const ERP_WEBHOOK_URL = String(process.env.ERP_WEBHOOK_URL || '').trim();
const STATE_DIR = process.env.BRIDGE_STATE_DIR || '/var/lib/demac-whatsapp-bridge';
const OUTBOX_DIR = path.join(STATE_DIR, 'webhook-outbox');
const MAX_BODY_BYTES = 256 * 1024;
const SEND_TIMEOUT_MS = Number(process.env.WACLI_SEND_TIMEOUT_MS || 45000);
const FORWARD_TIMEOUT_MS = Number(process.env.ERP_FORWARD_TIMEOUT_MS || 15000);
const RETRY_INTERVAL_MS = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS || 5000);

let startedAt = new Date().toISOString();
let lastForwardSuccessAt = null;
let lastForwardError = null;
let lastSendSuccessAt = null;
let lastSendError = null;
let forwarding = false;

function requireConfiguration() {
  const missing = [];
  if (!BRIDGE_TOKEN) missing.push('BRIDGE_TOKEN');
  if (!WEBHOOK_SECRET) missing.push('WACLI_WEBHOOK_SECRET');
  if (!/^https:\/\//i.test(ERP_WEBHOOK_URL)) missing.push('ERP_WEBHOOK_URL (HTTPS)');
  if (missing.length) throw new Error(`Missing bridge configuration: ${missing.join(', ')}`);
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second);
}

function signatureFor(rawBody) {
  return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
}

function authorized(request) {
  const header = String(request.headers.authorization || '');
  return header.startsWith('Bearer ') && safeEqual(header.slice(7).trim(), BRIDGE_TOKEN);
}

function json(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  response.end(body);
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validateRecipient(value) {
  const recipient = String(value || '').trim();
  if (!recipient || recipient.length > 160) throw new Error('A WhatsApp recipient is required.');
  if (/[@]/.test(recipient) && !/@(s\.whatsapp\.net|lid|g\.us|newsletter)$/.test(recipient)) {
    throw new Error('Unsupported WhatsApp JID.');
  }
  if (!/@/.test(recipient) && !/^\+?[0-9() .-]{8,24}$/.test(recipient)) {
    throw new Error('Recipient must be a phone number or supported WhatsApp JID.');
  }
  return recipient;
}

function validateText(value) {
  const text = String(value || '');
  if (!text.trim()) throw new Error('Message text is required.');
  if (text.length > 10000) throw new Error('Message text exceeds the 10000 character bridge limit.');
  return text;
}

function normalizeWacliResult(stdout) {
  let envelope;
  try {
    envelope = JSON.parse(String(stdout || '').trim());
  } catch {
    throw new Error('wacli did not return valid JSON output.');
  }
  if (envelope?.success === false) {
    throw new Error(envelope?.error?.message || envelope?.error || 'wacli reported an unsuccessful send.');
  }
  const data = envelope?.data && typeof envelope.data === 'object' ? envelope.data : envelope;
  const sent = data?.sent === true || envelope?.success === true;
  if (!sent) throw new Error('wacli did not confirm that WhatsApp accepted the send request.');
  return {
    sent: true,
    messageId: data?.id || data?.message_id || data?.messageId || null,
    storeWarning: data?.store_warning || envelope?.store_warning || null,
  };
}

async function sendText({ to, text }) {
  const args = [
    '--json',
    '--timeout', `${Math.ceil(SEND_TIMEOUT_MS / 1000)}s`,
    'send', 'text',
    '--to', to,
    '--message', text,
    '--no-preview',
    '--post-send-wait', '2s',
  ];
  const { stdout, stderr } = await execFileAsync(WACLI_BINARY, args, {
    timeout: SEND_TIMEOUT_MS + 5000,
    maxBuffer: 1024 * 1024,
    env: process.env,
    windowsHide: true,
  });
  const result = normalizeWacliResult(stdout);
  if (stderr?.trim()) result.stderr = stderr.trim().slice(-2000);
  return result;
}

function outboxFileName() {
  const timestamp = Date.now().toString().padStart(13, '0');
  return `${timestamp}-${crypto.randomUUID()}.json`;
}

async function persistWebhookEvent(rawBody, signature) {
  await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });
  const filename = outboxFileName();
  const temporary = path.join(OUTBOX_DIR, `.${filename}.tmp`);
  const finalPath = path.join(OUTBOX_DIR, filename);
  const record = JSON.stringify({
    receivedAt: new Date().toISOString(),
    signature,
    bodyBase64: rawBody.toString('base64'),
  });
  await fs.writeFile(temporary, record, { mode: 0o600 });
  await fs.rename(temporary, finalPath);
  return finalPath;
}

async function forwardRecord(filePath) {
  const record = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const rawBody = Buffer.from(record.bodyBase64, 'base64');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const response = await fetch(ERP_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Wacli-Signature': record.signature,
      },
      body: rawBody,
      signal: controller.signal,
    });
    if (!response.ok) {
      const details = (await response.text().catch(() => '')).slice(0, 1000);
      throw new Error(`ERP webhook returned HTTP ${response.status}${details ? `: ${details}` : ''}`);
    }
    await fs.unlink(filePath);
    lastForwardSuccessAt = new Date().toISOString();
    lastForwardError = null;
    return true;
  } finally {
    clearTimeout(timeout);
  }
}

async function flushWebhookOutbox() {
  if (forwarding) return;
  forwarding = true;
  try {
    await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });
    const files = (await fs.readdir(OUTBOX_DIR))
      .filter((filename) => filename.endsWith('.json'))
      .sort()
      .slice(0, 100);
    for (const filename of files) {
      try {
        const delivered = await forwardRecord(path.join(OUTBOX_DIR, filename));
        if (!delivered) break;
      } catch (error) {
        lastForwardError = error instanceof Error ? error.message : String(error);
        break;
      }
    }
  } catch (error) {
    lastForwardError = error instanceof Error ? error.message : String(error);
  } finally {
    forwarding = false;
  }
}

async function pendingWebhookCount() {
  try {
    return (await fs.readdir(OUTBOX_DIR)).filter((filename) => filename.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function handleSend(request, response) {
  if (!authorized(request)) {
    json(response, 401, { sent: false, error: 'Unauthorized' });
    return;
  }
  try {
    const rawBody = await readBody(request);
    const input = JSON.parse(rawBody.toString('utf8'));
    const to = validateRecipient(input.to);
    const text = validateText(input.text);
    const result = await sendText({ to, text });
    lastSendSuccessAt = new Date().toISOString();
    lastSendError = null;
    json(response, 200, {
      sent: true,
      messageId: result.messageId,
      storeWarning: result.storeWarning,
      clientMessageId: input.clientMessageId || null,
    });
  } catch (error) {
    lastSendError = error instanceof Error ? error.message : String(error);
    json(response, error?.statusCode || 502, { sent: false, error: lastSendError });
  }
}

async function handleWacliEvent(request, response) {
  try {
    const rawBody = await readBody(request);
    const provided = String(request.headers['x-wacli-signature'] || '').trim();
    const expected = signatureFor(rawBody);
    if (!safeEqual(provided, expected)) {
      json(response, 401, { accepted: false, error: 'Invalid wacli signature' });
      return;
    }
    JSON.parse(rawBody.toString('utf8'));
    await persistWebhookEvent(rawBody, provided);
    json(response, 202, { accepted: true });
    queueMicrotask(() => flushWebhookOutbox().catch(() => undefined));
  } catch (error) {
    json(response, error?.statusCode || 400, { accepted: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleHealth(response) {
  json(response, 200, {
    ok: true,
    service: 'demac-whatsapp-wacli-bridge',
    startedAt,
    pendingWebhookEvents: await pendingWebhookCount(),
    lastForwardSuccessAt,
    lastForwardError,
    lastSendSuccessAt,
    lastSendError,
  });
}

requireConfiguration();
await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      await handleHealth(response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/send') {
      await handleSend(request, response);
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/events') {
      await handleWacliEvent(request, response);
      return;
    }
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`DEMAC wacli bridge listening on http://${HOST}:${PORT}`);
});

const retryTimer = setInterval(() => {
  flushWebhookOutbox().catch(() => undefined);
}, RETRY_INTERVAL_MS);
retryTimer.unref();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(retryTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
