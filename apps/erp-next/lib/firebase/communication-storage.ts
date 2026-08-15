import { firebaseClientConfig, isFirebaseClientConfigured } from './client-config';
import { requireFirebaseWebSession } from './session';

export type CommunicationMediaKind = 'image' | 'video' | 'document' | 'audio' | 'voice' | 'sticker';

export type UploadedCommunicationMedia = {
  storagePath: string;
  fileName: string;
  mimeType: string;
  size: number;
  kind: CommunicationMediaKind;
};

const MAX_BYTES: Record<CommunicationMediaKind, number> = {
  image: 20 * 1024 * 1024,
  video: 40 * 1024 * 1024,
  document: 50 * 1024 * 1024,
  audio: 20 * 1024 * 1024,
  voice: 20 * 1024 * 1024,
  sticker: 2 * 1024 * 1024,
};

function cleanSegment(value: string, fallback: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.slice(0, 120) || fallback;
}

function storageEndpoint(path: string) {
  if (!firebaseClientConfig.storageBucket) throw new Error('Firebase Storage is not configured.');
  return `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(path)}`;
}

function firebaseStorageAuthHeader(idToken: string) {
  // Cloud Storage for Firebase's web transport sends Firebase Auth ID tokens
  // with the `Firebase` authorization scheme (not OAuth's `Bearer` scheme).
  return `Firebase ${idToken}`;
}

export async function uploadCommunicationMedia(file: File, conversationId: string, kind: CommunicationMediaKind): Promise<UploadedCommunicationMedia> {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.storageBucket) throw new Error('Firebase Storage is not configured for Communication Center.');
  if (!file.size) throw new Error('The selected file is empty.');
  if (file.size > MAX_BYTES[kind]) throw new Error(`The selected ${kind} is too large for Communication Center.`);

  const session = await requireFirebaseWebSession();
  const safeConversation = cleanSegment(conversationId, 'conversation');
  const safeName = cleanSegment(file.name || `${kind}-${Date.now()}`, `${kind}-${Date.now()}`);
  const storagePath = `communication-media/outbound/${session.uid}/${safeConversation}/${Date.now()}-${safeName}`;
  const endpoint = `${storageEndpoint(storagePath)}?uploadType=media&name=${encodeURIComponent(storagePath)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: firebaseStorageAuthHeader(session.idToken),
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
  });
  if (!response.ok) {
    const details = (await response.text().catch(() => '')).slice(0, 1000);
    throw new Error(`Communication media upload failed (${response.status})${details ? `: ${details}` : ''}`);
  }
  return {
    storagePath,
    fileName: file.name || safeName,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    kind,
  };
}

export async function fetchPrivateCommunicationMedia(storagePath: string): Promise<Blob> {
  if (!storagePath.startsWith('communication-media/')) throw new Error('Unsupported communication media path.');
  const session = await requireFirebaseWebSession();
  const response = await fetch(`${storageEndpoint(storagePath)}?alt=media`, {
    headers: { Authorization: firebaseStorageAuthHeader(session.idToken) },
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Could not load communication media (${response.status}).`);
  return response.blob();
}
