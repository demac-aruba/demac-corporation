import { firebaseClientConfig, isFirebaseClientConfigured } from './client-config';
import { requireFirebaseWebSession } from './session';
import type { PublicWebsiteContent } from '../public-website-content';

export const PUBLIC_WEBSITE_CONFIG_PATH = 'public-website/config/published.json';

export type WebsiteImageUpload = {
  path: string;
  mediaUrl: string;
};

function cleanFileName(name: string) {
  const extension = name.includes('.') ? `.${name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${stem}${extension}`;
}

function storageMediaUrl(path: string) {
  if (!firebaseClientConfig.storageBucket) return '';
  return `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o/${encodeURIComponent(path)}?alt=media`;
}

async function uploadMedia(path: string, body: Blob | string, contentType: string) {
  if (!isFirebaseClientConfigured || !firebaseClientConfig.storageBucket) {
    throw new Error('Firebase Storage is not configured for this deployment.');
  }
  const session = await requireFirebaseWebSession();
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${firebaseClientConfig.storageBucket}/o?uploadType=media&name=${encodeURIComponent(path)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.idToken}`,
      'Content-Type': contentType,
    },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Website media upload failed.');
  }
  return storageMediaUrl(path);
}

export async function uploadPublicWebsiteImage(file: File, scope = 'hero'): Promise<WebsiteImageUpload> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Website images must be smaller than 8 MB.');
  const path = `public-website/${scope}/${Date.now()}-${cleanFileName(file.name)}`;
  const mediaUrl = await uploadMedia(path, file, file.type || 'application/octet-stream');
  return { path, mediaUrl };
}

export async function publishPublicWebsiteConfig(content: PublicWebsiteContent) {
  const payload = JSON.stringify(content);
  if (new Blob([payload]).size > 512 * 1024) throw new Error('Published website configuration is too large.');
  return uploadMedia(PUBLIC_WEBSITE_CONFIG_PATH, payload, 'application/json');
}

export function publicWebsiteConfigUrl() {
  return storageMediaUrl(PUBLIC_WEBSITE_CONFIG_PATH);
}
