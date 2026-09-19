import { firebaseClientConfig } from '@/lib/firebase/client-config';
import { requireFirebaseWebSession } from '@/lib/firebase/session';
import { PAGE } from './contract';

/** Website-editor-only upload. Follow Firebase's multipart metadata protocol;
 * never turn a denied cloud upload into a browser-local successful draft. */
export async function uploadWebsiteEditorImage(file: File): Promise<string> {
  const extensions: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const extension = extensions[file.type];
  if (!extension || !file.size || file.size >= 8 * 1024 * 1024) throw new Error('Choose a JPEG, PNG or WebP image smaller than 8 MB.');
  const bucket = firebaseClientConfig.storageBucket;
  if (!bucket) throw new Error('Website image storage is not configured.');
  const session = await requireFirebaseWebSession();
  const path = `public-website/${PAGE.id}/editor/${crypto.randomUUID()}.${extension}`;
  const boundary = `demac-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: path, contentType: file.type, size: file.size });
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type}\r\n\r\n`;
  const body = new Blob([prefix, file, `\r\n--${boundary}--`], { type: `multipart/related; boundary=${boundary}` });
  const endpoint = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?name=${encodeURIComponent(path)}`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Firebase ${session.idToken}`, 'Content-Type': body.type, 'X-Goog-Upload-Protocol': 'multipart' },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Website image upload was not confirmed (${response.status}). The previous image remains selected.`);
  const stored = await response.json().catch(() => null);
  if (stored?.name !== path || stored?.bucket !== bucket || stored?.contentType !== file.type || Number(stored?.size) !== file.size) {
    throw new Error('The uploaded image acknowledgement is invalid. The previous image remains selected.');
  }
  const url = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media`;
  // Use the public URL, without a privileged fetch or download token. Decode
  // before selecting it so clients do not discover a broken asset after publish.
  const image = new Image(); image.src = url;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([image.decode(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The uploaded image is not publicly readable yet. The previous image remains selected.')), 15_000); })]);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('The uploaded image cannot be decoded. The previous image remains selected.');
    return url;
  } finally { if (timer) clearTimeout(timer); }
}
