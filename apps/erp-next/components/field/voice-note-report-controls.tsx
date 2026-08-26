'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import { MAX_REPORT_VOICE_DURATION_SECONDS } from '@/lib/field-voice-note-contract';
import { ProfessionalReportPreview } from './professional-report-preview';
import styles from './technician-field-home.module.css';

export type ReportVoiceNoteInput = {
  interventionId: string;
  sectionId: string;
  blob: Blob;
  durationSeconds: number;
};

function recorderMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

function formatDuration(value: number) {
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function VoiceNoteSection({
  interventionId,
  sectionId,
  title,
  required,
  existing,
  allowed,
  mutationBusy,
  saving,
  onSave,
}: {
  interventionId: string;
  sectionId: string;
  title: string;
  required: boolean;
  existing?: FieldExecutionJobDetail['interventionReports'][number]['voiceNotes'][number];
  allowed: boolean;
  mutationBusy: boolean;
  saving: boolean;
  onSave: (input: ReportVoiceNoteInput) => Promise<boolean>;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stopTimerRef = useRef<number | null>(null);
  const tickTimerRef = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);
  const previewUrl = useMemo(() => recordedBlob ? URL.createObjectURL(recordedBlob) : '', [recordedBlob]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const releaseStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    if (tickTimerRef.current !== null) window.clearInterval(tickTimerRef.current);
    stopTimerRef.current = null;
    tickTimerRef.current = null;
  };

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    releaseStream();
  }, []);

  const stopRecording = () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === 'recording') recorder.stop();
  };

  const startRecording = async () => {
    if (!allowed || mutationBusy || recording) return;
    setLocalError(null);
    setRecordedBlob(null);
    setRecordedDuration(0);
    setElapsed(0);
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setLocalError('Este navegador no permite grabar notas de voz. Usa un navegador móvil actualizado con acceso al micrófono.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = recorderMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      streamRef.current = stream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Math.min(MAX_REPORT_VOICE_DURATION_SECONDS, Math.max(0.001, (Date.now() - startedAtRef.current) / 1000));
        const type = recorder.mimeType || chunksRef.current[0]?.type || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        setRecording(false);
        setElapsed(duration);
        releaseStream();
        recorderRef.current = null;
        if (blob.size <= 0) {
          setLocalError('La grabación quedó vacía. Intenta nuevamente.');
          return;
        }
        setRecordedBlob(blob);
        setRecordedDuration(duration);
      };
      recorder.onerror = () => {
        setLocalError('No se pudo completar la grabación de voz. Intenta nuevamente.');
        setRecording(false);
        releaseStream();
      };
      startedAtRef.current = Date.now();
      recorder.start(1000);
      setRecording(true);
      tickTimerRef.current = window.setInterval(() => {
        const seconds = Math.min(MAX_REPORT_VOICE_DURATION_SECONDS, (Date.now() - startedAtRef.current) / 1000);
        setElapsed(seconds);
      }, 250);
      stopTimerRef.current = window.setTimeout(stopRecording, MAX_REPORT_VOICE_DURATION_SECONDS * 1000);
    } catch (error) {
      releaseStream();
      setRecording(false);
      setLocalError(error instanceof Error ? error.message : 'No fue posible acceder al micrófono.');
    }
  };

  const save = async () => {
    if (!recordedBlob || recordedDuration <= 0) return;
    setLocalError(null);
    const saved = await onSave({ interventionId, sectionId, blob: recordedBlob, durationSeconds: recordedDuration });
    if (saved) {
      setRecordedBlob(null);
      setRecordedDuration(0);
      setElapsed(0);
    }
  };

  if (existing) {
    return (
      <div className={styles.interventionForm}>
        <strong>{title}</strong>
        <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          {required ? 'Requerida' : 'Opcional'} · Nota de voz guardada e inmutable
        </div>
        <div className={styles.infoGrid} style={{ gridColumn: '1 / -1' }}>
          <div className={styles.info}><span>Duración</span><strong>{formatDuration(existing.durationSeconds)}</strong></div>
          <div className={styles.info}><span>Registrada</span><strong>{new Date(existing.capturedAt).toLocaleString('es-AW', { timeZone: 'America/Aruba' })}</strong></div>
        </div>
        <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          Para preservar la evidencia histórica, esta grabación no se reemplaza desde el portal de campo.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.interventionForm}>
      <strong>{title}</strong>
      <div className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
        {required ? 'Requerida' : 'Opcional'} · máximo 2:00
      </div>
      {recording ? (
        <>
          <div className={styles.info} style={{ gridColumn: '1 / -1' }}><span>Grabando</span><strong>{formatDuration(elapsed)} / 2:00</strong></div>
          <button className={styles.action} disabled={mutationBusy} type="button" onClick={stopRecording}>Detener grabación</button>
        </>
      ) : recordedBlob ? (
        <>
          <div style={{ gridColumn: '1 / -1' }}>
            <audio controls src={previewUrl} style={{ width: '100%' }} />
            <div className={styles.helper}>Duración: {formatDuration(recordedDuration)} · {(recordedBlob.size / 1024).toFixed(0)} KB</div>
          </div>
          <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy} type="button" onClick={() => void save()}>
            {saving ? 'Guardando voz…' : 'Guardar nota de voz'}
          </button>
          <button className={styles.action} disabled={mutationBusy} type="button" onClick={() => { setRecordedBlob(null); setRecordedDuration(0); setElapsed(0); }}>
            Descartar y grabar otra
          </button>
        </>
      ) : allowed ? (
        <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy} type="button" onClick={() => void startRecording()}>
          Grabar nota de voz
        </button>
      ) : (
        <p className={styles.helper} style={{ gridColumn: '1 / -1', marginTop: 0 }}>
          Field Authority no autoriza grabar esta sección en el estado o asignación actual.
        </p>
      )}
      {localError ? <div className={styles.mutationError} style={{ gridColumn: '1 / -1' }}>{localError}</div> : null}
    </div>
  );
}

export function VoiceNoteReportControls({
  job,
  mutationBusy,
  savingKey,
  error,
  onSave,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  savingKey: string | null;
  error: string | null;
  onSave: (input: ReportVoiceNoteInput) => Promise<boolean>;
}) {
  const optionsByIntervention = useMemo(() => new Map(
    job.reportVoiceNoteOptions.map((option) => [option.interventionId, new Set(option.sectionIds)]),
  ), [job.reportVoiceNoteOptions]);

  const sections = job.interventionReports.flatMap((report) => {
    const allowedSections = optionsByIntervention.get(report.interventionId) ?? new Set<string>();
    const noteBySection = new Map(report.voiceNotes.map((note) => [note.sectionId, note]));
    return report.template.sections
      .filter((section) => section.type === 'voice_note')
      .map((section) => ({
        interventionId: report.interventionId,
        sectionId: section.id,
        title: section.title,
        required: section.required,
        existing: noteBySection.get(section.id),
        allowed: allowedSections.has(section.id),
      }));
  });

  return (
    <>
      {sections.length > 0 ? (
        <div className={styles.interventionGroup}>
          <div className={styles.plannedTitle}>NOTAS DE VOZ DEL REPORTE</div>
          <p className={styles.helper}>Cada sección conserva una sola grabación canónica de hasta dos minutos.</p>
          {sections.map((section) => {
            const key = `${section.interventionId}:${section.sectionId}`;
            return (
              <VoiceNoteSection
                key={key}
                {...section}
                mutationBusy={mutationBusy}
                saving={savingKey === key}
                onSave={onSave}
              />
            );
          })}
          {error ? <div className={styles.mutationError}>{error}</div> : null}
        </div>
      ) : null}
      <ProfessionalReportPreview job={job} />
    </>
  );
}