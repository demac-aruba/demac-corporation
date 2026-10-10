'use client';
import Image from 'next/image';
import type { ReactNode } from 'react';
import { ChargeIcon } from './appointment-charge-icons';
import ui from './appointment-detail.module.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { emptyVisitReferences, loadVisitReferences, readVisitReference, saveVisitReferences, uploadVisitReference,
  visitReferenceRequestId, type ReferenceContext, type VisitReferenceFile, type VisitReferences } from '../../lib/booking-visit-references';
import styles from './booking-visit-references.module.css';

type EditorProps = { value: VisitReferences; onChange: (value: VisitReferences) => void; disabled?: boolean;
  onBusyChange?: (busy: boolean) => void; appointmentId?: string; compact?: boolean; footer?: ReactNode };
function ReferencePreview({ file, context, onClose }: { file: VisitReferenceFile; context: ReferenceContext; onClose: () => void }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true, objectUrl = '';
    setUrl(''); setError('');
    void readVisitReference(file, context).then(blob => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
    }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el archivo.'); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [file.id, context.appointmentId, context.workOrderId]); // Identity owns the authenticated media request.
  return <div className={styles.preview}><div className={styles.fileTitle}><strong className={styles.name}>{file.fileName}</strong><button className={styles.button} type="button" onClick={onClose}>Cerrar</button></div>
    {error ? <p className={styles.error} role="alert">{error}</p> : !url ? <p>Cargando archivo…</p> : file.kind === 'image'
      ? <Image src={url} alt={file.description || file.fileName} width={720} height={480} unoptimized />
      : file.kind === 'video' ? <video src={url} controls preload="metadata" aria-label={file.description || file.fileName} />
        : <audio src={url} controls preload="metadata" aria-label={file.description || file.fileName} />}</div>;
}

export function VisitReferenceEditor({ value, onChange, disabled, onBusyChange, appointmentId, compact = false, footer }: EditorProps) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<VisitReferenceFile | null>(null);
  const valueRef = useRef(value); valueRef.current = value;
  const alive = useRef(true);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const staged = useRef(new Set<string>());
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { staged.current.clear(); }, [value.version]);
  const busy = disabled || uploading;
  async function addFiles(selected: FileList | null) {
    if (!selected || busy) return;
    if (selected.length + valueRef.current.files.length > 20) { setError('Puedes añadir hasta 20 archivos por booking.'); return; }
    setUploading(true); onBusyChange?.(true); setError('');
    try {
      for (const file of Array.from(selected)) {
        const uploaded = await uploadVisitReference(file, visitReferenceRequestId());
        if (!alive.current) return;
        staged.current.add(uploaded.id);
        const next = { ...valueRef.current, files: [...valueRef.current.files, uploaded] };
        valueRef.current = next; onChange(next);
      }
    } catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'No se pudo subir el archivo. Los archivos ya cargados se conservan.'); }
    finally { if (alive.current) setUploading(false); onBusyChange?.(false); }
  }
  function move(index: number, delta: number) {
    const files = [...value.files]; [files[index], files[index + delta]] = [files[index + delta], files[index]]; onChange({ ...value, files });
  }
  return <section className={compact ? `${ui.card} ${styles.compact}` : styles.panel} aria-label="Información para la visita">
    <div className={compact ? ui.cardHeader : styles.heading}>{compact ? <span className={`${ui.tile} ${ui.violet}`}><ChargeIcon name="note"/></span> : null}<div><h3>Información para la visita</h3>{compact ? <p>Indicaciones para el técnico y ayudante</p> : null}</div>{!compact ? <span className={styles.optional}>Opcional</span> : null}</div>
    <label>{compact ? 'Indicaciones para el equipo' : 'Indicaciones para el técnico y ayudante'}<textarea disabled={busy} rows={2} maxLength={3000} value={value.notes} placeholder="Problema reportado, acceso, equipo o área…" onChange={event => onChange({ ...value, notes: event.target.value })} /></label>
    <div className={compact ? styles.mediaActions : styles.actions}>{([{ kind: 'image', label: 'Añadir fotos', accept: 'image/jpeg,image/png,image/webp' },
      { kind: 'video', label: 'Añadir video', accept: 'video/mp4,video/quicktime,video/webm' },
      { kind: 'voice', label: 'Añadir audio', accept: 'audio/*,.opus,.ogg,.m4a,.mp3,.wav' }]).map(option => <span key={option.kind}>
      <button type="button" className={styles.button} disabled={busy || value.files.length >= 20} onClick={() => inputs.current[option.kind]?.click()}>{compact ? <><ChargeIcon name={option.kind === 'image' ? 'camera' : option.kind === 'video' ? 'video' : 'microphone'}/>{option.kind === 'image' ? 'Foto' : option.kind === 'video' ? 'Video' : 'Audio'}</> : option.label}</button>
      <input hidden type="file" multiple accept={option.accept} aria-label={option.label} ref={element => { inputs.current[option.kind] = element; }} onChange={event => { void addFiles(event.target.files); event.target.value = ''; }} />
    </span>)}</div>
    {compact ? <p className={styles.hint}>{value.files.length ? `${value.files.length} archivos · 25 MB por archivo · Máximo 20` : 'Sin archivos adjuntos'}</p> : <p className={styles.hint}>Hasta 20 archivos · 25 MB por archivo · Se enviarán por WhatsApp en este orden.</p>}
    {uploading && <p className={styles.busy} role="status">Subiendo archivos… Espera antes de confirmar el booking.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.files}>{value.files.map((file, index) => <div className={styles.file} key={file.id}>
      <div className={styles.fileTitle}><button className={`${styles.button} ${styles.name}`} type="button" onClick={() => setPreview(file)}>{index + 1}. {file.kind === 'image' ? 'Foto' : file.kind === 'video' ? 'Video' : 'Audio'} · {file.fileName}</button>
        <div className={styles.tools}><button className={styles.button} type="button" aria-label={`Subir ${file.fileName}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>↑</button><button className={styles.button} type="button" aria-label={`Bajar ${file.fileName}`} disabled={busy || index === value.files.length - 1} onClick={() => move(index, 1)}>↓</button><button className={styles.button} type="button" disabled={busy} onClick={() => { onChange({ ...value, files: value.files.filter(item => item.id !== file.id) }); if (preview?.id === file.id) setPreview(null); }}>Quitar</button></div></div>
      <label>Explicación de {file.kind === 'image' ? 'esta foto' : file.kind === 'video' ? 'este video' : 'este audio'}<input type="text" disabled={busy} maxLength={700} value={file.description} placeholder="Ej.: aire de la cocina; fuga en la conexión señalada." onChange={event => onChange({ ...value, files: value.files.map(item => item.id === file.id ? { ...item, description: event.target.value } : item) })} /></label>
    </div>)}</div>
    {preview && <ReferencePreview file={preview} context={staged.current.has(preview.id) ? {} : { appointmentId }} onClose={() => setPreview(null)} />}
    {compact ? <details className={styles.gps}><summary><ChargeIcon name="pin"/><span>Ubicación GPS<small>{value.location ? 'Ubicación añadida' : 'Sin añadir'}</small></span><span className={styles.gpsAction}>{value.location ? 'Editar' : '+ Añadir'}</span></summary><div className={styles.gpsFields}>    <label>Ubicación GPS del trabajo<input type="text" disabled={busy} value={value.location?.url || ''} placeholder="Enlace de Maps o latitud, longitud" maxLength={1500} onChange={event => onChange({ ...value, location: event.target.value ? { url: event.target.value, label: value.location?.label || 'Ubicación del trabajo' } : null })} /></label>
    {value.location && <label>Referencia de acceso<input type="text" disabled={busy} maxLength={160} value={value.location.label} placeholder="Ej.: entrada lateral" onChange={event => onChange({ ...value, location: { ...value.location!, label: event.target.value } })} /></label>}
</div></details> : <>    <label>Ubicación GPS del trabajo<input type="text" disabled={busy} value={value.location?.url || ''} placeholder="Enlace de Maps o latitud, longitud" maxLength={1500} onChange={event => onChange({ ...value, location: event.target.value ? { url: event.target.value, label: value.location?.label || 'Ubicación del trabajo' } : null })} /></label>
    {value.location && <label>Referencia de acceso<input type="text" disabled={busy} maxLength={160} value={value.location.label} placeholder="Ej.: entrada lateral" onChange={event => onChange({ ...value, location: { ...value.location!, label: event.target.value } })} /></label>}
</>}
    {compact ? <div className={styles.compactNotice}><ChargeIcon name="whatsapp"/><span>Las referencias se incluyen en la agenda de WhatsApp de las 8:00.</span>{footer}</div> : <p className={styles.notice}>Incluido con este trabajo en el WhatsApp de las 8:00. Puedes completarlo después; los cambios del día avisan al equipo asignado.</p>}
  </section>;
}

export function SavedVisitReferences({ appointmentId, workOrderId, canEdit = false, compact = false, onBusyChange }: ReferenceContext & { canEdit?: boolean; compact?: boolean; onBusyChange?: (busy: boolean) => void }) {
  const [value, setValue] = useState<VisitReferences>(emptyVisitReferences);
  const [version, setVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [dirty, setDirty] = useState(false);
  const [preview, setPreview] = useState<VisitReferenceFile | null>(null);
  useEffect(() => { onBusyChange?.(saving || uploading); }, [saving, uploading, onBusyChange]);
  const requestKey = useRef<{ fingerprint: string; id: string } | null>(null);
  const reload = useCallback(async () => {
    setLoading(true); setError('');
    try { const next = await loadVisitReferences({ appointmentId, workOrderId }); setValue(next); setVersion(next.version || 0); setDirty(false); setLoaded(true); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron cargar las referencias.'); }
    finally { setLoading(false); }
  }, [appointmentId, workOrderId]);
  useEffect(() => { void reload(); }, [reload]);
  async function save() {
    if (!appointmentId || saving || uploading) return;
    const fingerprint = JSON.stringify({ appointmentId, version, value });
    if (requestKey.current?.fingerprint !== fingerprint) requestKey.current = { fingerprint, id: visitReferenceRequestId() };
    setSaving(true); setError(''); setMessage('');
    try { const next = await saveVisitReferences(appointmentId, value, version, requestKey.current.id); setValue(next); setVersion(next.version || 0); setDirty(false); setMessage('Referencias guardadas.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron guardar las referencias.'); }
    finally { setSaving(false); }
  }
  if (loading) return <div className={compact ? ui.card : undefined}><p className={styles.hint} role="status">Cargando información para la visita…</p></div>;
  if (!loaded) return <section className={styles.panel}><h3>Información para la visita</h3><p className={styles.error} role="alert">{error}</p><button className={styles.button} type="button" onClick={() => void reload()}>Reintentar carga</button></section>;
  const actions = <div className={styles.actions}><button className={`${styles.button} ${compact ? '' : styles.primary}`} type="button" disabled={!dirty || saving || uploading} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar referencias'}</button><button type="button" className={styles.button} aria-label={compact ? "Recargar referencias" : undefined} title="Recargar referencias" disabled={saving || uploading} onClick={() => { if (!dirty || window.confirm('¿Descartar cambios sin guardar y recargar referencias?')) void reload(); }}>{compact ? <ChargeIcon name="history"/> : 'Recargar'}</button></div>;
  return <div className={compact ? (canEdit ? styles.compactWrapper : ui.card) : styles.panel}>
    {canEdit ? <><VisitReferenceEditor value={value} onChange={next => { setValue(next); setDirty(true); setMessage(''); }} disabled={saving} onBusyChange={setUploading} appointmentId={appointmentId} compact={compact} footer={compact ? actions : undefined} />
      {!compact ? actions : null}</>
      : <><h3>Información para la visita</h3><p className={styles.hint}>Referencias del cliente / oficina</p>{value.notes && <p className={styles.note}>{value.notes}</p>}
        {value.location && <a className={styles.location} href={value.location.url} target="_blank" rel="noreferrer">Cómo llegar · {value.location.label}</a>}
        {value.files.map((file, index) => <div className={styles.file} key={file.id}><button type="button" className={`${styles.button} ${styles.name}`} onClick={() => setPreview(file)}>{index + 1}. {file.fileName}</button>{file.description && <p className={styles.note}>{file.description}</p>}</div>)}
        {!value.notes && !value.location && !value.files.length && <p className={styles.hint}>Sin referencias adicionales.</p>}
        {preview && <ReferencePreview file={preview} context={{ appointmentId, workOrderId }} onClose={() => setPreview(null)} />}</>}
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.hint} role="status">{message}</p>}
  </div>;
}
