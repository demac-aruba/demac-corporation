'use client';

import { useEffect, useState } from 'react';
import type { LiveConversationMessage } from '../../lib/browser-communications';
import { getFirestoreDocument } from '../../lib/firebase/firestore-rest';

type CanonicalWhatsAppMediaMessage = {
  id: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  mediaCaption?: string | null;
  mediaFileName?: string | null;
  mediaMimeType?: string | null;
  mediaSize?: number | null;
  raw?: {
    Media?: Record<string, unknown>;
  } | null;
};

type CanonicalMediaFields = Pick<LiveConversationMessage, 'mediaUrl' | 'mediaType' | 'mediaCaption' | 'mediaFileName' | 'mediaMimeType' | 'mediaSize'>;

function firstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const normalized = value.trim();
    if (normalized) return normalized;
  }
  return null;
}

function canonicalMediaFields(document: CanonicalWhatsAppMediaMessage | null): CanonicalMediaFields | null {
  if (!document) return null;
  const rawMedia = document.raw?.Media || {};
  const mediaUrl = firstString(document.mediaUrl, rawMedia.mediaUrl, rawMedia.url);
  if (!mediaUrl) return null;
  const rawSize = Number(rawMedia.FileLength ?? rawMedia.fileLength ?? rawMedia.size ?? 0);
  const documentSize = Number(document.mediaSize || 0);
  return {
    mediaUrl,
    mediaType: firstString(document.mediaType, rawMedia.Type, rawMedia.type, rawMedia.kind),
    mediaCaption: firstString(document.mediaCaption, rawMedia.Caption, rawMedia.caption),
    mediaFileName: firstString(document.mediaFileName, rawMedia.Filename, rawMedia.filename, rawMedia.fileName),
    mediaMimeType: firstString(document.mediaMimeType, rawMedia.MimeType, rawMedia.mimeType, rawMedia.mime_type),
    mediaSize: Number.isFinite(documentSize) && documentSize > 0
      ? documentSize
      : Number.isFinite(rawSize) && rawSize > 0 ? rawSize : null,
  };
}

function useCanonicalMedia(message: LiveConversationMessage) {
  const [canonicalMedia, setCanonicalMedia] = useState<CanonicalMediaFields | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCanonicalMedia(null);

    if (!message.mediaType || message.mediaUrl || message.id.startsWith('local-')) {
      return () => { cancelled = true; };
    }

    getFirestoreDocument<CanonicalWhatsAppMediaMessage>('whatsappMessages', message.id)
      .then((document) => {
        if (cancelled) return;
        const recovered = canonicalMediaFields(document);
        if (recovered?.mediaUrl) setCanonicalMedia(recovered);
      })
      .catch(() => undefined);

    return () => { cancelled = true; };
  }, [message.id, message.mediaType, message.mediaUrl]);

  return canonicalMedia ? { ...message, ...canonicalMedia } : message;
}

export function communicationInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'WA';
}

export function CommunicationAvatar({ name, url, className }: { name: string; url?: string | null; className: string }) {
  return <span className={className}>{url ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : communicationInitials(name)}</span>;
}

function mediaLabel(type?: string | null) {
  const normalized = String(type || '').toLowerCase();
  if (normalized === 'image') return 'Photo';
  if (normalized === 'sticker') return 'Sticker';
  if (normalized === 'video' || normalized === 'gif') return 'Video';
  if (normalized === 'audio' || normalized === 'voice') return 'Audio';
  if (normalized === 'document') return 'Document';
  return normalized ? normalized.replaceAll('_', ' ') : 'Media';
}

export function conversationMessagePreview(message?: LiveConversationMessage | null) {
  if (!message) return 'No recent message';
  const text = String(message.text || message.mediaCaption || '').trim();
  if (message.reactionEmoji) return `${message.reactionEmoji} Reaction`;
  if (text) return text;
  if (message.mediaType) return `[${mediaLabel(message.mediaType)}]`;
  return 'Message';
}

export function messageReceiptLabel(message: LiveConversationMessage) {
  const status = String(message.status || '').toLowerCase();
  if (status.includes('fail')) return 'Failed · retry';
  if (message.id.startsWith('local-')) return 'Sending…';
  if (status.includes('read')) return 'Read ✓✓';
  if (status.includes('deliver')) return 'Delivered ✓✓';
  return 'Sent ✓';
}

function MediaPending({ type }: { type?: string | null }) {
  return <div data-media-pending="true"><span>{mediaLabel(type)}</span><small>Media is syncing…</small></div>;
}

export function WhatsAppMessageContent({ message }: { message: LiveConversationMessage }) {
  const resolvedMessage = useCanonicalMedia(message);
  const mediaType = String(resolvedMessage.mediaType || '').toLowerCase();
  const caption = String(resolvedMessage.mediaCaption || '').trim();
  const text = String(resolvedMessage.text || '').trim();
  const visibleText = text && text !== caption ? text : '';

  if (resolvedMessage.reactionEmoji && !mediaType) {
    return <div data-reaction="true"><strong>{resolvedMessage.reactionEmoji}</strong><span>Reaction</span></div>;
  }

  if (mediaType) {
    return <>
      {resolvedMessage.mediaUrl ? <figure data-media={mediaType}>
        {mediaType === 'image' || mediaType === 'sticker' ? <a href={resolvedMessage.mediaUrl} target="_blank" rel="noopener noreferrer"><img src={resolvedMessage.mediaUrl} alt={caption || resolvedMessage.mediaFileName || mediaLabel(mediaType)} loading="lazy" referrerPolicy="no-referrer" /></a> : null}
        {mediaType === 'video' || mediaType === 'gif' ? <video controls preload="metadata" src={resolvedMessage.mediaUrl} /> : null}
        {mediaType === 'audio' || mediaType === 'voice' ? <audio controls preload="metadata" src={resolvedMessage.mediaUrl} /> : null}
        {mediaType === 'document' || !['image', 'sticker', 'video', 'gif', 'audio', 'voice'].includes(mediaType) ? <a data-document="true" href={resolvedMessage.mediaUrl} target="_blank" rel="noopener noreferrer"><span>↗</span><div><strong>{resolvedMessage.mediaFileName || mediaLabel(mediaType)}</strong><small>{resolvedMessage.mediaMimeType || 'Open attachment'}</small></div></a> : null}
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure> : <MediaPending type={mediaType} />}
      {visibleText ? <p>{visibleText}</p> : null}
    </>;
  }

  return text ? <p>{text}</p> : <p>Message</p>;
}
