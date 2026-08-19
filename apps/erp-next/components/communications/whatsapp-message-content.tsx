'use client';

import { useEffect, useRef, useState } from 'react';
import type { LiveConversationMessage } from '../../lib/browser-communications';
import { getFirestoreDocument } from '../../lib/firebase/firestore-rest';
import mediaStyles from './communication-media.module.css';

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

const voiceWaveform = [10, 18, 13, 24, 17, 28, 12, 21, 30, 16, 25, 11, 19, 27, 14, 23, 31, 17, 26, 12, 20, 29, 15, 24, 18, 32, 13, 21, 27, 16, 25, 12, 19, 30, 15, 22];

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

function generatedMediaPlaceholder(text: string) {
  return /^\[(audio|voice note|photo|image|video|gif|sticker|document|media)\]$/i.test(text.trim());
}

function mediaTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}

function WhatsAppAudioPlayer({ src }: { src: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const activeBars = Math.round(progress * voiceWaveform.length);

  const updateDuration = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (Number.isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    void audio.play().catch(() => setPlaying(false));
  };

  const seek = (value: number) => {
    const audio = audioRef.current;
    if (!audio || !duration) return;
    const nextTime = Math.max(0, Math.min(duration, (value / 1000) * duration));
    audio.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return <div className={mediaStyles.voicePlayer}>
    <audio
      ref={audioRef}
      className={mediaStyles.nativeAudio}
      preload="metadata"
      src={src}
      onLoadedMetadata={updateDuration}
      onDurationChange={updateDuration}
      onPlay={() => setPlaying(true)}
      onPause={() => setPlaying(false)}
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      onEnded={() => { setPlaying(false); setCurrentTime(0); }}
    />
    <button type="button" className={mediaStyles.voicePlayButton} onClick={togglePlayback} aria-label={playing ? 'Pause voice note' : 'Play voice note'}>
      <span aria-hidden="true">{playing ? '❚❚' : '▶'}</span>
    </button>
    <div className={mediaStyles.voiceTimeline}>
      <div className={mediaStyles.voiceWaveform} aria-hidden="true">
        {voiceWaveform.map((height, index) => <i key={`${height}-${index}`} className={index < activeBars ? mediaStyles.voiceWaveActive : ''} style={{ height }} />)}
      </div>
      <input
        className={mediaStyles.voiceSeek}
        type="range"
        min="0"
        max="1000"
        step="1"
        value={Math.round(progress * 1000)}
        onChange={(event) => seek(Number(event.target.value))}
        aria-label="Voice note playback position"
      />
      <div className={mediaStyles.voiceTimes}><span>{mediaTime(currentTime)}</span><span>{mediaTime(duration)}</span></div>
    </div>
  </div>;
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
  return <div className={mediaStyles.mediaPending} data-media-pending="true"><span>{mediaLabel(type)}</span><small>Media is syncing…</small></div>;
}

export function WhatsAppMessageContent({ message }: { message: LiveConversationMessage }) {
  const resolvedMessage = useCanonicalMedia(message);
  const mediaType = String(resolvedMessage.mediaType || '').toLowerCase();
  const caption = String(resolvedMessage.mediaCaption || '').trim();
  const text = String(resolvedMessage.text || '').trim();
  const visibleText = text && text !== caption && !generatedMediaPlaceholder(text) ? text : '';

  if (resolvedMessage.reactionEmoji && !mediaType) {
    return <div data-reaction="true"><strong>{resolvedMessage.reactionEmoji}</strong><span>Reaction</span></div>;
  }

  if (mediaType) {
    const mediaClass = mediaType === 'image' || mediaType === 'sticker'
      ? mediaStyles.imageMedia
      : mediaType === 'audio' || mediaType === 'voice'
        ? mediaStyles.audioMedia
        : mediaStyles.messageMedia;

    return <>
      {resolvedMessage.mediaUrl ? <figure className={`${mediaStyles.messageMedia} ${mediaClass}`} data-media={mediaType}>
        {mediaType === 'image' || mediaType === 'sticker' ? <a className={mediaStyles.imageLink} href={resolvedMessage.mediaUrl} target="_blank" rel="noopener noreferrer"><img className={mediaStyles.messageImage} src={resolvedMessage.mediaUrl} alt={caption || resolvedMessage.mediaFileName || mediaLabel(mediaType)} loading="lazy" referrerPolicy="no-referrer" /></a> : null}
        {mediaType === 'video' || mediaType === 'gif' ? <video className={mediaStyles.messageVideo} controls preload="metadata" src={resolvedMessage.mediaUrl} /> : null}
        {mediaType === 'audio' || mediaType === 'voice' ? <WhatsAppAudioPlayer src={resolvedMessage.mediaUrl} /> : null}
        {mediaType === 'document' || !['image', 'sticker', 'video', 'gif', 'audio', 'voice'].includes(mediaType) ? <a className={mediaStyles.messageDocument} data-document="true" href={resolvedMessage.mediaUrl} target="_blank" rel="noopener noreferrer"><span>↗</span><div><strong>{resolvedMessage.mediaFileName || mediaLabel(mediaType)}</strong><small>{resolvedMessage.mediaMimeType || 'Open attachment'}</small></div></a> : null}
        {caption ? <figcaption className={mediaStyles.mediaCaption}>{caption}</figcaption> : null}
      </figure> : <MediaPending type={mediaType} />}
      {visibleText ? <p className={mediaStyles.mediaText}>{visibleText}</p> : null}
    </>;
  }

  return text ? <p>{text}</p> : <p>Message</p>;
}
