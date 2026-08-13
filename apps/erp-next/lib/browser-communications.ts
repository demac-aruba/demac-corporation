import type { AuthPrincipal } from './security';
import type { Conversation, ConversationMessage, ConversationStatus, Operator, OperatorPresence, Queue } from './communications';
import { getFirestoreDocument, listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';

export type WhatsAppProvider = 'wacli' | 'meta';

export type LiveConversation = Conversation & {
  ownerUserId?: string | null;
  provider?: WhatsAppProvider;
  externalChatId?: string | null;
  chatJid?: string | null;
  lastMessageText?: string | null;
  routeReason?: string | null;
  customerTyping?: boolean;
  typingMedia?: string | null;
  updatedAt?: string;
};

export type LiveOperator = Operator & {
  userId: string;
  role?: string;
  lastSeenAt?: string;
};

type StoredConversation = Omit<LiveConversation, 'messages'> & {
  id: string;
  recentMessages?: ConversationMessage[];
};

type StoredOperatorPresence = {
  id: string;
  displayName?: string;
  presence?: OperatorPresence;
  queues?: Queue[];
  languages?: string[];
  activeChats?: number;
  activeVoiceCall?: boolean;
  role?: string;
  lastSeenAt?: string;
};

type CommunicationSettings = {
  id: string;
  whatsappProvider?: WhatsAppProvider;
};

function safeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function normalizeMessage(message: ConversationMessage): ConversationMessage {
  return {
    id: safeString(message.id, `message-${Date.now()}`),
    at: safeString(message.at, new Date().toISOString()),
    author: safeString(message.author, 'WhatsApp'),
    role: message.role ?? 'customer',
    text: safeString(message.text),
    channel: message.channel ?? 'whatsapp',
  };
}

function normalizeConversation(stored: StoredConversation): LiveConversation {
  const messages = Array.isArray(stored.recentMessages) ? stored.recentMessages.map(normalizeMessage) : [];
  return {
    ...stored,
    customer: safeString(stored.customer, stored.phone || 'WhatsApp contact'),
    phone: safeString(stored.phone),
    channel: stored.channel ?? 'whatsapp',
    status: stored.status ?? 'new',
    queue: stored.queue ?? 'general',
    unread: Number(stored.unread || 0),
    language: safeString(stored.language, 'unknown'),
    aiDisposition: stored.aiDisposition ?? 'human_active',
    lastActivityAt: safeString(stored.lastActivityAt, stored.updatedAt || ''),
    messages,
  };
}

function operatorQueues(role: AuthPrincipal['role']): Queue[] {
  if (role === 'super_admin' || role === 'operations') {
    return ['general', 'scheduling', 'sales', 'finance', 'technical', 'commercial_vip', 'complaints', 'manager'];
  }
  if (role === 'office_operator') return ['general', 'scheduling', 'sales', 'finance', 'technical', 'complaints'];
  if (role === 'sales') return ['general', 'sales'];
  return ['general'];
}

export async function loadCommunicationWorkspace() {
  const [storedConversations, storedOperators, settings] = await Promise.all([
    listFirestoreCollection<StoredConversation>('communicationConversations'),
    listFirestoreCollection<StoredOperatorPresence>('communicationOperatorPresence'),
    getFirestoreDocument<CommunicationSettings>('businessSettings', 'communications').catch(() => null),
  ]);

  const conversations = storedConversations
    .map(normalizeConversation)
    .sort((left, right) => Date.parse(right.lastActivityAt || '1970-01-01') - Date.parse(left.lastActivityAt || '1970-01-01'));

  const operators: LiveOperator[] = storedOperators
    .map((operator) => ({
      id: operator.id,
      userId: operator.id,
      name: operator.displayName || 'DEMAC operator',
      presence: operator.presence ?? 'offline',
      queues: Array.isArray(operator.queues) ? operator.queues : ['general'],
      languages: Array.isArray(operator.languages) ? operator.languages : ['Papiamento', 'Spanish', 'English'],
      activeChats: Number(operator.activeChats || 0),
      activeVoiceCall: Boolean(operator.activeVoiceCall),
      role: operator.role,
      lastSeenAt: operator.lastSeenAt,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    conversations,
    operators,
    provider: settings?.whatsappProvider === 'meta' ? 'meta' as const : 'wacli' as const,
  };
}

export async function touchCommunicationPresence(
  principal: AuthPrincipal,
  presence: OperatorPresence = 'available',
  activeChats = 0,
) {
  const document: StoredOperatorPresence = {
    id: principal.userId,
    displayName: principal.displayName,
    presence,
    queues: operatorQueues(principal.role),
    languages: ['Papiamento', 'Spanish', 'English'],
    activeChats,
    activeVoiceCall: false,
    role: principal.role,
    lastSeenAt: new Date().toISOString(),
  };
  return saveFirestoreDocument('communicationOperatorPresence', document);
}

export async function claimConversation(conversationId: string, principal: AuthPrincipal) {
  return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, {
    owner: principal.displayName,
    ownerUserId: principal.userId,
    status: 'assigned',
    aiDisposition: 'human_active',
    lockedBy: principal.displayName,
    lockedByUserId: principal.userId,
    unread: 0,
    updatedAt: new Date().toISOString(),
  });
}

export async function assignConversation(
  conversationId: string,
  operator: Pick<LiveOperator, 'userId' | 'name'>,
) {
  return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, {
    owner: operator.name,
    ownerUserId: operator.userId,
    status: 'assigned',
    aiDisposition: 'human_active',
    lockedBy: operator.name,
    lockedByUserId: operator.userId,
    updatedAt: new Date().toISOString(),
  });
}

export async function updateConversationStatus(conversationId: string, status: ConversationStatus) {
  return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, {
    status,
    updatedAt: new Date().toISOString(),
  });
}

export async function markConversationRead(conversationId: string) {
  return updateFirestoreDocument<StoredConversation>('communicationConversations', conversationId, {
    unread: 0,
    updatedAt: new Date().toISOString(),
  });
}

export async function saveInternalCommunicationNote(
  conversationId: string,
  text: string,
  principal: AuthPrincipal,
) {
  const id = `note-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return saveFirestoreDocument('communicationInternalNotes', {
    id,
    conversationId,
    text: text.trim(),
    createdByUserId: principal.userId,
    createdByName: principal.displayName,
    createdAt: new Date().toISOString(),
  });
}

export async function queueWhatsAppText(
  conversation: LiveConversation,
  text: string,
  principal: AuthPrincipal,
  provider: WhatsAppProvider,
) {
  if (provider !== 'wacli') {
    throw new Error('Free-form ERP replies are currently enabled through the wacli provider. Meta remains available for the existing approved-template flow.');
  }
  const to = conversation.chatJid || conversation.phone;
  if (!to) throw new Error('This conversation has no WhatsApp phone number or JID.');
  const id = `wa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return saveFirestoreDocument('whatsappOutboundQueue', {
    id,
    provider: 'wacli',
    status: 'queued',
    type: 'text',
    to,
    text: text.trim(),
    conversationId: conversation.id,
    createdByUserId: principal.userId,
    createdByName: principal.displayName,
    createdAt: new Date().toISOString(),
  });
}
