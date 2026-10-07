'use client';

import { useEffect, useRef, useState } from 'react';
import type { FieldProcedurePart, FieldProcedureTarget } from '../../lib/field-procedure-contract';
import { assertProcedureOwner } from '../../lib/field-procedure-capture-store';
import { createProcedureAudioRecorder, procedureAudioPorts, PROCEDURE_AUDIO_MAX_SECONDS,
  type ProcedureAudioState, type ProcedureAudioOriginal } from '../../lib/field-procedure-audio-recorder';
import { registerProcedureExitGuard } from '../../lib/field-procedure-navigation';
import { onFirebaseSessionInvalidated } from '../../lib/firebase/session';
import type { ProcedureSession } from './use-procedure-session';
import styles from './field-procedure-workspace.module.css';

type Props = {
  target: FieldProcedureTarget; part: FieldProcedurePart; stepId: string;
  safetyRevision: number; limitBytes: number; canRecord: boolean;
  onCapture: ProcedureSession['capture']; onBusy: (busy: boolean) => void;
};
/** Key this component to account/visit/intervention/asset/part/step. No session is persisted here. */
export function ProcedureAudioRecorder(props: Props) {
  const initial = useRef(props).current, current = useRef(props); current.current = props;
  const engine = useRef<ReturnType<typeof createProcedureAudioRecorder> | null>(null);
  const pending = useRef<ProcedureAudioOriginal | null>(null), saving = useRef(false), mounted = useRef(false);
  const [supported, setSupported] = useState(false), [state, setState] = useState<ProcedureAudioState>('idle');
  const [seconds, setSeconds] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [hasOriginal, setHasOriginal] = useState(false), [protecting, setProtecting] = useState(false);
  const busy = () => Boolean(engine.current?.busy() || pending.current || saving.current);
  function notifyBusy() { current.current.onBusy(busy()); }
  function sameOwner() {
    try { assertProcedureOwner(initial.target); return true; } catch { return false; }
  }
  async function protect() {
    const original = pending.current;
    if (!original || saving.current || !mounted.current) return;
    if (!sameOwner()) { setError('La sesión cambió. El audio no se enviará desde otra cuenta.'); return; }
    if (original.blob.size > initial.limitBytes) {
      setError('El original supera el límite de audio. No se ha recortado ni enviado. Guarda una copia local antes de descartarlo.'); return;
    }
    saving.current = true; setProtecting(true); setError(''); notifyBusy();
    try {
      // Use the existing durable original store and upload journal; never another upload path.
      await initial.onCapture({part: initial.part, stepId: initial.stepId, view: 'supplemental', kind: 'audio',
        source: 'recorder', blob: original.blob, safetyRevision: original.safetyRevision,
        declaredCapturedAt: original.capturedAt, limitBytes: initial.limitBytes});
      pending.current = null;
      if (mounted.current && sameOwner()) {
        setHasOriginal(false);
        setNotice(original.interrupted
          ? 'Audio interrumpido protegido. Revisa su contenido; el vínculo al servidor se muestra en las evidencias.'
          : 'Audio protegido en este dispositivo. El vínculo al servidor se muestra en las evidencias.');
      }
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'El audio todavía no está protegido. Reintenta sin volver a grabar.');
    } finally {
      saving.current = false;
      if (mounted.current) { setProtecting(false); notifyBusy(); }
    }
  }
  useEffect(() => {
    mounted.current = true;
    const ports = procedureAudioPorts(); setSupported(Boolean(ports));
    if (ports) engine.current = createProcedureAudioRecorder(ports, {
      authorized: () => mounted.current && sameOwner() && current.current.canRecord,
      state: (next, elapsed) => { if (mounted.current) { setState(next); setSeconds(elapsed); notifyBusy(); } },
      error: message => { if (mounted.current) setError(message); },
      original: value => {
        pending.current = value;
        if (mounted.current) { setHasOriginal(true); notifyBusy(); void protect(); }
      },
    }, initial.limitBytes);
    const remove = registerProcedureExitGuard(busy);
    const unload = (event: BeforeUnloadEvent) => { if (busy()) { event.preventDefault(); event.returnValue = ''; } };
    // Never continue recording invisibly. The final data event is protected under the original context.
    const visibility = () => { if (document.visibilityState !== 'visible') engine.current?.stop(true); };
    const invalidated = onFirebaseSessionInvalidated(() => engine.current?.stop(true));
    window.addEventListener('beforeunload', unload); document.addEventListener('visibilitychange', visibility);
    return () => {
      mounted.current = false; engine.current?.dispose(); engine.current = null;
      remove(); invalidated(); window.removeEventListener('beforeunload', unload);
      document.removeEventListener('visibilitychange', visibility); current.current.onBusy(false);
    };
  // The parent keys all identity and step changes; callbacks use refs, not a new recorder on rerender.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  function downloadOriginal() {
    const original = pending.current;
    if (!original || !sameOwner()) return;
    const url = URL.createObjectURL(original.blob), link = document.createElement('a');
    link.href = url; link.download = 'DEMAC-audio-original.' + (original.blob.type === 'audio/mp4' ? 'm4a' : original.blob.type === 'audio/ogg' ? 'ogg' : 'webm');
    link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <div className={styles.mediaCard} aria-label="Grabadora del procedimiento">
    <strong>Grabar audio del procedimiento</strong>
    <small>Opcional · hasta {PROCEDURE_AUDIO_MAX_SECONDS / 60} minutos y {Math.round(initial.limitBytes / 1024 / 1024)} MB. No sustituye fotos requeridas.</small>
    {!supported ? <p>Grabadora no disponible aquí. Puedes usar “Agregar audio” para adjuntar una grabación del dispositivo.</p> : null}
    <div className={styles.actions}>
      <button type="button" disabled={!supported || !props.canRecord || state !== 'idle' || hasOriginal || protecting}
        onClick={() => { setError(''); setNotice(''); void engine.current?.start(current.current.safetyRevision); }}>Grabar audio</button>
      {state === 'requesting' ? <button type="button" onClick={() => engine.current?.stop()}>Cancelar solicitud de micrófono</button> : null}
      {state === 'recording' ? <button type="button" onClick={() => engine.current?.stop()}>Detener y guardar audio</button> : null}
    </div>
    {state !== 'idle' ? <p role="status">{state === 'requesting' ? 'Esperando permiso del micrófono…' : state === 'stopping' ? 'Recibiendo el último fragmento de audio…' : 'Grabando · ' + Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')}</p> : null}
    {protecting ? <p role="status">Protegiendo el audio original…</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {hasOriginal && !protecting ? <div className={styles.warning}>
      <p>El original sigue en esta pantalla. Aún no está guardado: reintenta antes de salir.</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => void protect()}>Reintentar guardar audio</button>
        <button type="button" onClick={downloadOriginal}>Guardar copia local del audio</button>
        <button type="button" onClick={() => { pending.current = null; setHasOriginal(false); setError(''); notifyBusy(); }}>Descartar audio sin guardar</button>
      </div>
    </div> : null}
    {notice ? <p role="status">{notice}</p> : null}
  </div>;
}
