import type { ConversationStatus } from './communications';
import { requireFirebaseWebSession } from './firebase/session';

const COMMUNICATION_COMMAND_ENDPOINT = 'https://us-central1-demac-corporation.cloudfunctions.net/communicationConversationAuthority';

type CommunicationCommandAction =
  | 'claim_conversation'
  | 'assign_conversation'
  | 'return_to_maya'
  | 'close_conversation'
  | 'reopen_conversation'
  | 'update_status'
  | 'mark_read'
  | 'send_reply';

type OutboundMedia = {
  kind: 'image' | 'video' | 'audio' | 'voice' | 'document';
  url: string;
  fileName?: string | null;
  mimeType?: string | null;
  size?: number | null;
};

type CommunicationCommandResult = {
  success?: boolean;
  replayed?: boolean;
  conversationId?: string;
  ownershipVersion?: number;
  queueId?: string;
  error?: { code?: string; message?: string; details?: Record<string, unknown> };
};

type PrincipalLike = { userId?: string; displayName?: string };
type OperatorLike = { userId: string; name: string };
type ReplyConversationLike = { id: string; ownershipVersion?: number };

type ProviderLike = 'wacli' | 'meta';

function commandRequestId(action: CommunicationCommandAction, conversationId: string) {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${action}:${conversationId}:${suffix}`;
}

async function executeCommunicationCommand(
  action: CommunicationCommandAction,
  conversationId: string,
  data: Record<string, unknown> = {},
) {
  const session = await requireFirebaseWebSession();
  const response = await fetch(COMMUNICATION_COMMAND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      data: {
        conversationId,
        requestId: commandRequestId(action, conversationId),
        ...data,
      },
    }),
  });
  const payload = await response.json().catch(() => ({})) as CommunicationCommandResult;
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error?.message || `Communication command failed (HTTP ${response.status}).`);
  }
  return payload;
}

export async function claimCommunicationConversation(conversationId: string, expectedOwnershipVersion?: number) {
  return executeCommunicationCommand('claim_conversation', conversationId, { expectedOwnershipVersion });
}

export async function assignCommunicationConversation(
  conversationId: string,
  target: { userId: string; name: string },
  expectedOwnershipVersion?: number,
) {
  return executeCommunicationCommand('assign_conversation', conversationId, { target, expectedOwnershipVersion });
}

export async function returnCommunicationConversationToMaya(conversationId: string, expectedOwnershipVersion?: number) {
  return executeCommunicationCommand('return_to_maya', conversationId, { expectedOwnershipVersion });
}

export async function closeCommunicationConversation(conversationId: string, expectedOwnershipVersion?: number) {
  return executeCommunicationCommand('close_conversation', conversationId, { expectedOwnershipVersion });
}

export async function reopenCommunicationConversation(conversationId: string, expectedOwnershipVersion?: number) {
  return executeCommunicationCommand('reopen_conversation', conversationId, { expectedOwnershipVersion });
}

export async function updateCommunicationConversationStatus(
  conversationId: string,
  status: ConversationStatus,
  expectedOwnershipVersion?: number,
) {
  return executeCommunicationCommand('update_status', conversationId, { status, expectedOwnershipVersion });
}

export async function markCommunicationConversationRead(conversationId: string, expectedOwnershipVersion?: number) {
  return executeCommunicationCommand('mark_read', conversationId, { expectedOwnershipVersion });
}

export async function sendCommunicationConversationReply(args: {
  conversationId: string;
  text?: string;
  media?: OutboundMedia | null;
  expectedOwnershipVersion?: number;
}) {
  return executeCommunicationCommand('send_reply', args.conversationId, {
    text: args.text ?? '',
    media: args.media ?? null,
    expectedOwnershipVersion: args.expectedOwnershipVersion,
  });
}

// Compatibility adapters for the current Communication Center component. The
// authenticated principal is resolved server-side from the Firebase token;
// browser-supplied actor identity is deliberately ignored as authority.
export async function claimConversation(
  conversationId: string,
  _principal?: PrincipalLike,
  expectedOwnershipVersion?: number,
) {
  return claimCommunicationConversation(conversationId, expectedOwnershipVersion);
}

export async function assignConversation(
  conversationId: string,
  operator: OperatorLike,
  expectedOwnershipVersion?: number,
) {
  return assignCommunicationConversation(conversationId, operator, expectedOwnershipVersion);
}

export async function returnConversationToAi(
  conversationId: string,
  _principal?: PrincipalLike,
  expectedOwnershipVersion?: number,
) {
  return returnCommunicationConversationToMaya(conversationId, expectedOwnershipVersion);
}

export async function updateConversationStatus(
  conversationId: string,
  status: ConversationStatus,
  expectedOwnershipVersion?: number,
) {
  return updateCommunicationConversationStatus(conversationId, status, expectedOwnershipVersion);
}

export async function markConversationRead(conversationId: string, expectedOwnershipVersion?: number) {
  return markCommunicationConversationRead(conversationId, expectedOwnershipVersion);
}

export async function queueWhatsAppText(
  conversation: ReplyConversationLike,
  text: string,
  _principal: PrincipalLike,
  provider: ProviderLike,
) {
  if (provider !== 'wacli') throw new Error('Free-form ERP replies are currently enabled through the wacli provider.');
  return sendCommunicationConversationReply({
    conversationId: conversation.id,
    text: text.trim(),
    expectedOwnershipVersion: conversation.ownershipVersion,
  });
}
