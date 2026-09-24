'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrowserProject } from '@/lib/browser-projects';
import type { OfficeAvailabilityResult } from '@/lib/office-booking-authority';
import { projectApi, saveSharedProject } from '@/lib/shared-projects';
import styles from './project-historical-correction.module.css';

type Source = { appointmentId: string; phaseId: string; date: string; vanId: string; vanName: string; technicianNames: string[]; slots: number; starts: string[] };
type Correction = { appointmentId: string; historicalSourceAppointmentId: string; date: string; vanId: string; originalSlots: number; replacementSlots: number; reason: string; recordedAtIso: string; actor: { name: string; id: string } };
export function ProjectHistoricalCorrection({ project, uid, onSaved }: { project: BrowserProject; uid: string; onSaved: (project?: BrowserProject) => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [start, setStart] = useState('08:30');
  const [slots, setSlots] = useState(2);
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [publishDraft, setPublishDraft] = useState<BrowserProject | null>(null);
  const [offer, setOffer] = useState<OfficeAvailabilityResult | null>(null);
  const [attemptedSave, setAttemptedSave] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!project.serverVersion) return;
    let active = true;
    void projectApi<{ sources: Source[]; corrections: Correction[] }>('history_sources', { projectId: project.id }, uid)
      .then(result => { if (active) { setSources(result.sources); setCorrections(result.corrections); } })
      .catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [project.id, project.serverVersion, uid]);
  const source = sources.find(item => item.appointmentId === sourceId);
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { await operation(); } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : 'The correction could not be verified.');
    } finally { if (mounted.current) setBusy(false); }
  };
  const review = () => run(async () => {
    if (!source) return;
    const result = await projectApi<OfficeAvailabilityResult>('history_preview', {
      projectId: project.id, expectedVersion: project.serverVersion, sourceAppointmentId: source.appointmentId, phaseId: source.phaseId,
      start, slots, reason, backdatingAcknowledged: acknowledged, requestId: crypto.randomUUID(),
    }, uid);
    if (!mounted.current) return;
    if (!result.available) throw new Error(result.reason || 'Historical capacity is unavailable.');
    setOffer(result); setAttemptedSave(false);
  });
  const confirm = () => run(async () => {
    if (!offer?.offer) return;
    setAttemptedSave(true);
    await projectApi('history_confirm', { offerId: offer.offer.id, offerVersion: offer.offer.version, optionId: offer.options[0].id,
      requestId: `confirm-${offer.offer.id}`, backdatingAcknowledged: true }, uid);
    if (!mounted.current) return;
    setOffer(null); setSourceId(''); setAttemptedSave(false);
    setMessage('Historical replacement saved. The cancelled booking is preserved and slot totals will refresh.');
    onSaved();
  });
  return <section className={styles.panel} aria-label="Historical Project correction">
    <h2>Historical booking correction</h2>
    {!project.serverVersion ? <>
      <p>Save this Project for shared access before correcting historical bookings. Existing booking links will be verified. Your browser copy is retained.</p>
      {publishDraft ? <>
        <p><strong>{publishDraft.name}</strong> · {publishDraft.phases.length} phases · {publishDraft.assignments.length} verified booking links. Ready to publish.</p>
        <button disabled={busy} onClick={() => void run(async () => { const saved = await saveSharedProject(publishDraft, uid); if (mounted.current) onSaved(saved); })}>Save shared Project</button>
      </> : <button disabled={busy} onClick={() => void run(async () => { await saveSharedProject(project, uid, true); if (mounted.current) setPublishDraft(project); })}>Review shared Project</button>}
    </> : <>
      <p>Choose a cancelled booking to create a smaller reservation for its original date and crew. This corrects booked Van slots, not verified hours worked by each technician. Attendance, Field records, billing and payroll are unchanged.</p>
      <fieldset disabled={busy || Boolean(offer)} className={styles.fields}>
        <label>Cancelled booking<select value={sourceId} onChange={event => { setSourceId(event.target.value); setStart(sources.find(item => item.appointmentId === event.target.value)?.starts[0] || '08:30'); }}>
          <option value="">Select a cancelled booking</option>{sources.map(item => <option key={item.appointmentId} value={item.appointmentId}>{item.date} · {item.vanName} · {item.slots} slots · {item.appointmentId}</option>)}
        </select></label>
        {source ? <>
          <p className={styles.wide}>Recorded crew: <strong>{source.technicianNames.join(' · ') || 'Missing historical crew'}</strong><br />Phase: {project.phases.find(phase => phase.id === source.phaseId)?.name || 'General Project work'}</p>
          <label>Start<select value={start} onChange={event => setStart(event.target.value)}>{source.starts.map(time => <option key={time}>{time}</option>)}</select></label>
          <label>Replacement slots<input type="number" min={1} max={source.slots} step={1} value={slots} onChange={event => setSlots(Number(event.target.value))} /></label>
          <label className={styles.wide}>Correction reason<textarea maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
          <label className={`${styles.wide} ${styles.check}`}><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} />I verified this past date, crew and replacement slot count. No customer notification will be sent.</label>
        </> : null}
      </fieldset>
      {!sources.length ? <p>No eligible cancelled bookings. For an unworked, unbilled booking, cancel the incorrect reservation in Scheduling first, then reload this Project. Do not cancel a completed, invoiced or paid job to change technician hours; that requires a separate actual-work review. Replacements currently require one recorded Van per original booking.</p> : null}
      {offer ? <div className={styles.review}>
        <strong>{offer.options[0].date} · {offer.options[0].time}–{offer.options[0].capacityEndTime}</strong>
        <p>{source?.slots} original slots (cancelled) → {offer.options[0].assignments[0].slots} replacement slots.</p>
        <p>{reason}</p>
        <button disabled={busy} onClick={() => void confirm()}>{attemptedSave ? 'Retry the same save' : 'Save historical replacement'}</button>
        {!attemptedSave ? <button disabled={busy} onClick={() => setOffer(null)}>Edit correction</button> : <p>If the connection was interrupted, retry this same save to recover its result without duplicating the booking.</p>}
      </div> : <button disabled={busy || !source || !acknowledged || reason.trim().length < 5} onClick={() => void review()}>Review correction</button>}
    </>}
    {busy ? <p role="status">Verifying…</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {corrections.length ? <details><summary>Saved corrections ({corrections.length})</summary><ol>{corrections.map(correction => <li key={correction.appointmentId}>
      <strong>{correction.date} · {correction.vanId} · {correction.originalSlots} → {correction.replacementSlots} slots</strong>
      <p>{correction.reason}<br />Recorded by {correction.actor.name || correction.actor.id} · {new Date(correction.recordedAtIso).toLocaleString('en', { timeZone: 'America/Aruba' })} (Aruba)<br />Cancelled: {correction.historicalSourceAppointmentId}<br />Replacement: {correction.appointmentId}</p>
    </li>)}</ol></details> : null}
  </section>;
}
