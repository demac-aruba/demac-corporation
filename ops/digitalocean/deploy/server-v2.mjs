import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const WACLI_BINARY = process.env.WACLI_BINARY || 'wacli';
const WACLI_STORE_DIR = String(process.env.WACLI_STORE_DIR || '/var/lib/demac-wacli-test').trim();
const FFMPEG_BINARY = process.env.FFMPEG_BINARY || 'ffmpeg';
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || '').trim();
const WEBHOOK_SECRET = String(process.env.WACLI_WEBHOOK_SECRET || '').trim();
const FIREBASE_FUNCTIONS_BASE = 'https://us-central1-demac-corporation.cloudfunctions.net';
const ERP_WEBHOOK_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliWebhook`;
const MEDIA_INGEST_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliMediaIngest`;
const OUTBOUND_POLL_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliOutboundPoll`;
const OUTBOUND_ACK_URL = `${FIREBASE_FUNCTIONS_BASE}/wacliOutboundAck`;
const STATE_DIR = process.env.BRIDGE_STATE_DIR || '/var/lib/demac-whatsapp-bridge';
const OUTBOX_DIR = path.join(STATE_DIR, 'webhook-outbox');
const DEAD_LETTER_DIR = path.join(STATE_DIR, 'webhook-dead-letter');
const OUTBOUND_ACK_DIR = path.join(STATE_DIR, 'outbound-acks');
const TEMP_DIR = path.join(STATE_DIR, 'media-temp');
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const SEND_TIMEOUT_MS = Number(process.env.WACLI_SEND_TIMEOUT_MS || 60000);
const FORWARD_TIMEOUT_MS = Number(process.env.ERP_FORWARD_TIMEOUT_MS || 20000);
const RETRY_INTERVAL_MS = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS || 5000);
const MAX_WEBHOOK_ATTEMPTS = Math.max(2, Number(process.env.WEBHOOK_MAX_ATTEMPTS || 6));
const OUTBOUND_POLL_INTERVAL_MS = Math.max(1000, Number(process.env.WACLI_OUTBOUND_POLL_INTERVAL_MS || 2000));
const MEDIA_DOWNLOAD_ATTEMPTS = Math.max(1, Number(process.env.WACLI_MEDIA_DOWNLOAD_ATTEMPTS || 4));
const MEDIA_DOWNLOAD_RETRY_MS = Math.max(250, Number(process.env.WACLI_MEDIA_DOWNLOAD_RETRY_MS || 1500));
const IDENTITY_CACHE_MS = 12 * 60 * 60 * 1000;

let startedAt = new Date().toISOString();
let lastForwardSuccessAt = null;
let lastForwardError = null;
let lastDeadLetterAt = null;
let lastDeadLetterError = null;
let lastSendSuccessAt = null;
let lastSendError = null;
let lastMediaSuccessAt = null;
let lastMediaError = null;
let lastOutboundPollAt = null;
let lastOutboundAckAt = null;
let lastOutboundError = null;
let forwarding = false;
let outboundPolling = false;
const identityCache = new Map();

function requireConfiguration() {
  const missing = [];
  if (!BRIDGE_TOKEN) missing.push('BRIDGE_TOKEN');
  if (!WEBHOOK_SECRET) missing.push('WACLI_WEBHOOK_SECRET');
  if (!WACLI_STORE_DIR) missing.push('WACLI_STORE_DIR');
  if (missing.length) throw new Error(`Missing bridge configuration: ${missing.join(', ')}`);
}

function safeEqual(left, right) {
  const first = Buffer.from(String(left || ''));
  const second = Buffer.from(String(right || ''));
  return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second);
}

function wacliSignatureFor(rawBody) {
  return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`;
}

function shouldIgnoreInboundPayload(payload) {
  if (payload?.EventType) return false;
  const chat = String(payload?.Chat || '').trim().toLowerCase();
  return chat === 'status@broadcast';
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function digitsOnly(value) { return String(value || '').replace(/\D/g, ''); }
function validPhone(value) { const phone = digitsOnly(value); return /^\d{8,15}$/.test(phone) ? phone : ''; }
function safeName(value, fallback = 'file') {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || fallback;
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
  if (/@/.test(recipient) && !/@(s\.whatsapp\.net|lid|g\.us|newsletter)$/.test(recipient)) throw new Error('Unsupported WhatsApp JID.');
  if (!/@/.test(recipient) && !/^\+?[0-9() .-]{8,24}$/.test(recipient)) throw new Error('Recipient must be a phone number or supported WhatsApp JID.');
  return recipient;
}

function parseJsonOutput(stdout) {
  const text = String(stdout || '').trim();
  if (!text) return null;
  const parsed = JSON.parse(text);
  if (parsed?.success === false) throw new Error(parsed?.error?.message || parsed?.error || 'wacli command failed.');
  return parsed?.data ?? parsed;
}

async function runWacliJson(args, options = {}) {
  const prefix = ['--store', WACLI_STORE_DIR, '--json'];
  if (options.readOnly) prefix.push('--read-only');
  const { stdout } = await execFileAsync(WACLI_BINARY, [...prefix, ...args], {
    timeout: options.timeout || SEND_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
    env: process.env,
    windowsHide: true,
  });
  return parseJsonOutput(stdout);
}

function normalizeWacliSendResult(value) {
  const data = value?.data && typeof value.data === 'object' ? value.data : value;
  if (value?.success === false || data?.success === false) throw new Error(value?.error?.message || data?.error?.message || 'wacli reported an unsuccessful send.');
  if (!(data?.sent === true || value?.success === true)) throw new Error('wacli did not confirm that WhatsApp accepted the send request.');
  return {
    sent: true,
    messageId: data?.id || data?.message_id || data?.messageId || null,
    storeWarning: data?.store_warning || value?.store_warning || null,
  };
}

function collectStrings(value, pathParts = [], out = []) {
  if (typeof value === 'string') out.push({ key: pathParts.join('.').toLowerCase(), value });
  else if (Array.isArray(value)) value.forEach((item, index) => collectStrings(item, [...pathParts, String(index)], out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => collectStrings(item, [...pathParts, key], out));
  return out;
}

function collectNumbers(value, pathParts = [], out = []) {
  if (typeof value === 'number' && Number.isFinite(value)) out.push({ key: pathParts.join('.').toLowerCase(), value });
  else if (Array.isArray(value)) value.forEach((item, index) => collectNumbers(item, [...pathParts, String(index)], out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => collectNumbers(item, [...pathParts, key], out));
  return out;
}

function firstString(entries, patterns) {
  for (const pattern of patterns) {
    const found = entries.find((entry) => pattern.test(entry.key) && entry.value);
    if (found) return found.value;
  }
  return '';
}

function mediaKindFromDetail(detail) {
  const strings = collectStrings(detail);
  const candidate = firstString(strings, [/media[_\.]?type$/, /content[_\.]?type$/, /message[_\.]?type$/, /\.type$/]).toLowerCase();
  if (candidate.includes('sticker')) return 'sticker';
  if (candidate.includes('image')) return 'image';
  if (candidate.includes('video') || candidate.includes('gif')) return 'video';
  if (candidate.includes('audio') || candidate.includes('ptt') || candidate.includes('voice')) return candidate.includes('ptt') || candidate.includes('voice') ? 'voice' : 'audio';
  if (candidate.includes('document') || candidate.includes('file')) return 'document';
  const mime = firstString(strings, [/mime/]).toLowerCase();
  if (mime.startsWith('image/webp') && strings.some((entry) => /sticker/.test(entry.key))) return 'sticker';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime) return 'document';
  return null;
}

function extractMediaMeta(detail, kind) {
  const strings = collectStrings(detail);
  const numbers = collectNumbers(detail);
  const mimeType = firstString(strings, [/mime/]) || 'application/octet-stream';
  const fileName = firstString(strings, [/file[_\.]?name$/, /filename$/, /name$/]) || `whatsapp-${kind}`;
  const caption = firstString(strings, [/caption$/]);
  const duration = numbers.find((entry) => /duration/.test(entry.key))?.value ?? null;
  const width = numbers.find((entry) => /width/.test(entry.key))?.value ?? null;
  const height = numbers.find((entry) => /height/.test(entry.key))?.value ?? null;
  return { kind, mimeType, fileName, caption, durationSeconds: duration, width, height };
}

function extensionFor(meta) {
  const nameExt = path.extname(meta.fileName || '').slice(1);
  if (nameExt && nameExt.length <= 8) return nameExt;
  const mime = String(meta.mimeType || '').toLowerCase();
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('pdf')) return 'pdf';
  return 'bin';
}

async function resolveIdentity(chat, detail) {
  const sourceChat = String(chat || '').trim();
  if (sourceChat.endsWith('@s.whatsapp.net')) {
    return { ResolvedPhone: validPhone(sourceChat.split('@')[0]), CanonicalJid: sourceChat, WhatsAppLid: null };
  }
  if (!sourceChat.endsWith('@lid')) return {};
  const cached = identityCache.get(sourceChat);
  if (cached && Date.now() - cached.at < IDENTITY_CACHE_MS) return cached.value;

  const strings = collectStrings(detail);
  let canonical = strings.find((entry) => entry.value.endsWith('@s.whatsapp.net') && validPhone(entry.value.split('@')[0]))?.value || '';
  if (!canonical) {
    try {
      const shown = await runWacliJson(['chats', 'show', '--jid', sourceChat], { readOnly: true, timeout: 15000 });
      canonical = collectStrings(shown).find((entry) => entry.value.endsWith('@s.whatsapp.net') && validPhone(entry.value.split('@')[0]))?.value || '';
    } catch {
      // Fall through to the bounded chat-list compatibility lookup.
    }
  }
  if (!canonical) {
    try {
      const chats = await runWacliJson(['chats', 'list', '--limit', '2000'], { readOnly: true, timeout: 15000 });
      const rows = Array.isArray(chats) ? chats : Array.isArray(chats?.chats) ? chats.chats : Array.isArray(chats?.items) ? chats.items : [];
      const match = rows.find((row) => JSON.stringify(row).includes(sourceChat));
      if (match) canonical = collectStrings(match).find((entry) => entry.value.endsWith('@s.whatsapp.net') && validPhone(entry.value.split('@')[0]))?.value || '';
    } catch {
      // Keep the LID unresolved rather than fabricating a phone number.
    }
  }
  const value = {
    ResolvedPhone: canonical ? validPhone(canonical.split('@')[0]) : null,
    CanonicalJid: canonical || null,
    WhatsAppLid: sourceChat,
  };
  if (canonical) identityCache.set(sourceChat, { at: Date.now(), value });
  return value;
}

async function storageChatForPayload(payload) {
  const sourceChat = String(payload?.Chat || '').trim();
  if (!sourceChat.endsWith('@lid')) return sourceChat;
  const provided = String(payload?.CanonicalJid || '').trim();
  if (provided.endsWith('@s.whatsapp.net') && validPhone(provided.split('@')[0])) return provided;
  const resolved = await resolveIdentity(sourceChat, null);
  const canonical = String(resolved?.CanonicalJid || '').trim();
  if (canonical.endsWith('@s.whatsapp.net') && validPhone(canonical.split('@')[0])) return canonical;
  throw new Error('Unable to resolve WhatsApp LID to its canonical store JID.');
}

async function enrichIncomingPayload(payload) {
  if (payload.EventType) return payload;
  const chat = String(payload.Chat || '');
  const id = String(payload.ID || '');
  if (!chat || !id) return payload;

  let identity = await resolveIdentity(chat, null).catch(() => ({}));
  let storageChat = String(identity?.CanonicalJid || chat).trim();
  let detail = null;
  try {
    detail = await runWacliJson(['messages', 'show', '--chat', storageChat, '--id', id], { readOnly: true, timeout: 15000 });
  } catch {
    // Text delivery must never depend on optional enrichment.
  }

  if (!identity?.CanonicalJid && detail) identity = await resolveIdentity(chat, detail).catch(() => identity);
  if (identity?.CanonicalJid) storageChat = String(identity.CanonicalJid);
  const enriched = { ...payload, ...identity };
  const kind = detail ? mediaKindFromDetail(detail) : null;
  if (kind) enriched.Media = extractMediaMeta(detail, kind);
  return enriched;
}

function tempFileName(media) {
  return path.join(TEMP_DIR, `${Date.now()}-${crypto.randomUUID()}-${safeName(media.fileName || `media.${extensionFor(media)}`)}`);
}

async function downloadOutboundMedia(media) {
  if (!media?.url || !/^https:\/\//i.test(media.url)) throw new Error('Outbound media requires a signed HTTPS URL.');
  const response = await fetch(media.url, { signal: AbortSignal.timeout(60000), redirect: 'error' });
  if (!response.ok) throw new Error(`Media download returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0);
  if (length && length > MAX_MEDIA_BYTES) throw new Error('Outbound media is too large.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('Outbound media is too large.');
  await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
  const filePath = tempFileName(media);
  await fs.writeFile(filePath, buffer, { mode: 0o600 });
  return filePath;
}

async function ensureVoiceOgg(filePath, mimeType) {
  if (/audio\/(ogg|opus)/i.test(String(mimeType || '')) || /\.ogg$/i.test(filePath)) return filePath;
  const output = `${filePath}.ogg`;
  await execFileAsync(FFMPEG_BINARY, ['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', output], {
    timeout: 90000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return output;
}

async function sendItem({ to, text, media }) {
  if (!media) {
    return normalizeWacliSendResult(await runWacliJson([
      '--timeout', `${Math.ceil(SEND_TIMEOUT_MS / 1000)}s`,
      'send', 'text', '--to', to, '--message', text, '--no-preview', '--post-send-wait', '2s',
    ], { timeout: SEND_TIMEOUT_MS + 5000 }));
  }

  let source = await downloadOutboundMedia(media);
  let converted = '';
  try {
    let args;
    if (media.kind === 'voice') {
      converted = await ensureVoiceOgg(source, media.mimeType);
      args = ['send', 'voice', '--to', to, '--file', converted, '--mime', 'audio/ogg; codecs=opus', '--post-send-wait', '2s'];
    } else if (media.kind === 'sticker') {
      args = ['send', 'sticker', '--to', to, '--file', source, '--post-send-wait', '2s'];
    } else {
      args = ['send', 'file', '--to', to, '--file', source, '--as', media.kind === 'audio' ? 'audio' : media.kind, '--post-send-wait', '2s'];
      if (text) args.push('--caption', text);
      if (media.fileName) args.push('--filename', media.fileName);
      if (media.mimeType) args.push('--mime', media.mimeType);
    }
    return normalizeWacliSendResult(await runWacliJson(args, { timeout: SEND_TIMEOUT_MS + 35000 }));
  } finally {
    await fs.unlink(source).catch(() => undefined);
    if (converted && converted !== source) await fs.unlink(converted).catch(() => undefined);
  }
}

function outboxFileName() {
  return `${Date.now().toString().padStart(13, '0')}-${crypto.randomUUID()}.json`;
}

async function atomicWriteJson(finalPath, payload) {
  const temporary = `${finalPath}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(payload), { mode: 0o600 });
  await fs.rename(temporary, finalPath);
}

async function persistWebhookEvent(rawBody) {
  await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });
  const filename = outboxFileName();
  const finalPath = path.join(OUTBOX_DIR, filename);
  await atomicWriteJson(finalPath, {
    receivedAt: new Date().toISOString(),
    attempts: 0,
    bodyBase64: rawBody.toString('base64'),
  });
  return finalPath;
}

async function rewriteWebhookRecord(filePath, record, rawBody) {
  await atomicWriteJson(filePath, { ...record, bodyBase64: rawBody.toString('base64') });
}

function compactError(error, maxLength = 500) {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, maxLength);
}

function transientWebhookError(error) {
  if (error?.transient === true) return true;
  const status = Number(error?.statusCode || 0);
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

async function recordWebhookFailure(filePath, error) {
  const record = JSON.parse(await fs.readFile(filePath, 'utf8'));
  const attempts = Math.max(0, Number(record.attempts || 0)) + 1;
  const errorMessage = compactError(error);
  const updated = {
    ...record,
    attempts,
    lastAttemptAt: new Date().toISOString(),
    lastError: errorMessage,
  };

  if (transientWebhookError(error) || attempts < MAX_WEBHOOK_ATTEMPTS) {
    await atomicWriteJson(filePath, updated);
    return 'retry';
  }

  await fs.mkdir(DEAD_LETTER_DIR, { recursive: true, mode: 0o700 });
  const deadLetterPath = path.join(DEAD_LETTER_DIR, path.basename(filePath));
  await atomicWriteJson(deadLetterPath, {
    ...updated,
    deadLetteredAt: new Date().toISOString(),
  });
  await fs.unlink(filePath);
  lastDeadLetterAt = new Date().toISOString();
  lastDeadLetterError = errorMessage;
  return 'quarantined';
}

function mediaField(media, ...names) {
  for (const name of names) {
    if (media?.[name] !== undefined && media?.[name] !== null && String(media[name]).trim() !== '') return media[name];
  }
  return null;
}

async function downloadInboundMedia(chat, messageId) {
  await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
  const output = path.join(TEMP_DIR, `inbound-${safeName(messageId, crypto.randomUUID())}`);
  let downloadError = null;
  try {
    for (let attempt = 1; attempt <= MEDIA_DOWNLOAD_ATTEMPTS; attempt += 1) {
      await fs.unlink(output).catch(() => undefined);
      try {
        await execFileAsync(WACLI_BINARY, [
          '--store', WACLI_STORE_DIR, '--read-only', 'media', 'download',
          '--chat', chat, '--id', messageId, '--output', output,
        ], {
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
          env: process.env,
          windowsHide: true,
        });
        downloadError = null;
        break;
      } catch (error) {
        downloadError = error;
        if (attempt < MEDIA_DOWNLOAD_ATTEMPTS) await sleep(MEDIA_DOWNLOAD_RETRY_MS * attempt);
      }
    }
    if (downloadError) throw downloadError;
    const buffer = await fs.readFile(output);
    if (!buffer.length) throw new Error('Downloaded WhatsApp media is empty.');
    if (buffer.length > MAX_MEDIA_BYTES) throw new Error('WhatsApp media exceeds the 25 MB connector limit.');
    return buffer;
  } finally {
    await fs.unlink(output).catch(() => undefined);
  }
}

async function uploadInboundMedia(payload) {
  const media = payload?.Media;
  if (!media || typeof media !== 'object') return payload;
  const existingUrl = String(media.mediaUrl || media.url || '').trim();
  if (existingUrl) return payload;

  const chat = String(payload.Chat || '').trim();
  const messageId = String(payload.ID || '').trim();
  if (!chat || !messageId) throw new Error('Inbound media requires Chat and ID before forwarding.');

  try {
    const storageChat = await storageChatForPayload(payload);
    const bytes = await downloadInboundMedia(storageChat, messageId);
    const fileName = String(mediaField(media, 'Filename', 'filename', 'fileName') || '').trim();
    const mediaType = String(mediaField(media, 'Type', 'type', 'kind') || '').trim().toLowerCase();
    const mimeType = String(mediaField(media, 'MimeType', 'mimeType', 'mime_type') || 'application/octet-stream').trim();
    const endpoint = new URL(MEDIA_INGEST_URL);
    endpoint.searchParams.set('chat', chat);
    endpoint.searchParams.set('messageId', messageId);
    if (fileName) endpoint.searchParams.set('fileName', fileName);
    if (mediaType) endpoint.searchParams.set('mediaType', mediaType);

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${BRIDGE_TOKEN}`,
          'Content-Type': mimeType || 'application/octet-stream',
        },
        body: bytes,
        signal: AbortSignal.timeout(120000),
      });
    } catch (error) {
      error.transient = true;
      throw error;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true || !body?.mediaUrl) {
      const error = new Error(body?.error || `Firebase media ingest returned HTTP ${response.status}`);
      error.statusCode = response.status;
      error.transient = response.status === 408 || response.status === 429 || response.status >= 500;
      throw error;
    }

    const resolvedMime = String(body.mediaMimeType || mimeType || 'application/octet-stream');
    const resolvedSize = Number(body.mediaSize || bytes.length);
    lastMediaSuccessAt = new Date().toISOString();
    lastMediaError = null;
    return {
      ...payload,
      Media: {
        ...media,
        mediaUrl: body.mediaUrl,
        url: body.mediaUrl,
        MimeType: resolvedMime,
        mimeType: resolvedMime,
        FileLength: resolvedSize,
        size: resolvedSize,
      },
    };
  } catch (error) {
    lastMediaError = compactError(error, 300);
    throw error;
  }
}

async function forwardRecord(filePath) {
  const record = JSON.parse(await fs.readFile(filePath, 'utf8'));
  let rawBody = Buffer.from(record.bodyBase64, 'base64');
  let payload = JSON.parse(rawBody.toString('utf8'));

  if (shouldIgnoreInboundPayload(payload)) {
    await fs.unlink(filePath);
    lastForwardError = null;
    return true;
  }

  if (!payload.EventType && payload.Media && !(payload.Media.mediaUrl || payload.Media.url)) {
    payload = await uploadInboundMedia(payload);
    rawBody = Buffer.from(JSON.stringify(payload));
    await rewriteWebhookRecord(filePath, record, rawBody);
  }

  let response;
  try {
    response = await fetch(ERP_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${BRIDGE_TOKEN}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS),
    });
  } catch (error) {
    error.transient = true;
    throw error;
  }
  if (!response.ok) {
    const error = new Error(`ERP webhook returned HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
    error.statusCode = response.status;
    error.transient = response.status === 408 || response.status === 429 || response.status >= 500;
    throw error;
  }
  await fs.unlink(filePath);
  lastForwardSuccessAt = new Date().toISOString();
  lastForwardError = null;
  return true;
}

async function flushWebhookOutbox() {
  if (forwarding) return;
  forwarding = true;
  try {
    await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });
    const files = (await fs.readdir(OUTBOX_DIR)).filter((name) => name.endsWith('.json')).sort().slice(0, 100);
    for (const filename of files) {
      const filePath = path.join(OUTBOX_DIR, filename);
      try {
        await forwardRecord(filePath);
      } catch (error) {
        const errorMessage = compactError(error);
        lastForwardError = errorMessage;
        const outcome = await recordWebhookFailure(filePath, error);
        if (outcome === 'quarantined') {
          lastForwardError = null;
          continue;
        }
        break;
      }
    }
  } finally {
    forwarding = false;
  }
}

async function pendingJsonCount(directory) {
  try {
    return (await fs.readdir(directory)).filter((name) => name.endsWith('.json')).length;
  } catch {
    return 0;
  }
}

async function pendingWebhookCount() {
  return pendingJsonCount(OUTBOX_DIR);
}

async function pendingDeadLetterCount() {
  return pendingJsonCount(DEAD_LETTER_DIR);
}

async function pendingOutboundAckCount() {
  return pendingJsonCount(OUTBOUND_ACK_DIR);
}

async function persistOutboundAck(payload) {
  await fs.mkdir(OUTBOUND_ACK_DIR, { recursive: true, mode: 0o700 });
  const filePath = path.join(OUTBOUND_ACK_DIR, `${Date.now().toString().padStart(13, '0')}-${safeName(payload.queueId, crypto.randomUUID())}.json`);
  await atomicWriteJson(filePath, payload);
  return filePath;
}

async function postFirebaseJson(endpoint, payload, timeout = 30000) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${BRIDGE_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeout),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error || `Firebase connector returned HTTP ${response.status}`);
    error.statusCode = response.status;
    throw error;
  }
  return body;
}

async function flushOutboundAcks() {
  await fs.mkdir(OUTBOUND_ACK_DIR, { recursive: true, mode: 0o700 });
  const files = (await fs.readdir(OUTBOUND_ACK_DIR)).filter((name) => name.endsWith('.json')).sort();
  for (const filename of files) {
    const filePath = path.join(OUTBOUND_ACK_DIR, filename);
    const payload = JSON.parse(await fs.readFile(filePath, 'utf8'));
    await postFirebaseJson(OUTBOUND_ACK_URL, payload, 60000);
    await fs.unlink(filePath);
    lastOutboundAckAt = new Date().toISOString();
    lastOutboundError = null;
  }
  return true;
}

async function pollOutboundCommand() {
  const body = await postFirebaseJson(OUTBOUND_POLL_URL, { bridgeId: os.hostname() }, 30000);
  lastOutboundPollAt = new Date().toISOString();
  lastOutboundError = null;
  return body?.command || null;
}

async function processOutboundCycle() {
  if (outboundPolling) return;
  outboundPolling = true;
  try {
    await flushOutboundAcks();
    const command = await pollOutboundCommand();
    if (!command) return;

    const queueId = String(command.queueId || '').trim();
    const claimToken = String(command.claimToken || '').trim();
    if (!queueId || !claimToken) throw new Error('Firebase returned an outbound command without queueId/claimToken.');

    let ack;
    try {
      const to = validateRecipient(command.to);
      const textValue = String(command.text || '');
      const media = command.media && typeof command.media === 'object' ? command.media : null;
      if (!textValue.trim() && !media) throw new Error('Outbound command contains neither text nor media.');
      const result = await sendItem({ to, text: textValue, media });
      lastSendSuccessAt = new Date().toISOString();
      lastSendError = null;
      ack = {
        queueId,
        claimToken,
        sent: true,
        messageId: result.messageId || null,
        storeWarning: result.storeWarning || null,
      };
    } catch (error) {
      lastSendError = error instanceof Error ? error.message : String(error);
      ack = { queueId, claimToken, sent: false, error: lastSendError };
    }

    await persistOutboundAck(ack);
    await flushOutboundAcks();
  } catch (error) {
    lastOutboundError = compactError(error, 400);
  } finally {
    outboundPolling = false;
  }
}

async function handleWacliEvent(request, response) {
  try {
    const rawBody = await readBody(request);
    const provided = String(request.headers['x-wacli-signature'] || '').trim();
    if (!safeEqual(provided, wacliSignatureFor(rawBody))) {
      json(response, 401, { accepted: false, error: 'Invalid wacli signature' });
      return;
    }

    const original = JSON.parse(rawBody.toString('utf8'));
    if (shouldIgnoreInboundPayload(original)) {
      json(response, 202, { accepted: true, ignored: true, reason: 'status-broadcast' });
      return;
    }
    const enriched = await enrichIncomingPayload(original);
    const enrichedRaw = Buffer.from(JSON.stringify(enriched));
    await persistWebhookEvent(enrichedRaw);
    json(response, 202, { accepted: true });
    queueMicrotask(() => flushWebhookOutbox().catch(() => undefined));
  } catch (error) {
    json(response, error?.statusCode || 400, { accepted: false, error: error instanceof Error ? error.message : String(error) });
  }
}

async function handleHealth(response) {
  json(response, 200, {
    ok: true,
    service: 'demac-whatsapp-wacli-bridge-v2',
    bridgeAuth: 'bearer-v1',
    connectorMode: 'outbound-only-v1',
    erpWebhookUrl: ERP_WEBHOOK_URL,
    mediaIngestUrl: MEDIA_INGEST_URL,
    outboundPollUrl: OUTBOUND_POLL_URL,
    wacliStoreDir: WACLI_STORE_DIR,
    startedAt,
    hostname: os.hostname(),
    pendingWebhookEvents: await pendingWebhookCount(),
    pendingDeadLetterEvents: await pendingDeadLetterCount(),
    identityCache: identityCache.size,
    lastForwardSuccessAt,
    lastForwardError,
    lastDeadLetterAt,
    lastDeadLetterError,
    lastSendSuccessAt,
    lastSendError,
    lastMediaSuccessAt,
    lastMediaError,
    pendingOutboundAcks: await pendingOutboundAckCount(),
    lastOutboundPollAt,
    lastOutboundAckAt,
    lastOutboundError,
  });
}

requireConfiguration();
await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 });
await fs.mkdir(DEAD_LETTER_DIR, { recursive: true, mode: 0o700 });
await fs.mkdir(OUTBOUND_ACK_DIR, { recursive: true, mode: 0o700 });
await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') return await handleHealth(response);
    if (request.method === 'POST' && url.pathname === '/v1/events') return await handleWacliEvent(request, response);
    json(response, 404, { error: 'Not found' });
  } catch (error) {
    json(response, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, HOST, () => console.log(`DEMAC wacli bridge v2 listening on http://${HOST}:${PORT}`));
const retryTimer = setInterval(() => flushWebhookOutbox().catch(() => undefined), RETRY_INTERVAL_MS);
retryTimer.unref();
const outboundTimer = setInterval(() => processOutboundCycle().catch(() => undefined), OUTBOUND_POLL_INTERVAL_MS);
outboundTimer.unref();
queueMicrotask(() => processOutboundCycle().catch(() => undefined));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    clearInterval(retryTimer);
    clearInterval(outboundTimer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  });
}
