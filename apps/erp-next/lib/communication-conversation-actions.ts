import { updateFirestoreDocument } from './firebase/firestore-rest';
import type { LiveConversation } from './browser-communications';

export async function closeCommunicationConversation(conversationId: string) {
  return updateFirestoreDocument<LiveConversation>('communicationConversations', conversationId, {
    owner: null,
    ownerUserId: null,
    lockedBy: null,
    lockedByUserId: null,
    status: 'resolved',
    aiDisposition: null,
    unread: 0,
    updatedAt: new Date().toISOString(),
  });
}
