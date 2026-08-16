import type { AuthPrincipal } from './security';
import type { ConversationMessage } from './communications';
import {
  loadCommunicationWorkspace,
  type LiveConversation,
  type LiveOperator,
  type WhatsAppProvider,
} from './browser-communications';
import { listFirestoreCollection, queryFirestoreCollectionByField, saveFirestoreDocument } from './firebase/firestore-rest';
import { uploadCommunicationMedia, type CommunicationMediaKind, type UploadedCommunicationMedia } from './firebase/communication-storage';

export type PhoneResolutionStatus = 'resolved' | 'resolving' | 'unavailable';

export type RichMessageMedia = {
  kind: CommunicationMediaKind;
  storagePath?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  size?: number | null;
  durationSeconds?: number | null;
  caption?: string | null;
  width?: number | null;
  height?: number | null;
};

export type RichConversationMessage = ConversationMessage & {
  type?: string | null;
  status?: string | null;
  media?: RichMessageMedia | null;
  quotedMessageId?: string | null;
  quotedText?: string | null;
};

export type RichLiveConversation = Omit<LiveConversation, 'messages'> & {
  messages: RichConversationMessage[];
  whatsappLid?: string | null;
  canonicalJid?: string | null;
  phoneResolutionStatus?: PhoneResolutionStatus;
  avatarStoragePath?: string | null;
  avatarUpdatedAt?: string | null;
};

export type RichCommunicationWorkspace = {
  conversations: RichLiveConversation[];
  operators: LiveOperator[];
  provider: WhatsAppProvider;
};

type RawConversation = {
  id: string;
  recentMessages?: Array<Record<string, unknown>>;
  whatsappLid?: string | null;
  canonicalJid?: string | null;
  phoneResolutionStatus?: string | null;
  avatarStoragePath?: string | null;
  avatarUpdatedAt?: string | null;
};

type ArchivedWhatsAppMessage = {
  id: string;
  messageId?: string | null;
  conversationId?: string | null;
  type?: string | null;
  media?: Record<string, unknown> | null;
  whatsappTimestamp?: string | number | null;
  at?: string | null;
  createdAt?: string | null;
  text?: string | null;
  author?: string | null;
  role?: string | null;
  sentByName?: string | null;
  direction?: string | null;
  fromMe?: boolean | null;
  status?: string | null;
  quotedMessageId?: string | null;
  quotedText?: string | null;
};

type ArchiveCacheEntry = { loadedAt: number; messages: ArchivedWhatsAppMessage[] };

const ARCHIVE_CACHE_MS = 60_000;
const archiveCache = new Map<string, ArchiveCacheEntry>();

function asString(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback; }
function asNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
function timestampMs(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? value : value > 1e9 ? value * 1000 : 0;
  const raw = asString(value).trim();
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (numeric > 1e12) return numeric;
    if (numeric > 1e9) return numeric * 1000;
  }
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
function isoTimestamp(value: unknown, fallback = new Date().toISOString()) {
  const ms = timestampMs(value);
  return ms ? new Date(ms).toISOString() : fallback;
}
function normalizedText(value: unknown) { return asString(value).trim().replace(/\s+/g, ' ').toLowerCase(); }

function normalizeMedia(value: unknown): RichMessageMedia | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const rawKind = asString(source.kind || source.type).toLowerCase();
  const kind: CommunicationMediaKind | null = ['image', 'video', 'document', 'audio', 'voice', 'sticker'].includes(rawKind)
    ? rawKind as CommunicationMediaKind
    : null;
  if (!kind) return null;
  return {
    kind,
    storagePath: asString(source.storagePath) || null,
    mimeType: asString(source.mimeType) || null,
    fileName: asString(source.fileName) || null,
    size: asNumber(source.size),
    durationSeconds: asNumber(source.durationSeconds),
    caption: asString(source.caption) || null,
    width: asNumber(source.width),
    height: asNumber(source.height),
  };
}

function normalizeRichMessage(value: Record<string, unknown>): RichConversationMessage {
  const role = asString(value.role, 'customer') as ConversationMessage['role'];
  return {
    id: asString(value.id, `message-${Date.now()}`),
    at: asString(value.at, new Date().toISOString()),
    author: asString(value.author, role === 'customer' ? 'WhatsApp contact' : 'DEMAC operator'),
    role,
    text: asString(value.text),
    channel: 'whatsapp',
    type: asString(value.type) || null,
    status: asString(value.status) || null,
    media: normalizeMedia(value.media),
    quotedMessageId: asString(value.quotedMessageId) || null,
    quotedText: asString(value.quotedText) || null,
  };
}

function normalizeArchivedMessage(value: ArchivedWhatsAppMessage): RichConversationMessage | null {
  const media = normalizeMedia(value.media);
  if (!media?.storagePath) return null;
  const explicitRole = asString(value.role).toLowerCase();
  const outbound = value.fromMe === true || asString(value.direction).toLowerCase() === 'outbound' || Boolean(value.sentByName);
  const role: ConversationMessage['role'] = explicitRole === 'operator' || explicitRole === 'ai' || explicitRole === 'system' || explicitRole === 'internal_note'
    ? explicitRole as ConversationMessage['role']
    : outbound ? 'operator' : 'customer';
  const id = asString(value.messageId || value.id, value.id);
  const at = isoTimestamp(value.whatsappTimestamp || value.at || value.createdAt);
  return {
    id,
    at,
    author: asString(value.sentByName || value.author, role === 'customer' ? 'WhatsApp contact' : 'DEMAC WhatsApp'),
    role,
    text: asString(value.text || media.caption),
    channel: 'whatsapp',
    type: asString(value.type, media.kind),
    status: asString(value.status) || null,
    media,
    quotedMessageId: asString(value.quotedMessageId) || null,
    quotedText: asString(value.quotedText) || null,
  };
}

function placeholderKind(message: RichConversationMessage) {
  if (message.media?.kind) return message.media.kind;
  const type = asString(message.type).toLowerCase();
  if (['image', 'video', 'document', 'audio', 'voice', 'sticker'].includes(type)) return type as CommunicationMediaKind;
  const text = normalizedText(message.text);
  if (/\[sticker\]/.test(text)) return 'sticker';
  if (/\[(audio|voice)\]/.test(text)) return 'audio';
  if (/\[image\]/.test(text)) return 'image';
  if (/\[video\]/.test(text)) return 'video';
  if (/\[(document|file|pdf)\]/.test(text)) return 'document';
  return null;
}

function isGenericMediaPlaceholder(message: RichConversationMessage) {
  const text = normalizedText(message.text);
  return text.includes('media is syncing from whatsapp') || /^\[(audio|voice|image|sticker|video|document|file|pdf)\]$/.test(text);
}

function conversationNeedsArchive(messages: RichConversationMessage[]) {
  return messages.some((message) => {
    if (message.media?.storagePath) return false;
    return Boolean(message.media || placeholderKind(message) || isGenericMediaPlaceholder(message));
  });
}

function kindCompatible(left: CommunicationMediaKind | null, right: CommunicationMediaKind) {
  if (!left) return true;
  if (left === right) return true;
  return (left === 'audio' && right === 'voice') || (left === 'voice' && right === 'audio');
}

function mergeConversationHistory(recentMessages: RichConversationMessage[], archiveMessages: RichConversationMessage[]) {
  const merged: RichConversationMessage[] = recentMessages.map((message) => ({ ...message, media: message.media ? { ...message.media } : message.media }));
  const consumedRecent = new Set<number>();
  const knownIds = new Set(merged.map((message) => message.id).filter(Boolean));
  const knownStoragePaths = new Set(merged.map((message) => message.media?.storagePath).filter(Boolean));

  const archives = [...archiveMessages].sort((left, right) => timestampMs(left.at) - timestampMs(right.at));
  for (const archive of archives) {
    if (!archive.media?.storagePath || knownStoragePaths.has(archive.media.storagePath)) continue;

    let matchIndex = merged.findIndex((message) => message.id === archive.id);
    if (matchIndex < 0) {
      const archiveAt = timestampMs(archive.at);
      let bestIndex = -1;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (let index = 0; index < merged.length; index += 1) {
        if (consumedRecent.has(index)) continue;
        const candidate = merged[index];
        if (candidate.media?.storagePath) continue;
        const candidateKind = placeholderKind(candidate);
        if (!isGenericMediaPlaceholder(candidate) && !candidateKind) continue;
        if (!kindCompatible(candidateKind, archive.media.kind)) continue;
        const candidateAt = timestampMs(candidate.at);
        const delta = archiveAt && candidateAt ? Math.abs(archiveAt - candidateAt) : 0;
        if (archiveAt && candidateAt && delta > 15 * 60 * 1000) continue;
        if (delta < bestDelta) {
          bestIndex = index;
          bestDelta = delta;
        }
      }
      matchIndex = bestIndex;
    }

    if (matchIndex >= 0) {
      const existing = merged[matchIndex];
      merged[matchIndex] = {
        ...existing,
        id: existing.id || archive.id,
        at: existing.at || archive.at,
        author: existing.author || archive.author,
        role: existing.role || archive.role,
        text: isGenericMediaPlaceholder(existing) ? archive.text : existing.text || archive.text,
        type: archive.type || existing.type,
        status: archive.status || existing.status,
        media: archive.media,
        quotedMessageId: existing.quotedMessageId || archive.quotedMessageId,
        quotedText: existing.quotedText || archive.quotedText,
      };
      consumedRecent.add(matchIndex);
      knownStoragePaths.add(archive.media.storagePath);
      knownIds.add(archive.id);
      continue;
    }

    if (knownIds.has(archive.id)) continue;
    merged.push(archive);
    knownIds.add(archive.id);
    knownStoragePaths.add(archive.media.storagePath);
  }

  return merged.sort((left, right) => {
    const leftAt = timestampMs(left.at);
    const rightAt = timestampMs(right.at);
    if (leftAt === rightAt) return left.id.localeCompare(right.id);
    return leftAt - rightAt;
  });
}

function resolutionStatus(raw: RawConversation, base: LiveConversation): PhoneResolutionStatus {
  if (raw.phoneResolutionStatus === 'resolved' || raw.phoneResolutionStatus === 'unavailable' || raw.phoneResolutionStatus === 'resolving') return raw.phoneResolutionStatus;
  if (base.phone && /^\d{8,15}$/.test(base.phone.replace(/\D/g, ''))) return 'resolved';
  if (String(base.chatJid || '').endsWith('@lid') || raw.whatsappLid) return 'resolving';
  return 'unavailable';
}

async function loadArchivedMessages(conversation: RichLiveConversation) {
  const cacheKey = conversation.id;
  const cached = archiveCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < ARCHIVE_CACHE_MS) return cached.messages;

  const identifiers = [...new Set([
    conversation.id,
    conversation.externalChatId,
    conversation.chatJid,
    conversation.whatsappLid,
    conversation.canonicalJid,
  ].map((value) => asString(value).trim()).filter(Boolean))];

  let archived: ArchivedWhatsAppMessage[] = [];
  for (const identifier of identifiers) {
    const rows = await queryFirestoreCollectionByField<ArchivedWhatsAppMessage>('whatsappMessages', 'conversationId', identifier, 500).catch(() => []);
    if (rows.length) {
      archived = rows;
      break;
    }
  }

  archiveCache.set(cacheKey, { loadedAt: Date.now(), messages: archived });
  return archived;
}

export async function loadRichConversationHistory(conversation: RichLiveConversation): Promise<RichConversationMessage[]> {
  const archived = await loadArchivedMessages(conversation);
  if (!archived.length) return conversation.messages;
  const archiveMessages = archived.map((message) => normalizeArchivedMessage(message)).filter((message): message is RichConversationMessage => Boolean(message));
  return mergeConversationHistory(conversation.messages, archiveMessages);
}

export async function loadRichCommunicationWorkspace(): Promise<RichCommunicationWorkspace> {
  const [base, rawDocuments] = await Promise.all([
    loadCommunicationWorkspace(),
    listFirestoreCollection<RawConversation>('communicationConversations'),
  ]);
  const rawById = new Map(rawDocuments.map((document) => [document.id, document]));
  const initialConversations: RichLiveConversation[] = base.conversations.map((conversation) => {
    const raw = rawById.get(conversation.id);
    const messages = Array.isArray(raw?.recentMessages)
      ? raw!.recentMessages!.map((message) => normalizeRichMessage(message))
      : conversation.messages as RichConversationMessage[];
    return {
      ...conversation,
      messages,
      whatsappLid: raw?.whatsappLid || (String(conversation.chatJid || '').endsWith('@lid') ? conversation.chatJid : null),
      canonicalJid: raw?.canonicalJid || (String(conversation.chatJid || '').endsWith('@s.whatsapp.net') ? conversation.chatJid : null),
      phoneResolutionStatus: resolutionStatus(raw || { id: conversation.id }, conversation),
      avatarStoragePath: raw?.avatarStoragePath || null,
      avatarUpdatedAt: raw?.avatarUpdatedAt || null,
    };
  });

  const conversations = await Promise.all(initialConversations.map(async (conversation) => {
    if (!conversationNeedsArchive(conversation.messages)) return conversation;
    const messages = await loadRichConversationHistory(conversation).catch(() => conversation.messages);
    return { ...conversation, messages };
  }));

  return { conversations, operators: base.operators, provider: base.provider };
}

export async function queueWhatsAppMedia(
  conversation: RichLiveConversation,
  file: File,
  kind: CommunicationMediaKind,
  principal: AuthPrincipal,
  provider: WhatsAppProvider,
  caption = '',
) {
  if (provider !== 'wacli') throw new Error('Rich media replies are currently enabled through the wacli provider.');
  const to = conversation.chatJid || conversation.canonicalJid || conversation.phone;
  if (!to) throw new Error('This conversation does not have a resolvable WhatsApp destination.');
  const uploaded: UploadedCommunicationMedia = await uploadCommunicationMedia(file, conversation.id, kind);
  const id = `wa-media-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return saveFirestoreDocument('whatsappOutboundQueue', {
    id,
    provider: 'wacli-v2',
    status: 'queued',
    type: 'media',
    to,
    text: caption.trim(),
    conversationId: conversation.id,
    mediaKind: kind,
    storagePath: uploaded.storagePath,
    fileName: uploaded.fileName,
    mimeType: uploaded.mimeType,
    size: uploaded.size,
    createdByUserId: principal.userId,
    createdByName: principal.displayName,
    createdAt: new Date().toISOString(),
  });
}
