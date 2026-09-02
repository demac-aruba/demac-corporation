import { firebaseClientConfig, isFirebaseClientConfigured } from './client-config';
import { requireFirebaseWebSession } from './session';

export class FirebaseStorageUploadError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'FirebaseStorageUploadError';
    this.status = status;
  }
}

export function firebaseStorageMediaUrl(path: string) {
  if (!firebaseClientConfig.storageBucket) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
}

export async function uploadAuthenticatedFirebaseStorageObject(
  path: string,
  body: Blob | string,
  contentType: string,
) {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.storageBucket) {
    throw new Error('Firebase Storage is not configured for this deployment.');
  }
  const normalizedPath = path.trim();
  if (!normalizedPath || normalizedPath.startsWith('/') || normalizedPath.includes('..')) {
    throw new Error('Firebase Storage path is invalid.');
  }
  const session = await requireFirebaseWebSession();
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o?uploadType=media&name=${encodeURIComponent(normalizedPath)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': contentType,
    },
    body,
  });
  if (!response.ok) {
    const message = await response.text();
    throw new FirebaseStorageUploadError(response.status, message || 'Firebase Storage upload failed.');
  }
  return {
    path: normalizedPath,
    mediaUrl: firebaseStorageMediaUrl(normalizedPath),
  };
}
