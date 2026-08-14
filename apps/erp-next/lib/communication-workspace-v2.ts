import type { AuthPrincipal } from './security';
import type { ConversationMessage } from './communications';
import {
  loadCommunicationWorkspace,
  type LiveConversation,
  type LiveOperator,
  type WhatsAppProvider,
} from './browser-communications';
import { listFirestoreCollection, saveFirestoreDocument } from './firebase/firestore-rest';
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

function asString(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback; }
function asNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : null; }

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

function resolutionStatus(raw: RawConversation, base: LiveConversation): PhoneResolutionStatus {
  if (raw.phoneResolutionStatus === 'resolved' || raw.phoneResolutionStatus === 'unavailable' || raw.phoneResolutionStatus === 'resolving') return raw.phoneResolutionStatus;
  if (base.phone && /^\d{8,15}$/.test(base.phone.replace(/\D/g, ''))) return 'resolved';
  if (String(base.chatJid || '').endsWith('@lid') || raw.whatsappLid) return 'resolving';
  return 'unavailable';
}

export async function loadRichCommunicationWorkspace(): Promise<RichCommunicationWorkspace> {
  const [base, rawDocuments] = await Promise.all([
    loadCommunicationWorkspace(),
    listFirestoreCollection<RawConversation>('communicationConversations'),
  ]);
  const rawById = new Map(rawDocuments.map((document) => [document.id, document]));
  const conversations: RichLiveConversation[] = base.conversations.map((conversation) => {
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
