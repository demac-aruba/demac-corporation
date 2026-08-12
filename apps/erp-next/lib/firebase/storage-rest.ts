import { firebaseClientConfig, isFirebaseClientConfigured } from './client-config';
import { requireFirebaseWebSession } from './session';

export type WebsiteImageUpload = {
  path: string;
  mediaUrl: string;
};

function cleanFileName(name: string) {
  const extension = name.includes('.') ? `.${name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${stem}${extension}`;
}

export async function uploadPublicWebsiteImage(file: File, scope = 'hero'): Promise<WebsiteImageUpload> {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.storageBucket) {
    throw new Error('Firebase Storage is not configured for this deployment.');
  }
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Website images must be smaller than 8 MB.');

  const session = await requireFirebaseWebSession();
  const path = `public-website/${scope}/${Date.now()}-${cleanFileName(file.name)}`;
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': file.type || 'application/octet-stream',
      'X-Goog-Meta-uploadedByUid': session.uid,
      'X-Goog-Meta-mediaKind': 'website-image',
    },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Website image upload failed.');
  }
  return {
    path,
    mediaUrl: `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media`,
  };
}
