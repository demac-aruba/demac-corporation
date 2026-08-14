import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WACLI_BINARY = process.env.WACLI_BINARY || 'wacli';
const WEBHOOK_SECRET = String(process.env.WACLI_WEBHOOK_SECRET || '').trim();
const ERP_WEBHOOK_URL = String(process.env.ERP_WEBHOOK_URL || '').trim();
const STATE_DIR = process.env.BRIDGE_STATE_DIR || '/var/lib/demac-whatsapp-bridge';
const TEMP_DIR = path.join(STATE_DIR, 'backfill-temp');
const LIMIT = Math.max(1, Math.min(2000, Number(process.env.WACLI_BACKFILL_LIMIT || 500)));
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;

if (!WEBHOOK_SECRET || !/^https:\/\//i.test(ERP_WEBHOOK_URL)) {
  throw new Error('WACLI_WEBHOOK_SECRET and ERP_WEBHOOK_URL are required.');
}

function endpoint(functionName) {
  const url = new URL(ERP_WEBHOOK_URL);
  const parts = url.pathname.split('/').filter(Boolean);
  if (!parts.length) throw new Error('ERP_WEBHOOK_URL does not contain a Firebase function name.');
  parts[parts.length - 1] = functionName;
  url.pathname = `/${parts.join('/')}`;
  return url.toString();
}
function signature(raw) { return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`; }
function strings(value, key = '', out = []) { if (typeof value === 'string') out.push({ key: key.toLowerCase(), value }); else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${key}.${index}`, out)); else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => strings(item, `${key}.${name}`, out)); return out; }
function numbers(value, key = '', out = []) { if (typeof value === 'number' && Number.isFinite(value)) out.push({ key: key.toLowerCase(), value }); else if (Array.isArray(value)) value.forEach((item, index) => numbers(item, `${key}.${index}`, out)); else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => numbers(item, `${key}.${name}`, out)); return out; }
function pick(entries, patterns) { for (const pattern of patterns) { const found = entries.find((item) => pattern.test(item.key) && item.value); if (found) return found.value; } return ''; }
function digits(value) { const v = String(value || '').replace(/\D/g, ''); return /^\d{8,15}$/.test(v) ? v : ''; }
function safeName(value, fallback = 'media') { return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || fallback; }
async function parseWacli(args, { readOnly = true, timeout = 30000 } = {}) {
  const prefix = ['--json']; if (readOnly) prefix.push('--read-only');
  const { stdout } = await execFileAsync(WACLI_BINARY, [...prefix, ...args], { timeout, maxBuffer: 16 * 1024 * 1024, env: process.env, windowsHide: true });
  const parsed = JSON.parse(String(stdout || '').trim() || '{}');
  if (parsed?.success === false) throw new Error(parsed?.error?.message || 'wacli failed');
  return parsed?.data ?? parsed;
}
const wacliReadOnly = (args, timeout) => parseWacli(args, { readOnly: true, timeout: timeout || 30000 });
const wacliLive = (args, timeout) => parseWacli(args, { readOnly: false, timeout: timeout || 30000 });
function rows(value) { if (Array.isArray(value)) return value; for (const key of ['messages', 'items', 'rows', 'data']) if (Array.isArray(value?.[key])) return value[key]; return []; }
function messageIdentity(row) { const s = strings(row); return { chat: pick(s, [/(^|\.)chat(_jid|jid)?$/, /remote.*jid$/, /conversation.*jid$/]), id: pick(s, [/(^|\.)message_?id$/, /(^|\.)id$/]), text: pick(s, [/(^|\.)text$/, /body$/, /caption$/]) }; }
function mediaKind(detail) { const s = strings(detail); const raw = `${pick(s, [/media.*type$/, /message.*type$/, /\.type$/])} ${pick(s, [/mime/])}`.toLowerCase(); if (/sticker/.test(raw)) return 'sticker'; if (/image/.test(raw)) return 'image'; if (/video|gif/.test(raw)) return 'video'; if (/ptt|voice/.test(raw)) return 'voice'; if (/audio/.test(raw)) return 'audio'; if (/document|pdf|file|application\//.test(raw)) return 'document'; return null; }
function mediaMeta(detail, kind) { const s = strings(detail); const n = numbers(detail); return { kind, mimeType: pick(s, [/mime/]) || 'application/octet-stream', fileName: pick(s, [/file.*name$/, /filename$/, /name$/]) || `whatsapp-${kind}`, caption: pick(s, [/caption$/]) || null, durationSeconds: n.find((item) => /duration/.test(item.key))?.value ?? null, width: n.find((item) => /width/.test(item.key))?.value ?? null, height: n.find((item) => /height/.test(item.key))?.value ?? null }; }
function extension(meta) { const ext = path.extname(meta.fileName || '').slice(1); if (ext && ext.length <= 8) return ext; const mime = String(meta.mimeType || '').toLowerCase(); if (mime.includes('webp')) return 'webp'; if (mime.includes('jpeg')) return 'jpg'; if (mime.includes('png')) return 'png'; if (mime.includes('ogg')) return 'ogg'; if (mime.includes('webm')) return 'webm'; if (mime.includes('mp4')) return 'mp4'; if (mime.includes('pdf')) return 'pdf'; return 'bin'; }
async function ticket(metadata) { const raw = Buffer.from(JSON.stringify(metadata)); const response = await fetch(endpoint('wacliMediaUploadTicketV2'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': signature(raw) }, body: raw }); const data = await response.json(); if (!response.ok || !data.ok) throw new Error(data.error || `ticket ${response.status}`); return data; }
async function upload(buffer, metadata) { if (buffer.length > MAX_MEDIA_BYTES) throw new Error('media too large'); const t = await ticket({ ...metadata, size: buffer.length }); const response = await fetch(t.uploadUrl, { method: 'PUT', headers: { 'Content-Type': t.contentType }, body: buffer }); if (!response.ok) throw new Error(`upload ${response.status}`); return t.storagePath; }
async function postBackfill(payload) { const raw = Buffer.from(JSON.stringify(payload)); const response = await fetch(endpoint('wacliBackfillUpdateV2'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': signature(raw) }, body: raw }); const data = await response.json().catch(() => ({})); if (!response.ok || !data.ok) throw new Error(data.error || `backfill ${response.status}`); return data; }

await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
const chatList = await wacliReadOnly(['chats', 'list', '--limit', '2000']).catch(() => []);
const chatRows = rows(chatList);
const messageList = await wacliReadOnly(['messages', 'list', '--limit', String(LIMIT)]);
const messageRows = rows(messageList);
const avatarDone = new Set();
let updated = 0; let mediaUpdated = 0; let phoneUpdated = 0;

for (const row of messageRows) {
  const base = messageIdentity(row); if (!base.chat || !base.id) continue;
  let detail; try { detail = await wacliReadOnly(['messages', 'show', '--chat', base.chat, '--id', base.id]); } catch { continue; }
  const s = strings(detail);
  let canonicalJid = s.find((item) => item.value.endsWith('@s.whatsapp.net') && digits(item.value.split('@')[0]))?.value || '';
  if (!canonicalJid && base.chat.endsWith('@lid')) {
    const mapped = chatRows.find((chatRow) => JSON.stringify(chatRow).includes(base.chat));
    if (mapped) canonicalJid = strings(mapped).find((item) => item.value.endsWith('@s.whatsapp.net') && digits(item.value.split('@')[0]))?.value || '';
  }
  const identity = { phone: canonicalJid ? digits(canonicalJid.split('@')[0]) : base.chat.endsWith('@s.whatsapp.net') ? digits(base.chat.split('@')[0]) : null, canonicalJid: canonicalJid || (base.chat.endsWith('@s.whatsapp.net') ? base.chat : null), whatsappLid: base.chat.endsWith('@lid') ? base.chat : null };
  const kind = mediaKind(detail);
  let media = null;
  if (kind) {
    const meta = mediaMeta(detail, kind); const output = path.join(TEMP_DIR, `${safeName(base.id)}.${extension(meta)}`);
    try {
      await execFileAsync(WACLI_BINARY, ['--read-only', 'media', 'download', '--chat', base.chat, '--id', base.id, '--output', output], { timeout: 60000, maxBuffer: 4 * 1024 * 1024, env: process.env, windowsHide: true });
      const buffer = await fs.readFile(output); const storagePath = await upload(buffer, { scope: 'inbound', conversationId: base.chat, messageId: base.id, contentType: meta.mimeType, fileName: meta.fileName, kind }); media = { ...meta, storagePath, size: buffer.length }; mediaUpdated += 1;
    } catch (error) { console.warn(`media ${base.id}: ${error instanceof Error ? error.message : String(error)}`); } finally { await fs.unlink(output).catch(() => undefined); }
  }
  let avatar = null;
  if (!avatarDone.has(base.chat) && !base.chat.endsWith('@g.us') && !base.chat.endsWith('@newsletter')) {
    avatarDone.add(base.chat);
    try {
      // profile picture-info is a live fetch and intentionally cannot run in --read-only mode.
      // Run this backfill while continuous sync is briefly stopped so the store lock is available.
      const info = await wacliLive(['profile', 'picture-info', '--jid', base.chat], 20000);
      const imageUrl = strings(info).find((item) => /url/.test(item.key) && /^https:\/\//.test(item.value))?.value;
      if (imageUrl) {
        const response = await fetch(imageUrl);
        if (response.ok) {
          const buffer = Buffer.from(await response.arrayBuffer());
          const contentType = response.headers.get('content-type') || 'image/jpeg';
          const storagePath = await upload(buffer, { scope: 'avatar', identity: base.chat, conversationId: base.chat, messageId: `avatar-${Date.now()}`, contentType, fileName: contentType.includes('png') ? 'profile.png' : 'profile.jpg', kind: 'image' });
          avatar = { storagePath, updatedAt: new Date().toISOString() };
        }
      }
    } catch { /* avatar is optional; identity/media backfill must continue */ }
  }
  if (identity.phone || media || avatar) {
    try { await postBackfill({ conversationId: base.chat, chat: base.chat, messageId: base.id, identity, media, avatar, text: base.text }); updated += 1; if (identity.phone) phoneUpdated += 1; }
    catch (error) { console.warn(`backfill ${base.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

console.log(JSON.stringify({ ok: true, scanned: messageRows.length, updated, mediaUpdated, phoneUpdated, avatarsChecked: avatarDone.size }, null, 2));
