import type { LiveConversationMessage } from '../../lib/browser-communications';

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
  const mediaType = String(message.mediaType || '').toLowerCase();
  const caption = String(message.mediaCaption || '').trim();
  const text = String(message.text || '').trim();
  const visibleText = text && text !== caption ? text : '';

  if (message.reactionEmoji && !mediaType) {
    return <div data-reaction="true"><strong>{message.reactionEmoji}</strong><span>Reaction</span></div>;
  }

  if (mediaType) {
    return <>
      {message.mediaUrl ? <figure data-media={mediaType}>
        {mediaType === 'image' || mediaType === 'sticker' ? <a href={message.mediaUrl} target="_blank" rel="noopener noreferrer"><img src={message.mediaUrl} alt={caption || message.mediaFileName || mediaLabel(mediaType)} loading="lazy" referrerPolicy="no-referrer" /></a> : null}
        {mediaType === 'video' || mediaType === 'gif' ? <video controls preload="metadata" src={message.mediaUrl} /> : null}
        {mediaType === 'audio' || mediaType === 'voice' ? <audio controls preload="metadata" src={message.mediaUrl} /> : null}
        {mediaType === 'document' || !['image', 'sticker', 'video', 'gif', 'audio', 'voice'].includes(mediaType) ? <a data-document="true" href={message.mediaUrl} target="_blank" rel="noopener noreferrer"><span>↗</span><div><strong>{message.mediaFileName || mediaLabel(mediaType)}</strong><small>{message.mediaMimeType || 'Open attachment'}</small></div></a> : null}
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure> : <MediaPending type={mediaType} />}
      {visibleText ? <p>{visibleText}</p> : null}
    </>;
  }

  return text ? <p>{text}</p> : <p>Message</p>;
}
