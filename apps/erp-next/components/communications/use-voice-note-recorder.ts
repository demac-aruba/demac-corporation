'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_MAX_SECONDS = 120;
const RECORDER_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/ogg;codecs=opus',
  'audio/webm',
] as const;

function supportedRecorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return RECORDER_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) || '';
}

function voiceFileExtension(mimeType: string) {
  return mimeType.toLowerCase().includes('ogg') ? 'ogg' : 'webm';
}

type VoiceNoteRecorderOptions = {
  onRecorded: (file: File) => void;
  onError: (message: string) => void;
  maxSeconds?: number;
};

export function useVoiceNoteRecorder({ onRecorded, onError, maxSeconds = DEFAULT_MAX_SECONDS }: VoiceNoteRecorderOptions) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const discardRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    intervalRef.current = null;
    timeoutRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    else {
      clearTimers();
      releaseStream();
      chunksRef.current = [];
      setRecording(false);
      setSeconds(0);
    }
  }, [clearTimers, releaseStream]);

  const start = useCallback(async () => {
    if (recording) return;
    if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      onError('Voice-note recording is not supported by this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const mimeType = supportedRecorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      discardRef.current = false;
      setSeconds(0);

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        onError('The browser could not continue recording this voice note.');
      };
      recorder.onstop = () => {
        const shouldDiscard = discardRef.current;
        const chunks = chunksRef.current;
        const recordedMimeType = recorder.mimeType || mimeType || 'audio/webm';

        clearTimers();
        releaseStream();
        recorderRef.current = null;
        chunksRef.current = [];
        discardRef.current = false;
        setRecording(false);
        setSeconds(0);

        if (shouldDiscard || chunks.length === 0) return;
        const blob = new Blob(chunks, { type: recordedMimeType });
        if (!blob.size) return;
        const extension = voiceFileExtension(recordedMimeType);
        onRecorded(new File([blob], `voice-note-${Date.now()}.${extension}`, { type: recordedMimeType }));
      };

      recorder.start(250);
      setRecording(true);
      intervalRef.current = setInterval(() => setSeconds((current) => Math.min(maxSeconds, current + 1)), 1000);
      timeoutRef.current = setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, maxSeconds * 1000);
    } catch (error) {
      clearTimers();
      releaseStream();
      recorderRef.current = null;
      setRecording(false);
      setSeconds(0);
      const name = error instanceof DOMException ? error.name : '';
      onError(name === 'NotAllowedError'
        ? 'Microphone access was not allowed. Enable microphone permission for the DEMAC ERP and try again.'
        : 'The microphone could not be started.');
    }
  }, [clearTimers, maxSeconds, onError, onRecorded, recording, releaseStream]);

  useEffect(() => () => {
    discardRef.current = true;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    clearTimers();
    releaseStream();
  }, [clearTimers, releaseStream]);

  const supported = typeof window !== 'undefined'
    && typeof MediaRecorder !== 'undefined'
    && Boolean(navigator.mediaDevices?.getUserMedia);

  return { recording, seconds, supported, start, stop, cancel };
}
