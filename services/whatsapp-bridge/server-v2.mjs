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
const FFMPEG_BINARY = process.env.FFMPEG_BINARY || 'ffmpeg';
const BRIDGE_TOKEN = String(process.env.BRIDGE_TOKEN || '').trim();
const WEBHOOK_SECRET = String(process.env.WACLI_WEBHOOK_SECRET || '').trim();
const ERP_WEBHOOK_URL = String(process.env.ERP_WEBHOOK_URL || '').trim();
const STATE_DIR = process.env.BRIDGE_STATE_DIR || '/var/lib/demac-whatsapp-bridge';
const OUTBOX_DIR = path.join(STATE_DIR, 'webhook-outbox');
const TEMP_DIR = path.join(STATE_DIR, 'media-temp');
const MAX_BODY_BYTES = 256 * 1024;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const SEND_TIMEOUT_MS = Number(process.env.WACLI_SEND_TIMEOUT_MS || 60000);
const FORWARD_TIMEOUT_MS = Number(process.env.ERP_FORWARD_TIMEOUT_MS || 20000);
const RETRY_INTERVAL_MS = Number(process.env.WEBHOOK_RETRY_INTERVAL_MS || 5000);
const IDENTITY_CACHE_MS = 12 * 60 * 60 * 1000;
const AVATAR_CACHE_MS = 24 * 60 * 60 * 1000;

let startedAt = new Date().toISOString();
let lastForwardSuccessAt = null;
let lastForwardError = null;
let lastSendSuccessAt = null;
let lastSendError = null;
let forwarding = false;
const identityCache = new Map();
const avatarCache = new Map();

function requireConfiguration() {
  const missing = [];
  if (!BRIDGE_TOKEN) missing.push('BRIDGE_TOKEN');
  if (!WEBHOOK_SECRET) missing.push('WACLI_WEBHOOK_SECRET');
  if (!/^https:\/\//i.test(ERP_WEBHOOK_URL)) missing.push('ERP_WEBHOOK_URL (HTTPS)');
  if (missing.length) throw new Error(`Missing bridge configuration: ${missing.join(', ')}`);
}
function safeEqual(left, right) { const first = Buffer.from(String(left || '')); const second = Buffer.from(String(right || '')); return first.length === second.length && first.length > 0 && crypto.timingSafeEqual(first, second); }
function signatureFor(rawBody) { return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')}`; }
function authorized(request) { const header = String(request.headers.authorization || ''); return header.startsWith('Bearer ') && safeEqual(header.slice(7).trim(), BRIDGE_TOKEN); }
function json(response, status, payload) { const body = JSON.stringify(payload); response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }); response.end(body); }
function digitsOnly(value) { return String(value || '').replace(/\D/g, ''); }
function validPhone(value) { const phone = digitsOnly(value); return /^\d{8,15}$/.test(phone) ? phone : ''; }
function safeName(value, fallback = 'file') { return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || fallback; }

async function readBody(request) {
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > MAX_BODY_BYTES) { const error = new Error('Request body is too large.'); error.statusCode = 413; throw error; } chunks.push(chunk); }
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
  const text = String(stdout || '').trim(); if (!text) return null;
  const parsed = JSON.parse(text); if (parsed?.success === false) throw new Error(parsed?.error?.message || parsed?.error || 'wacli command failed.');
  return parsed?.data ?? parsed;
}
async function runWacliJson(args, options = {}) {
  const prefix = ['--json']; if (options.readOnly) prefix.push('--read-only');
  const { stdout } = await execFileAsync(WACLI_BINARY, [...prefix, ...args], { timeout: options.timeout || SEND_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: process.env, windowsHide: true });
  return parseJsonOutput(stdout);
}
function normalizeWacliSendResult(value) {
  const data = value?.data && typeof value.data === 'object' ? value.data : value;
  if (value?.success === false || data?.success === false) throw new Error(value?.error?.message || data?.error?.message || 'wacli reported an unsuccessful send.');
  if (!(data?.sent === true || value?.success === true)) throw new Error('wacli did not confirm that WhatsApp accepted the send request.');
  return { sent: true, messageId: data?.id || data?.message_id || data?.messageId || null, storeWarning: data?.store_warning || value?.store_warning || null };
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
function firstString(entries, patterns) { for (const pattern of patterns) { const found = entries.find((entry) => pattern.test(entry.key) && entry.value); if (found) return found.value; } return ''; }
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
  if (mime.startsWith('image/')) return 'image'; if (mime.startsWith('video/')) return 'video'; if (mime.startsWith('audio/')) return 'audio'; if (mime) return 'document';
  return null;
}
function extractMediaMeta(detail, kind) {
  const strings = collectStrings(detail); const numbers = collectNumbers(detail);
  const mimeType = firstString(strings, [/mime/]) || 'application/octet-stream';
  const fileName = firstString(strings, [/file[_\.]?name$/, /filename$/, /name$/]) || `whatsapp-${kind}`;
  const caption = firstString(strings, [/caption$/]);
  const duration = numbers.find((entry) => /duration/.test(entry.key))?.value ?? null;
  const width = numbers.find((entry) => /width/.test(entry.key))?.value ?? null;
  const height = numbers.find((entry) => /height/.test(entry.key))?.value ?? null;
  return { kind, mimeType, fileName, caption, durationSeconds: duration, width, height };
}
function extensionFor(meta) {
  const nameExt = path.extname(meta.fileName || '').slice(1); if (nameExt && nameExt.length <= 8) return nameExt;
  const mime = String(meta.mimeType || '').toLowerCase();
  if (mime.includes('webp')) return 'webp'; if (mime.includes('jpeg')) return 'jpg'; if (mime.includes('png')) return 'png'; if (mime.includes('gif')) return 'gif'; if (mime.includes('ogg')) return 'ogg'; if (mime.includes('webm')) return 'webm'; if (mime.includes('mpeg')) return 'mp3'; if (mime.includes('mp4')) return 'mp4'; if (mime.includes('pdf')) return 'pdf'; return 'bin';
}

async function uploadTicketUrl() { const url = new URL(ERP_WEBHOOK_URL); url.pathname = url.pathname.replace(/wacliWebhook\/?$/, 'wacliMediaUploadTicket'); return url.toString(); }
async function requestUploadTicket(metadata) {
  const raw = Buffer.from(JSON.stringify(metadata));
  const response = await fetch(await uploadTicketUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': signatureFor(raw) }, body: raw, signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true || !data.uploadUrl || !data.storagePath) throw new Error(data?.error || `Media ticket returned HTTP ${response.status}`);
  return data;
}
async function uploadBufferToStorage(buffer, metadata) {
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('WhatsApp media exceeds bridge upload limit.');
  const ticket = await requestUploadTicket({ ...metadata, size: buffer.length });
  const response = await fetch(ticket.uploadUrl, { method: 'PUT', headers: { 'Content-Type': ticket.contentType || metadata.contentType || 'application/octet-stream' }, body: buffer, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Cloud Storage upload returned HTTP ${response.status}`);
  return ticket.storagePath;
}

async function resolveIdentity(chat, detail) {
  if (String(chat).endsWith('@s.whatsapp.net')) return { ResolvedPhone: validPhone(String(chat).split('@')[0]), CanonicalJid: chat, WhatsAppLid: null };
  if (!String(chat).endsWith('@lid')) return {};
  const cached = identityCache.get(chat); if (cached && Date.now() - cached.at < IDENTITY_CACHE_MS) return cached.value;
  const strings = collectStrings(detail);
  let canonical = strings.find((entry) => entry.value.endsWith('@s.whatsapp.net') && validPhone(entry.value.split('@')[0]))?.value || '';
  if (!canonical) {
    try {
      const chats = await runWacliJson(['chats', 'list', '--limit', '2000'], { readOnly: true, timeout: 15000 });
      const rows = Array.isArray(chats) ? chats : Array.isArray(chats?.chats) ? chats.chats : Array.isArray(chats?.items) ? chats.items : [];
      const match = rows.find((row) => JSON.stringify(row).includes(chat));
      if (match) canonical = collectStrings(match).find((entry) => entry.value.endsWith('@s.whatsapp.net') && validPhone(entry.value.split('@')[0]))?.value || '';
    } catch { /* keep unresolved rather than fabricating a phone */ }
  }
  const value = { ResolvedPhone: canonical ? validPhone(canonical.split('@')[0]) : null, CanonicalJid: canonical || null, WhatsAppLid: chat };
  identityCache.set(chat, { at: Date.now(), value }); return value;
}

async function enrichProfilePicture(chat, conversationId) {
  if (!chat || chat.endsWith('@g.us') || chat.endsWith('@newsletter')) return null;
  const cached = avatarCache.get(chat); if (cached && Date.now() - cached.at < AVATAR_CACHE_MS) return cached.value;
  try {
    const data = await runWacliJson(['profile', 'picture-info', '--jid', chat], { timeout: 20000 });
    const strings = collectStrings(data);
    const imageUrl = strings.find((entry) => /url/.test(entry.key) && /^https:\/\//i.test(entry.value))?.value;
    if (!imageUrl) { avatarCache.set(chat, { at: Date.now(), value: null }); return null; }
    const response = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) }); if (!response.ok) throw new Error(`Profile image returned ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const storagePath = await uploadBufferToStorage(buffer, { scope: 'avatar', identity: chat, conversationId, messageId: `avatar-${Date.now()}`, contentType, fileName: `profile.${contentType.includes('png') ? 'png' : 'jpg'}`, kind: 'image' });
    const value = { storagePath, updatedAt: new Date().toISOString() }; avatarCache.set(chat, { at: Date.now(), value }); return value;
  } catch { avatarCache.set(chat, { at: Date.now(), value: null }); return null; }
}

async function enrichIncomingPayload(payload) {
  if (payload.EventType) return payload;
  const chat = String(payload.Chat || ''); const id = String(payload.ID || '');
  if (!chat || !id) return payload;
  let detail = null;
  try { detail = await runWacliJson(['messages', 'show', '--chat', chat, '--id', id], { readOnly: true, timeout: 15000 }); } catch { /* text delivery must never depend on enrichment */ }
  const identity = await resolveIdentity(chat, detail).catch(() => ({}));
  const enriched = { ...payload, ...identity };
  const kind = detail ? mediaKindFromDetail(detail) : null;
  if (kind) {
    const meta = extractMediaMeta(detail, kind);
    const output = path.join(TEMP_DIR, `${safeName(id, crypto.randomUUID())}.${extensionFor(meta)}`);
    try {
      await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
      await execFileAsync(WACLI_BINARY, ['--read-only', 'media', 'download', '--chat', chat, '--id', id, '--output', output], { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: process.env, windowsHide: true });
      const buffer = await fs.readFile(output);
      const storagePath = await uploadBufferToStorage(buffer, { scope: 'inbound', conversationId: chat, messageId: id, contentType: meta.mimeType, fileName: meta.fileName, kind });
      enriched.Media = { ...meta, storagePath, size: buffer.length };
    } catch (error) {
      enriched.Media = { ...meta, storagePath: null, syncError: error instanceof Error ? error.message : String(error) };
    } finally { await fs.unlink(output).catch(() => undefined); }
  }
  const avatar = await enrichProfilePicture(chat, chat).catch(() => null); if (avatar) enriched.ProfilePicture = avatar;
  return enriched;
}

function tempFileName(media) { return path.join(TEMP_DIR, `${Date.now()}-${crypto.randomUUID()}-${safeName(media.fileName || `media.${extensionFor(media)}`)}`); }
async function downloadOutboundMedia(media) {
  if (!media?.url || !/^https:\/\//i.test(media.url)) throw new Error('Outbound media requires a signed HTTPS URL.');
  const response = await fetch(media.url, { signal: AbortSignal.timeout(60000), redirect: 'error' }); if (!response.ok) throw new Error(`Media download returned HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') || 0); if (length && length > MAX_MEDIA_BYTES) throw new Error('Outbound media is too large.');
  const buffer = Buffer.from(await response.arrayBuffer()); if (buffer.length > MAX_MEDIA_BYTES) throw new Error('Outbound media is too large.');
  await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 }); const filePath = tempFileName(media); await fs.writeFile(filePath, buffer, { mode: 0o600 }); return filePath;
}
async function ensureVoiceOgg(filePath, mimeType) {
  if (/audio\/(ogg|opus)/i.test(String(mimeType || '')) || /\.ogg$/i.test(filePath)) return filePath;
  const output = `${filePath}.ogg`;
  await execFileAsync(FFMPEG_BINARY, ['-y', '-i', filePath, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '64k', output], { timeout: 90000, maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  return output;
}
async function sendItem({ to, text, media }) {
  if (!media) return normalizeWacliSendResult(await runWacliJson(['--timeout', `${Math.ceil(SEND_TIMEOUT_MS / 1000)}s`, 'send', 'text', '--to', to, '--message', text, '--no-preview', '--post-send-wait', '2s'], { timeout: SEND_TIMEOUT_MS + 5000 }));
  let source = await downloadOutboundMedia(media); let converted = '';
  try {
    let args;
    if (media.kind === 'voice') { converted = await ensureVoiceOgg(source, media.mimeType); args = ['send', 'voice', '--to', to, '--file', converted, '--mime', 'audio/ogg; codecs=opus', '--post-send-wait', '2s']; }
    else if (media.kind === 'sticker') args = ['send', 'sticker', '--to', to, '--file', source, '--post-send-wait', '2s'];
    else {
      args = ['send', 'file', '--to', to, '--file', source, '--as', media.kind === 'audio' ? 'audio' : media.kind, '--post-send-wait', '2s'];
      if (text) args.push('--caption', text); if (media.fileName) args.push('--filename', media.fileName); if (media.mimeType) args.push('--mime', media.mimeType);
    }
    return normalizeWacliSendResult(await runWacliJson(args, { timeout: SEND_TIMEOUT_MS + 35000 }));
  } finally { await fs.unlink(source).catch(() => undefined); if (converted && converted !== source) await fs.unlink(converted).catch(() => undefined); }
}

function outboxFileName() { return `${Date.now().toString().padStart(13, '0')}-${crypto.randomUUID()}.json`; }
async function persistWebhookEvent(rawBody, signature) { await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 }); const filename = outboxFileName(); const temporary = path.join(OUTBOX_DIR, `.${filename}.tmp`); const finalPath = path.join(OUTBOX_DIR, filename); await fs.writeFile(temporary, JSON.stringify({ receivedAt: new Date().toISOString(), signature, bodyBase64: rawBody.toString('base64') }), { mode: 0o600 }); await fs.rename(temporary, finalPath); return finalPath; }
async function forwardRecord(filePath) {
  const record = JSON.parse(await fs.readFile(filePath, 'utf8')); const rawBody = Buffer.from(record.bodyBase64, 'base64');
  const response = await fetch(ERP_WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': record.signature }, body: rawBody, signal: AbortSignal.timeout(FORWARD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`ERP webhook returned HTTP ${response.status}: ${(await response.text().catch(() => '')).slice(0, 500)}`);
  await fs.unlink(filePath); lastForwardSuccessAt = new Date().toISOString(); lastForwardError = null; return true;
}
async function flushWebhookOutbox() { if (forwarding) return; forwarding = true; try { await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 }); const files = (await fs.readdir(OUTBOX_DIR)).filter((name) => name.endsWith('.json')).sort().slice(0, 100); for (const filename of files) { try { await forwardRecord(path.join(OUTBOX_DIR, filename)); } catch (error) { lastForwardError = error instanceof Error ? error.message : String(error); break; } } } finally { forwarding = false; } }
async function pendingWebhookCount() { try { return (await fs.readdir(OUTBOX_DIR)).filter((name) => name.endsWith('.json')).length; } catch { return 0; } }

async function handleSend(request, response) {
  if (!authorized(request)) { json(response, 401, { sent: false, error: 'Unauthorized' }); return; }
  try {
    const input = JSON.parse((await readBody(request)).toString('utf8')); const to = validateRecipient(input.to); const text = String(input.text || '');
    if (!input.media && !text.trim()) throw new Error('Text or media is required.');
    const result = await sendItem({ to, text, media: input.media || null }); lastSendSuccessAt = new Date().toISOString(); lastSendError = null;
    json(response, 200, { sent: true, messageId: result.messageId, storeWarning: result.storeWarning, clientMessageId: input.clientMessageId || null });
  } catch (error) { lastSendError = error instanceof Error ? error.message : String(error); json(response, error?.statusCode || 502, { sent: false, error: lastSendError }); }
}
async function handleWacliEvent(request, response) {
  try {
    const rawBody = await readBody(request); const provided = String(request.headers['x-wacli-signature'] || '').trim(); if (!safeEqual(provided, signatureFor(rawBody))) { json(response, 401, { accepted: false, error: 'Invalid wacli signature' }); return; }
    const original = JSON.parse(rawBody.toString('utf8')); const enriched = await enrichIncomingPayload(original); const enrichedRaw = Buffer.from(JSON.stringify(enriched)); const signature = signatureFor(enrichedRaw);
    await persistWebhookEvent(enrichedRaw, signature); json(response, 202, { accepted: true }); queueMicrotask(() => flushWebhookOutbox().catch(() => undefined));
  } catch (error) { json(response, error?.statusCode || 400, { accepted: false, error: error instanceof Error ? error.message : String(error) }); }
}
async function handleHealth(response) { json(response, 200, { ok: true, service: 'demac-whatsapp-wacli-bridge-v2', startedAt, hostname: os.hostname(), pendingWebhookEvents: await pendingWebhookCount(), identityCache: identityCache.size, avatarCache: avatarCache.size, lastForwardSuccessAt, lastForwardError, lastSendSuccessAt, lastSendError }); }

requireConfiguration(); await fs.mkdir(OUTBOX_DIR, { recursive: true, mode: 0o700 }); await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
const server = http.createServer(async (request, response) => { try { const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`); if (request.method === 'GET' && url.pathname === '/health') return await handleHealth(response); if (request.method === 'POST' && url.pathname === '/v1/send') return await handleSend(request, response); if (request.method === 'POST' && url.pathname === '/v1/events') return await handleWacliEvent(request, response); json(response, 404, { error: 'Not found' }); } catch (error) { json(response, 500, { error: error instanceof Error ? error.message : String(error) }); } });
server.listen(PORT, HOST, () => console.log(`DEMAC wacli bridge v2 listening on http://${HOST}:${PORT}`));
const retryTimer = setInterval(() => flushWebhookOutbox().catch(() => undefined), RETRY_INTERVAL_MS); retryTimer.unref();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { clearInterval(retryTimer); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 5000).unref(); });
