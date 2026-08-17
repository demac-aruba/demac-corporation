import type { AuthPrincipal } from './security';
import type { Conversation, ConversationMessage, ConversationStatus, Operator, OperatorPresence, Queue } from './communications';
import { getFirestoreDocument, listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';
import { requireFirebaseWebSession } from './firebase/session';

export type WhatsAppProvider = 'wacli' | 'meta';
export type WhatsAppMediaKind = 'image' | 'video' | 'audio' | 'voice' | 'document';
type ConversationLanguage = Conversation['language'];
type OperatorLanguage = Operator['languages'][number];

export type CommunicationPropertyPreview = { id: string; name: string; address: string; equipmentCount: number };
export type CommunicationEquipmentPreview = { id: string; propertyId?: string | null; locationLabel: string; systemType: string; active: boolean; condition?: string | null };
export type LiveConversationMessage = ConversationMessage & {
  status?: string | null;
  provider?: WhatsAppProvider;
  mediaType?: string | null;
  mediaCaption?: string | null;
  mediaFileName?: string | null;
  mediaMimeType?: string | null;
  mediaSize?: number | null;
  mediaUrl?: string | null;
  reactionToId?: string | null;
  reactionEmoji?: string | null;
};

export type LiveConversation = Omit<Conversation, 'messages'> & {
  messages: LiveConversationMessage[];
  channel?: ConversationMessage['channel'];
  ownerUserId?: string | null;
  provider?: WhatsAppProvider;
  externalChatId?: string | null;
  chatJid?: string | null;
  lastMessageText?: string | null;
  routeReason?: string | null;
  customerTyping?: boolean;
  typingMedia?: string | null;
  avatarUrl?: string | null;
  updatedAt?: string;
  customerEmail?: string | null;
  customerType?: string | null;
  customerStatus?: string | null;
  customerPropertiesCount?: number;
  customerEquipmentCount?: number;
  customerProperties?: CommunicationPropertyPreview[];
  customerEquipment?: CommunicationEquipmentPreview[];
};

export type LiveOperator = Operator & {
  userId: string;
  role?: string;
  lastSeenAt?: string;
};

type StoredConversation = Omit<LiveConversation, 'messages' | 'language'> & {
  id: string;
  language?: string;
  recentMessages?: LiveConversationMessage[];
};

type StoredOperatorPresence = {
  id: string;
  displayName?: string;
  presence?: OperatorPresence;
  queues?: Queue[];
  languages?: string[];
  activeChats?: number;
  activeVoiceCall?: boolean | string;
  role?: string;
  lastSeenAt?: string;
};

type CommunicationSettings = { id: string; whatsappProvider?: WhatsAppProvider };
type StoredWhatsAppMessage = { id: string; messageId?: string; sentByUserId?: string | null; sentByName?: string | null };
type StoredClient = { id: string; name?: string; displayName?: string; phone?: string; whatsapp?: string; email?: string; preferredLanguage?: string; type?: string; status?: string; active?: boolean };
type StoredProperty = { id: string; clientId?: string; name?: string; address?: string; active?: boolean };
type StoredEquipment = { id: string; clientId?: string; propertyId?: string; locationLabel?: string; systemType?: string; active?: boolean; condition?: string };
type MessageAttribution = { userId?: string | null; name?: string | null };
type CrmIndex = { loadedAt: number; clients: StoredClient[]; properties: StoredProperty[]; equipment: StoredEquipment[] };

type OutboundMediaUploadResponse = {
  ok?: boolean;
  url?: string;
  fileName?: string;
  mimeType?: string;
  size?: number;
  error?: string;
};

const operatorAttributionCache = new Map<string, MessageAttribution>();
const CRM_CACHE_MS = 60_000;
const MAX_WHATSAPP_MEDIA_BYTES = 25 * 1024 * 1024;
const WACLI_MEDIA_UPLOAD_ENDPOINT = 'https://us-central1-demac-corporation.cloudfunctions.net/wacliOutboundMediaUpload';
const BLOCKED_ATTACHMENT_EXTENSIONS = new Set(['html', 'htm', 'xhtml', 'svg']);
let crmIndexCache: CrmIndex | null = null;

function safeString(value: unknown, fallback = '') { return typeof value === 'string' ? value : fallback; }
function nullableString(value: unknown) { const normalized = safeString(value).trim(); return normalized || null; }
function normalizePhone(value: unknown) { const digits = String(value ?? '').replace(/\D/g, ''); return !digits ? '' : digits.length === 7 ? `297${digits}` : digits; }

export function whatsAppAttachmentKind(file: Pick<File, 'name' | 'type'>): WhatsAppMediaKind {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  const extension = String(file.name || '').toLowerCase().split('.').pop() || '';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif'].includes(extension)) return 'image';
  if (['mp4', 'mov', 'm4v', 'webm'].includes(extension)) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'opus'].includes(extension)) return 'audio';
  return 'document';
}

export function validateWhatsAppAttachment(file: Pick<File, 'name' | 'size' | 'type'>) {
  const name = String(file.name || '').trim();
  if (!name) throw new Error('The attachment needs a file name.');
  if (!Number.isFinite(file.size) || file.size <= 0) throw new Error('The selected attachment is empty.');
  if (file.size > MAX_WHATSAPP_MEDIA_BYTES) throw new Error('The attachment is larger than the 25 MB WhatsApp connector limit.');
  const mime = String(file.type || '').toLowerCase().split(';')[0].trim();
  const extension = name.toLowerCase().split('.').pop() || '';
  if (['text/html', 'application/xhtml+xml', 'image/svg+xml'].includes(mime) || BLOCKED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error('This file type is not allowed for WhatsApp attachments.');
  }
}

async function uploadWhatsAppAttachment(file: File, kindOverride?: WhatsAppMediaKind) {
  validateWhatsAppAttachment(file);
  const session = await requireFirebaseWebSession();
  const contentType = String(file.type || '').split(';')[0].trim() || 'application/octet-stream';
  const response = await fetch(`${WACLI_MEDIA_UPLOAD_ENDPOINT}?fileName=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': contentType,
    },
    body: file,
  });
  const payload = await response.json().catch(() => ({})) as OutboundMediaUploadResponse;
  if (!response.ok || !payload.url) throw new Error(payload.error || `Could not upload WhatsApp attachment (HTTP ${response.status}).`);
  return {
    kind: kindOverride || whatsAppAttachmentKind(file),
    url: payload.url,
    fileName: payload.fileName || file.name,
    mimeType: payload.mimeType || contentType,
    size: Number(payload.size || file.size),
  };
}

function normalizeLanguage(value: unknown): ConversationLanguage {
  const normalized = safeString(value).trim().toLowerCase();
  if (normalized === 'papiamento' || normalized === 'pap-aw') return 'Papiamento';
  if (normalized === 'spanish' || normalized === 'español' || normalized === 'espanol' || normalized === 'es') return 'Spanish';
  if (normalized === 'dutch' || normalized === 'nederlands' || normalized === 'nl') return 'Dutch';
  return 'English';
}

function normalizeOperatorLanguages(values: unknown): OperatorLanguage[] {
  if (!Array.isArray(values)) return ['Papiamento', 'Spanish', 'English'];
  return [...new Set(values.map(normalizeLanguage))];
}

function normalizeMessage(message: LiveConversationMessage, attribution?: MessageAttribution): LiveConversationMessage {
  const storedAuthor = safeString(message.author, 'WhatsApp');
  return {
    id: safeString(message.id, `message-${Date.now()}`),
    at: safeString(message.at, new Date().toISOString()),
    author: message.role === 'operator' && attribution?.name ? attribution.name : storedAuthor,
    role: message.role ?? 'customer',
    text: safeString(message.text),
    channel: message.channel ?? 'whatsapp',
    status: nullableString(message.status),
    provider: message.provider === 'meta' ? 'meta' : 'wacli',
    mediaType: nullableString(message.mediaType),
    mediaCaption: nullableString(message.mediaCaption),
    mediaFileName: nullableString(message.mediaFileName),
    mediaMimeType: nullableString(message.mediaMimeType),
    mediaSize: Number.isFinite(Number(message.mediaSize)) ? Number(message.mediaSize) : null,
    mediaUrl: nullableString(message.mediaUrl),
    reactionToId: nullableString(message.reactionToId),
    reactionEmoji: nullableString(message.reactionEmoji),
  };
}

function normalizeConversation(stored: StoredConversation, attributions: Map<string, MessageAttribution>): LiveConversation {
  const messages = Array.isArray(stored.recentMessages) ? stored.recentMessages.map((message) => normalizeMessage(message, attributions.get(safeString(message.id)))) : [];
  return { ...stored, customer: safeString(stored.customer, stored.phone || 'WhatsApp contact'), phone: safeString(stored.phone), avatarUrl: nullableString(stored.avatarUrl), channel: stored.channel ?? 'whatsapp', status: stored.status ?? 'new', queue: stored.queue ?? 'general', unread: Number(stored.unread || 0), language: normalizeLanguage(stored.language), aiDisposition: stored.aiDisposition ?? 'human_active', lastActivityAt: safeString(stored.lastActivityAt, stored.updatedAt || ''), vip: Boolean(stored.vip), messages };
}

function operatorQueues(role: AuthPrincipal['role']): Queue[] {
  if (role === 'super_admin' || role === 'operations') return ['general', 'scheduling', 'sales', 'finance', 'technical', 'commercial_vip', 'complaints', 'manager'];
  if (role === 'office_operator') return ['general', 'scheduling', 'sales', 'finance', 'technical', 'complaints'];
  if (role === 'sales') return ['general', 'sales'];
  return ['general'];
}

async function loadOperatorAttributions(storedConversations: StoredConversation[]) {
  const genericOperatorMessageIds = [...new Set(storedConversations.flatMap((conversation) => Array.isArray(conversation.recentMessages) ? conversation.recentMessages : []).filter((message) => message.role === 'operator' && safeString(message.author) === 'DEMAC WhatsApp').sort((left, right) => Date.parse(right.at || '1970-01-01') - Date.parse(left.at || '1970-01-01')).map((message) => safeString(message.id)).filter(Boolean))].slice(0, 200);
  const uncachedIds = genericOperatorMessageIds.filter((messageId) => !operatorAttributionCache.has(messageId));
  const documents = await Promise.all(uncachedIds.map((messageId) => getFirestoreDocument<StoredWhatsAppMessage>('whatsappMessages', messageId).catch(() => null)));
  uncachedIds.forEach((messageId, index) => { const document = documents[index]; operatorAttributionCache.set(messageId, document?.sentByName ? { userId: document.sentByUserId, name: document.sentByName } : {}); });
  const attributions = new Map<string, MessageAttribution>();
  for (const messageId of genericOperatorMessageIds) { const attribution = operatorAttributionCache.get(messageId); if (attribution?.name) attributions.set(messageId, attribution); }
  return attributions;
}

async function loadCrmIndex(): Promise<CrmIndex> {
  if (crmIndexCache && Date.now() - crmIndexCache.loadedAt < CRM_CACHE_MS) return crmIndexCache;
  const [clients, properties, equipment] = await Promise.all([listFirestoreCollection<StoredClient>('clients'), listFirestoreCollection<StoredProperty>('properties'), listFirestoreCollection<StoredEquipment>('equipmentSystems')]);
  crmIndexCache = { loadedAt: Date.now(), clients, properties, equipment };
  return crmIndexCache;
}

function findMatchedClient(conversation: LiveConversation, crm: CrmIndex) {
  if (conversation.customerId) return crm.clients.find((client) => client.id === conversation.customerId) ?? null;
  const phone = normalizePhone(conversation.phone);
  if (!phone) return null;
  const matches = crm.clients.filter((client) => client.active !== false && [client.phone, client.whatsapp].map(normalizePhone).filter(Boolean).includes(phone));
  return matches.length === 1 ? matches[0] : null;
}

function enrichConversationWithCrm(conversation: LiveConversation, crm: CrmIndex): LiveConversation {
  const client = findMatchedClient(conversation, crm);
  if (!client) return conversation;
  const properties = crm.properties.filter((property) => property.active !== false && property.clientId === client.id);
  const propertyIds = new Set(properties.map((property) => property.id));
  const equipment = crm.equipment.filter((unit) => unit.active !== false && (unit.clientId === client.id || Boolean(unit.propertyId && propertyIds.has(unit.propertyId))));
  const propertyPreview: CommunicationPropertyPreview[] = properties.map((property) => ({ id: property.id, name: property.name || 'Property', address: property.address || '', equipmentCount: equipment.filter((unit) => unit.propertyId === property.id).length }));
  const equipmentPreview: CommunicationEquipmentPreview[] = equipment.map((unit) => ({ id: unit.id, propertyId: unit.propertyId || null, locationLabel: unit.locationLabel || 'Registered A/C', systemType: unit.systemType || 'HVAC', active: unit.active !== false, condition: unit.condition || null }));
  const propertySummary = properties.length === 1 ? [properties[0].name, properties[0].address].filter(Boolean).join(' · ') : properties.length > 1 ? `${properties.length} properties` : conversation.property;
  return { ...conversation, customerId: client.id, customer: client.name || client.displayName || conversation.customer, customerEmail: client.email || null, customerType: client.type || null, customerStatus: client.status || (client.active === false ? 'inactive' : 'active'), customerPropertiesCount: properties.length, customerEquipmentCount: equipment.length, customerProperties: propertyPreview, customerEquipment: equipmentPreview, property: propertySummary || conversation.property, equipment: equipment.length ? `${equipment.length} registered A/C` : conversation.equipment, language: client.preferredLanguage ? normalizeLanguage(client.preferredLanguage) : conversation.language };
}

export async function loadCommunicationWorkspace() {
  const [storedConversations, storedOperators, settings] = await Promise.all([listFirestoreCollection<StoredConversation>('communicationConversations'), listFirestoreCollection<StoredOperatorPresence>('communicationOperatorPresence'), getFirestoreDocument<CommunicationSettings>('businessSettings', 'communications').catch(() => null)]);
  const [attributions, crm] = await Promise.all([loadOperatorAttributions(storedConversations), loadCrmIndex().catch(() => null)]);
  const conversations = storedConversations.map((conversation) => normalizeConversation(conversation, attributions)).map((conversation) => crm ? enrichConversationWithCrm(conversation, crm) : conversation).sort((left, right) => Date.parse(right.lastActivityAt || '1970-01-01') - Date.parse(left.lastActivityAt || '1970-01-01'));
  const operators: LiveOperator[] = storedOperators.map((operator) => ({ id: operator.id, userId: operator.id, name: operator.displayName || 'DEMAC operator', presence: operator.presence ?? 'offline', queues: operator.queues?.length ? operator.queues : (['general'] as Queue[]), languages: normalizeOperatorLanguages(operator.languages), activeChats: Number(operator.activeChats || 0), activeVoiceCall: operator.activeVoiceCall ? 'active' : undefined, role: operator.role, lastSeenAt: operator.lastSeenAt })).sort((left, right) => left.name.localeCompare(right.name));
  return { conversations, operators, provider: settings?.whatsappProvider === 'meta' ? 'meta' as const : 'wacli' as const };
}

export async function touchCommunicationPresence(principal: AuthPrincipal, presence: OperatorPresence = 'available', activeChats = 0) {
  const document: StoredOperatorPresence = { id: principal.userId, displayName: principal.displayName, presence, queues: operatorQueues(principal.role), languages: ['Papiamento', 'Spanish', 'English'], activeChats, activeVoiceCall: false, role: principal.role, lastSeenAt: new Date().toISOString() };
  return saveFirestoreDocument('communicationOperatorPresence', document);
}

export async function claimConversation(conversationId: string, principal: AuthPrincipal) {
  return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, { owner: principal.displayName, ownerUserId: principal.userId, status: 'assigned', aiDisposition: 'human_active', lockedBy: principal.displayName, lockedByUserId: principal.userId, unread: 0, updatedAt: new Date().toISOString() });
}

export async function assignConversation(conversationId: string, operator: Pick<LiveOperator, 'userId' | 'name'>) {
  return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, { owner: operator.name, ownerUserId: operator.userId, status: 'assigned', aiDisposition: 'human_active', lockedBy: operator.name, lockedByUserId: operator.userId, updatedAt: new Date().toISOString() });
}

export async function returnConversationToAi(conversationId: string, principal: AuthPrincipal) {
  return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, {
    owner: null,
    ownerUserId: null,
    lockedBy: null,
    lockedByUserId: null,
    status: 'waiting_demac',
    aiDisposition: 'ai_active',
    updatedAt: new Date().toISOString(),
  });
}

export async function updateConversationStatus(conversationId: string, status: ConversationStatus) { return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, { status, updatedAt: new Date().toISOString() }); }
export async function markConversationRead(conversationId: string) { return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, { unread: 0, updatedAt: new Date().toISOString() }); }

export async function saveInternalCommunicationNote(conversationId: string, text: string, principal: AuthPrincipal) {
  const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return saveFirestoreDocument('communicationInternalNotes', { id, conversationId, text: text.trim(), createdByUserId: principal.userId, createdByName: principal.displayName, createdAt: new Date().toISOString() });
}

export async function queueWhatsAppText(conversation: LiveConversation, text: string, principal: AuthPrincipal, provider: WhatsAppProvider) {
  if (provider !== 'wacli') throw new Error('Free-form ERP replies are currently enabled through the wacli provider. Meta remains available for the existing approved-template flow.');
  const to = conversation.chatJid || conversation.phone;
  if (!to) throw new Error('This conversation has no WhatsApp phone number or JID.');
  const id = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return saveFirestoreDocument('whatsappOutboundQueue', { id, provider: 'wacli', status: 'queued', type: 'text', to, text: text.trim(), conversationId: conversation.id, createdByUserId: principal.userId, createdByName: principal.displayName, createdAt: new Date().toISOString() });
}

export async function queueWhatsAppMedia(conversation: LiveConversation, file: File, text: string, principal: AuthPrincipal, provider: WhatsAppProvider, kindOverride?: WhatsAppMediaKind) {
  if (provider !== 'wacli') throw new Error('Free-form ERP media replies are currently enabled through the wacli provider.');
  const to = conversation.chatJid || conversation.phone;
  if (!to) throw new Error('This conversation has no WhatsApp phone number or JID.');
  const media = await uploadWhatsAppAttachment(file, kindOverride);
  const id = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return saveFirestoreDocument('whatsappOutboundQueue', {
    id,
    provider: 'wacli',
    status: 'queued',
    type: media.kind,
    to,
    text: text.trim(),
    media,
    conversationId: conversation.id,
    createdByUserId: principal.userId,
    createdByName: principal.displayName,
    createdAt: new Date().toISOString(),
  });
}

export { loadCommunicationCustomerContext, type CommunicationCustomerContext } from './communication-customer-context';