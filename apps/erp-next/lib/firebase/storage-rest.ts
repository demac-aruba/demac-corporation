import type { PublicWebsiteContent } from '../public-website-content';
import {
  FirebaseStorageUploadError,
  firebaseStorageMediaUrl,
  uploadAuthenticatedFirebaseStorageObject,
} from './storage-upload';

export const PUBLIC_WEBSITE_CONFIG_PATH = 'public-website/config/published.json';

export type WebsiteImageUpload = {
  path: string;
  mediaUrl: string;
  persistence: 'firebase-storage' | 'browser-draft';
};

function cleanFileName(name: string) {
  const extension = name.includes('.') ? `.${name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')}` : '';
  const stem = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'image';
  return `${stem}${extension}`;
}

function blobAsDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected image.'));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The selected image could not be decoded.'));
    image.src = dataUrl;
  });
}

async function optimizeImageForBrowserDraft(file: File) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Local image fallback is only available in the Website Manager browser.');
  }

  const sourceUrl = await blobAsDataUrl(file);
  const image = await loadImage(sourceUrl);
  const sourceWidth = Math.max(1, image.naturalWidth || image.width);
  const sourceHeight = Math.max(1, image.naturalHeight || image.height);
  const maxWidth = 1920;
  const maxHeight = 1080;
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot prepare the website image.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, width, height);

  const optimized = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('The browser could not optimize the selected image.'));
    }, 'image/webp', 0.9);
  });

  if (optimized.size > 1.25 * 1024 * 1024) {
    throw new Error('The selected image is too complex for the temporary browser Draft. Please use a JPG/WebP image under 1.25 MB or paste an image URL.');
  }
  return blobAsDataUrl(optimized);
}

export async function uploadPublicWebsiteImage(file: File, scope = 'hero'): Promise<WebsiteImageUpload> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Website images must be smaller than 8 MB.');
  const path = `public-website/${scope}/${Date.now()}-${cleanFileName(file.name)}`;

  try {
    const stored = await uploadAuthenticatedFirebaseStorageObject(path, file, file.type || 'application/octet-stream');
    return { ...stored, persistence: 'firebase-storage' };
  } catch (error) {
    // Firebase Storage rules are deployed independently from the Vercel app.
    // During that deployment gap, do not break the owner's editing flow or
    // surface a raw 403. Keep an optimized browser-local Draft image instead.
    if (error instanceof FirebaseStorageUploadError && (error.status === 401 || error.status === 403)) {
      const mediaUrl = await optimizeImageForBrowserDraft(file);
      return { path: `browser-draft/${Date.now()}-${cleanFileName(file.name)}`, mediaUrl, persistence: 'browser-draft' };
    }
    throw error;
  }
}

export async function publishPublicWebsiteConfig(content: PublicWebsiteContent) {
  const payload = JSON.stringify(content);
  if (new Blob([payload]).size > 512 * 1024) throw new Error('Published website configuration is too large.');
  return uploadAuthenticatedFirebaseStorageObject(PUBLIC_WEBSITE_CONFIG_PATH, payload, 'application/json');
}

export function publicWebsiteConfigUrl() {
  return firebaseStorageMediaUrl(PUBLIC_WEBSITE_CONFIG_PATH);
}
