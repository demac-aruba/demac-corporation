import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WACLI_BINARY = process.env.WACLI_BINARY || 'wacli';
const WACLI_STORE_DIR = process.env.WACLI_STORE_DIR || '/var/lib/demac-wacli-test';
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

function signature(raw) {
  return `sha256=${crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`;
}

function strings(value, key = '', out = []) {
  if (typeof value === 'string') out.push({ key: key.toLowerCase(), value });
  else if (Array.isArray(value)) value.forEach((item, index) => strings(item, `${key}.${index}`, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => strings(item, `${key}.${name}`, out));
  return out;
}

function numbers(value, key = '', out = []) {
  if (typeof value === 'number' && Number.isFinite(value)) out.push({ key: key.toLowerCase(), value });
  else if (Array.isArray(value)) value.forEach((item, index) => numbers(item, `${key}.${index}`, out));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([name, item]) => numbers(item, `${key}.${name}`, out));
  return out;
}

function field(value, ...names) {
  if (!value || typeof value !== 'object') return '';
  for (const name of names) {
    const result = value[name];
    if (result !== undefined && result !== null && String(result).trim()) return result;
  }
  return '';
}

function digits(value) {
  const normalized = String(value || '').replace(/\D/g, '');
  return /^\d{8,15}$/.test(normalized) ? normalized : '';
}

function safeName(value, fallback = 'media') {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140) || fallback;
}

async function parseWacli(args, { readOnly = true, timeout = 30000 } = {}) {
  const prefix = ['--json'];
  if (readOnly) prefix.push('--read-only');
  const { stdout } = await execFileAsync(WACLI_BINARY, [...prefix, ...args], {
    timeout,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
    windowsHide: true,
  });
  const parsed = JSON.parse(String(stdout || '').trim() || '{}');
  if (parsed?.success === false) throw new Error(parsed?.error?.message || 'wacli failed');
  return parsed?.data ?? parsed;
}

const wacliReadOnly = (args, timeout) => parseWacli(args, { readOnly: true, timeout: timeout || 30000 });
const wacliLive = (args, timeout) => parseWacli(args, { readOnly: false, timeout: timeout || 30000 });

function rows(value) {
  if (Array.isArray(value)) return value;
  for (const key of ['messages', 'items', 'rows', 'data']) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

// wacli 0.16.0 serializes store.Message using the Go field names because most
// fields intentionally have no json tags: ChatJID, MsgID, Text, DisplayText,
// MediaType, MediaCaption, Filename, MimeType and LocalPath.
function messageIdentity(row) {
  const chat = String(field(row, 'ChatJID', 'chat_jid', 'chatJID', 'chat') || '');
  const id = String(field(row, 'MsgID', 'msg_id', 'messageId', 'id') || '');
  const text = String(field(row, 'Text', 'DisplayText', 'text', 'display_text', 'MediaCaption', 'media_caption') || '');
  return { chat, id, text };
}

function mediaKind(detail) {
  const direct = String(field(detail, 'MediaType', 'media_type', 'Type', 'type') || '').toLowerCase();
  const mime = String(field(detail, 'MimeType', 'mime_type', 'mimeType') || '').toLowerCase();
  const raw = `${direct} ${mime}`;
  if (/sticker/.test(raw)) return 'sticker';
  if (/image/.test(raw)) return 'image';
  if (/video|gif/.test(raw)) return 'video';
  if (/ptt|voice/.test(raw)) return 'voice';
  if (/audio/.test(raw)) return 'audio';
  if (/document|pdf|file|application\//.test(raw)) return 'document';
  return null;
}

function mediaMeta(detail, kind) {
  const n = numbers(detail);
  return {
    kind,
    mimeType: String(field(detail, 'MimeType', 'mime_type', 'mimeType') || 'application/octet-stream'),
    fileName: String(field(detail, 'Filename', 'filename', 'FileName', 'file_name') || `whatsapp-${kind}`),
    caption: String(field(detail, 'MediaCaption', 'media_caption', 'Caption', 'caption') || '') || null,
    durationSeconds: n.find((item) => /duration/.test(item.key))?.value ?? null,
    width: n.find((item) => /width/.test(item.key))?.value ?? null,
    height: n.find((item) => /height/.test(item.key))?.value ?? null,
  };
}

function extension(meta) {
  const ext = path.extname(meta.fileName || '').slice(1);
  if (ext && ext.length <= 8) return ext;
  const mime = String(meta.mimeType || '').toLowerCase();
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('jpeg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  if (mime.includes('pdf')) return 'pdf';
  return 'bin';
}

async function ticket(metadata) {
  const raw = Buffer.from(JSON.stringify(metadata));
  const response = await fetch(endpoint('wacliMediaUploadTicketV2'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': signature(raw) },
    body: raw,
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || `ticket ${response.status}`);
  return data;
}

async function upload(buffer, metadata) {
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('media too large');
  const uploadTicket = await ticket({ ...metadata, size: buffer.length });
  const response = await fetch(uploadTicket.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': uploadTicket.contentType },
    body: buffer,
  });
  if (!response.ok) throw new Error(`upload ${response.status}`);
  return uploadTicket.storagePath;
}

async function postBackfill(payload) {
  const raw = Buffer.from(JSON.stringify(payload));
  const response = await fetch(endpoint('wacliBackfillUpdateV2'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Wacli-Signature': signature(raw) },
    body: raw,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `backfill ${response.status}`);
  return data;
}

async function resolveContactPhone(chat) {
  if (chat.endsWith('@s.whatsapp.net')) return digits(chat.split('@')[0]);
  if (!chat.endsWith('@lid')) return '';
  try {
    const contact = await wacliReadOnly(['contacts', 'show', '--jid', chat], 15000);
    return digits(field(contact, 'Phone', 'phone'));
  } catch {
    return '';
  }
}

async function existingLocalMediaPath(detail) {
  const stored = String(field(detail, 'LocalPath', 'local_path', 'localPath') || '').trim();
  if (!stored) return '';
  const candidates = path.isAbsolute(stored)
    ? [stored]
    : [stored, path.join(WACLI_STORE_DIR, stored)];
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile() && stat.size > 0) return candidate;
    } catch {
      // Try the next representation. Some stores preserve a relative LocalPath.
    }
  }
  return '';
}

await fs.mkdir(TEMP_DIR, { recursive: true, mode: 0o700 });
const messageList = await wacliReadOnly(['messages', 'list', '--limit', String(LIMIT)]);
const messageRows = rows(messageList);
const avatarDone = new Set();
const phoneCache = new Map();
let updated = 0;
let mediaUpdated = 0;
let mediaDetected = 0;
let mediaFromLocalPath = 0;
let mediaFromDirectDownload = 0;
let mediaFailures = 0;
let phoneUpdated = 0;
let avatarUpdated = 0;
let avatarFailures = 0;
let avatarNoPicture = 0;
let parsedMessages = 0;
let skippedWithoutIdentity = 0;
let detailFailures = 0;

for (const row of messageRows) {
  const base = messageIdentity(row);
  if (!base.chat || !base.id) {
    skippedWithoutIdentity += 1;
    continue;
  }
  parsedMessages += 1;

  let detail;
  try {
    detail = await wacliReadOnly(['messages', 'show', '--chat', base.chat, '--id', base.id]);
  } catch {
    detailFailures += 1;
    continue;
  }

  let resolvedPhone = phoneCache.get(base.chat);
  if (resolvedPhone === undefined) {
    resolvedPhone = await resolveContactPhone(base.chat);
    phoneCache.set(base.chat, resolvedPhone);
  }
  const canonicalJid = resolvedPhone ? `${resolvedPhone}@s.whatsapp.net` : (base.chat.endsWith('@s.whatsapp.net') ? base.chat : null);
  const identity = {
    phone: resolvedPhone || null,
    canonicalJid,
    whatsappLid: base.chat.endsWith('@lid') ? base.chat : null,
  };

  const kind = mediaKind(detail);
  let media = null;
  if (kind) {
    mediaDetected += 1;
    const meta = mediaMeta(detail, kind);
    const output = path.join(TEMP_DIR, `${safeName(base.id)}.${extension(meta)}`);
    let temporaryOutput = false;
    try {
      let sourcePath = await existingLocalMediaPath(detail);
      if (sourcePath) {
        mediaFromLocalPath += 1;
      } else {
        await execFileAsync(WACLI_BINARY, ['--read-only', 'media', 'download', '--chat', base.chat, '--id', base.id, '--output', output], {
          timeout: 60000,
          maxBuffer: 4 * 1024 * 1024,
          env: process.env,
          windowsHide: true,
        });
        sourcePath = output;
        temporaryOutput = true;
        mediaFromDirectDownload += 1;
      }
      const buffer = await fs.readFile(sourcePath);
      const storagePath = await upload(buffer, {
        scope: 'inbound',
        conversationId: base.chat,
        messageId: base.id,
        contentType: meta.mimeType,
        fileName: meta.fileName,
        kind,
      });
      media = { ...meta, storagePath, size: buffer.length };
      mediaUpdated += 1;
    } catch (error) {
      mediaFailures += 1;
      console.warn(`media ${base.id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (temporaryOutput) await fs.unlink(output).catch(() => undefined);
    }
  }

  let avatar = null;
  const avatarTarget = canonicalJid || (resolvedPhone ? `+${resolvedPhone}` : base.chat);
  if (!avatarDone.has(avatarTarget) && !base.chat.endsWith('@g.us') && !base.chat.endsWith('@newsletter')) {
    avatarDone.add(avatarTarget);
    try {
      const info = await wacliLive(['profile', 'picture-info', '--jid', avatarTarget], 20000);
      const imageUrl = strings(info).find((item) => /url/.test(item.key) && /^https:\/\//.test(item.value))?.value;
      if (!imageUrl) {
        avatarNoPicture += 1;
      } else {
        const response = await fetch(imageUrl);
        if (!response.ok) throw new Error(`avatar download ${response.status}`);
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        const storagePath = await upload(buffer, {
          scope: 'avatar',
          identity: avatarTarget,
          conversationId: base.chat,
          messageId: `avatar-${Date.now()}`,
          contentType,
          fileName: contentType.includes('png') ? 'profile.png' : 'profile.jpg',
          kind: 'image',
        });
        avatar = { storagePath, updatedAt: new Date().toISOString() };
        avatarUpdated += 1;
      }
    } catch (error) {
      avatarFailures += 1;
      console.warn(`avatar ${avatarTarget}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (identity.phone || media || avatar) {
    try {
      await postBackfill({
        conversationId: base.chat,
        chat: base.chat,
        messageId: base.id,
        identity,
        media,
        avatar,
        text: base.text,
      });
      updated += 1;
      if (identity.phone) phoneUpdated += 1;
    } catch (error) {
      console.warn(`backfill ${base.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

console.log(JSON.stringify({
  ok: true,
  scanned: messageRows.length,
  parsedMessages,
  skippedWithoutIdentity,
  detailFailures,
  mediaDetected,
  mediaUpdated,
  mediaFromLocalPath,
  mediaFromDirectDownload,
  mediaFailures,
  updated,
  phoneUpdated,
  avatarsChecked: avatarDone.size,
  avatarUpdated,
  avatarNoPicture,
  avatarFailures,
  uniqueChats: phoneCache.size,
}, null, 2));
