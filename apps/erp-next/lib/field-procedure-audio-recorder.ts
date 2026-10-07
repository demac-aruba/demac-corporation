/** Device capture only. This controller neither authorizes work nor sends a request. */
export type ProcedureAudioState = 'idle' | 'requesting' | 'recording' | 'stopping';
export type ProcedureAudioOriginal = {
  blob: Blob; capturedAt: string; safetyRevision: number; durationSeconds: number; interrupted: boolean;
};
export const PROCEDURE_AUDIO_MAX_SECONDS = 300;
const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];
const allowed = new Set(['audio/webm', 'audio/mp4', 'audio/ogg']);
const baseType = (value: string) => value.split(';')[0].trim().toLowerCase();
export type ProcedureAudioPorts = {
  getMicrophone: () => Promise<MediaStream>;
  supports: (mime: string) => boolean;
  createRecorder: (stream: MediaStream, mime: string) => MediaRecorder;
  now: () => number;
  startTimer: (callback: () => void) => number;
  clearTimer: (timer: number) => void;
};
export function procedureAudioPorts(): ProcedureAudioPorts | null {
  if (typeof window === 'undefined' || !window.isSecureContext || typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function'
      || !navigator.mediaDevices?.getUserMedia) return null;
  return {
    getMicrophone: () => navigator.mediaDevices.getUserMedia({audio: true, video: false}),
    supports: mime => MediaRecorder.isTypeSupported(mime),
    createRecorder: (stream, mime) => new MediaRecorder(stream, {mimeType: mime, audioBitsPerSecond: 64_000}),
    now: () => Date.now(), startTimer: callback => window.setInterval(callback, 250),
    clearTimer: timer => window.clearInterval(timer),
  };
}
export function createProcedureAudioRecorder(ports: ProcedureAudioPorts, events: {
  authorized: () => boolean;
  state: (state: ProcedureAudioState, seconds: number) => void;
  original: (value: ProcedureAudioOriginal) => void;
  error: (message: string) => void;
}, maxBytes: number) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 6 * 1024 * 1024) throw new Error('Límite de audio inválido.');
  let state: ProcedureAudioState = 'idle', generation = 0, disposed = false;
  let recorder: MediaRecorder | null = null, stream: MediaStream | null = null, timer: number | null = null;
  let finalize: (() => void) | null = null;
  let chunks: Blob[] = [], bytes = 0, started = 0, ended = 0, safetyRevision = 0, mime = '', interrupted = false;
  const emit = () => { if (!disposed) events.state(state, started ? Math.floor(((ended || ports.now()) - started) / 1000) : 0); };
  const stopTracks = (value: MediaStream | null) => value?.getTracks().forEach(track => { try { track.stop(); } catch { /* Release the other tracks too. */ } });
  function clearResources() {
    if (timer !== null) ports.clearTimer(timer); timer = null;
    stopTracks(stream); stream = null;
  }
  function cancelPending() {
    generation += 1; state = 'idle'; started = 0; clearResources(); emit();
  }
  function stop(wasInterrupted = false) {
    if (state === 'requesting') { cancelPending(); return; }
    if (state !== 'recording') return;
    interrupted = interrupted || wasInterrupted; ended = ports.now(); state = 'stopping'; emit();
    try { if (recorder?.state !== 'inactive') recorder?.stop(); }
    catch { interrupted = true; events.error('El audio se interrumpió al detenerse. Revisa el original recuperado.'); finalize?.(); }
    // Do not leave the microphone running while a final data event is pending.
    clearResources();
  }
  async function start(revision: number) {
    if (disposed || state !== 'idle' || !events.authorized()) return;
    if (!Number.isSafeInteger(revision) || revision < 0) { events.error('La coordinación no está disponible.'); return; }
    const selected = formats.find(value => ports.supports(value));
    if (!selected) { events.error('Este navegador no ofrece un formato de grabación admitido. Puedes adjuntar un audio.'); return; }
    const version = ++generation; state = 'requesting'; started = 0; ended = 0; emit();
    try {
      const acquired = await ports.getMicrophone();
      if (disposed || version !== generation || !events.authorized()) {
        stopTracks(acquired); if (!disposed && version === generation) cancelPending(); return;
      }
      stream = acquired; recorder = ports.createRecorder(stream, selected); mime = baseType(recorder.mimeType || selected);
      if (!allowed.has(mime)) throw new Error('unsupported_format');
      safetyRevision = revision; started = ports.now(); chunks = []; bytes = 0; interrupted = false;
      const current = recorder;
      current.ondataavailable = event => {
        if (disposed || version !== generation || !event.data.size) return;
        chunks.push(event.data); bytes += event.data.size;
        // Keep final bytes intact. An oversized final original is retained, never silently cut.
        if (bytes >= maxBytes * 0.8) stop(true);
      };
      current.onerror = () => {
        if (disposed || version !== generation) return;
        interrupted = true;
        events.error('El micrófono se interrumpió. Revisa el audio recuperado antes de utilizarlo.');
        stop(true);
      };
      finalize = () => {
        if (disposed || version !== generation) return;
        current.ondataavailable = null; current.onstop = null; current.onerror = null; finalize = null;
        if (!ended) ended = ports.now(); clearResources();
        const blob = new Blob(chunks, {type: mime}); chunks = []; recorder = null;
        // Deliver the original before releasing the navigation guard in the UI.
        if (blob.size) events.original({blob, capturedAt: new Date(started).toISOString(), safetyRevision,
          durationSeconds: Math.max(0, (ended - started) / 1000), interrupted});
        else events.error('No se recibió audio. No se creó una captura vacía.');
        state = 'idle'; emit();
      };
      current.onstop = () => { if (version === generation && recorder === current) finalize?.(); };
      for (const track of stream.getTracks()) track.addEventListener('ended', () => { if (version === generation && recorder === current) stop(true); }, {once: true});
      current.start(1000); state = 'recording'; emit();
      timer = ports.startTimer(() => {
        if (!events.authorized()) { stop(true); return; }
        if (ports.now() - started >= PROCEDURE_AUDIO_MAX_SECONDS * 1000) stop(true); else emit();
      });
    } catch (error) {
      if (disposed || version !== generation) return;
      clearResources(); recorder = null; finalize = null; chunks = []; state = 'idle'; started = 0; emit();
      const name = error instanceof Error ? error.name : '';
      events.error(name === 'NotAllowedError' ? 'Permiso de micrófono denegado. Puedes permitirlo en el navegador o adjuntar un audio.'
        : 'No se pudo abrir el micrófono. Comprueba el dispositivo o adjunta un audio.');
    }
  }
  function dispose() {
    if (disposed) return; disposed = true; generation += 1;
    if (recorder) {
      recorder.ondataavailable = null; recorder.onstop = null; recorder.onerror = null;
      try { if (recorder.state !== 'inactive') recorder.stop(); } catch { /* Stop tracks below. */ }
    }
    clearResources(); recorder = null; finalize = null; chunks = []; state = 'idle';
  }
  return {start, stop, dispose, busy: () => state !== 'idle'};
}
