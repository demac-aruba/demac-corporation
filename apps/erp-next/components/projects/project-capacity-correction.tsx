'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrowserProject } from '@/lib/browser-projects';
import {
  adjustHistoricalProjectCapacity,
  loadHistoricalProjectCapacitySources,
  saveSharedProject,
  type HistoricalProjectCapacitySource,
  type HistoricalProjectCapacitySources,
} from '@/lib/shared-projects';
import styles from './project-historical-correction.module.css';

const wholeSlots = [1, 2, 3, 4, 5, 6];

export function ProjectCapacityCorrection({ project, uid, onSaved }: {
  project: BrowserProject;
  uid: string;
  onSaved: (project?: BrowserProject) => void;
}) {
  const [snapshot, setSnapshot] = useState<HistoricalProjectCapacitySources | null>(null);
  const [sourceId, setSourceId] = useState('');
  const [slots, setSlots] = useState(1);
  const [reason, setReason] = useState('');
  const [overBudgetAcknowledged, setOverBudgetAcknowledged] = useState(false);
  const [noBillingAcknowledged, setNoBillingAcknowledged] = useState(false);
  const [publishDraft, setPublishDraft] = useState<BrowserProject | null>(null);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const requestId = useRef('');

  useEffect(() => {
    if (!project.serverVersion) { setSnapshot(null); return; }
    let active = true;
    setLoading(true);
    setError('');
    void loadHistoricalProjectCapacitySources(project.id, uid)
      .then(result => {
        if (!active) return;
        setSnapshot(result);
        setSourceId('');
        setSlots(1);
        setReason('');
        setOverBudgetAcknowledged(false);
        setNoBillingAcknowledged(false);
        requestId.current = '';
      })
      .catch(cause => {
        if (!active) return;
        setSnapshot(null);
        setError(cause instanceof Error ? cause.message : 'Historical Project capacity could not be verified.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project.id, project.serverVersion, refreshNonce, uid]);

  const source = snapshot?.sources.find(item => item.appointmentId === sourceId);
  const delta = source ? slots - source.currentSlots : 0;
  const usedAfter = snapshot ? snapshot.usedSlots + delta : null;
  const remainingBefore = snapshot ? snapshot.budgetSlots - snapshot.usedSlots : null;
  const remainingAfter = snapshot && usedAfter !== null ? snapshot.budgetSlots - usedAfter : null;
  const needsOverBudgetConsent = Boolean(source && snapshot && delta > 0 && usedAfter !== null && usedAfter > snapshot.budgetSlots);
  const canSave = Boolean(source?.eligible && snapshot?.project.serverVersion && delta !== 0
    && wholeSlots.includes(slots) && reason.trim().length >= 5
    && noBillingAcknowledged && (!needsOverBudgetConsent || overBudgetAcknowledged) && !saving && !loading);

  const chooseSource = (item: HistoricalProjectCapacitySource | undefined) => {
    setSourceId(item?.appointmentId || '');
    setSlots(item?.currentSlots || 1);
    setReason('');
    setOverBudgetAcknowledged(false);
    setNoBillingAcknowledged(false);
    setMessage('');
    setError('');
    requestId.current = '';
  };

  const save = async () => {
    if (!canSave || !source || !snapshot?.project.serverVersion) return;
    if (!requestId.current) requestId.current = crypto.randomUUID();
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const result = await adjustHistoricalProjectCapacity({
        projectId: snapshot.project.id,
        appointmentId: source.appointmentId,
        expectedVersion: snapshot.project.serverVersion,
        slots,
        reason: reason.trim(),
        requestId: requestId.current,
        overBudgetAcknowledged: needsOverBudgetConsent && overBudgetAcknowledged,
        noBillingAcknowledged,
      }, uid);
      setSnapshot(current => current ? {
        ...current,
        project: result.project,
        budgetSlots: result.budgetSlots,
        usedSlots: result.usedAfter,
        sources: current.sources.map(item => item.appointmentId === result.appointmentId && result.currentSlots !== null
          ? { ...item, currentSlots: result.currentSlots } : item),
      } : current);
      const currentLabel = result.currentSlots === null ? 'unverified' : `${result.currentSlots} slots`;
      const original = result.replayedEntry;
      setMessage(result.replayed
        ? `Original correction recovered${original ? ` (${original.previousSlots} → ${original.currentSlots} slots)` : ''}; current booking is ${currentLabel} after any later changes. Project usage now: ${result.usedAfter} / ${result.budgetSlots} slots.`
        : `Correction saved: ${result.previousSlots} → ${currentLabel}. Project usage: ${result.usedAfter} / ${result.budgetSlots} slots.`);
      setReason('');
      setOverBudgetAcknowledged(false);
      setNoBillingAcknowledged(false);
      requestId.current = '';
      onSaved(result.project);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The correction could not be verified. Retry the same save.');
    } finally {
      setSaving(false);
    }
  };

  const runPublish = async (dryRun: boolean) => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      // A dry run returns the proposed next serverVersion without writing it.
      // Publish the original browser record so the expected version remains 0.
      const saved = await saveSharedProject(project, uid, dryRun);
      if (dryRun) setPublishDraft(saved);
      else onSaved(saved);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The Project could not be verified.');
    } finally {
      setSaving(false);
    }
  };

  return <section className={styles.panel} aria-label="Historical Project slot correction">
    <h2>Correct historical Project slots</h2>
    {!project.serverVersion ? <>
      <p>Save this Project for shared access before correcting its booked Van slots. Existing links will be verified, and the browser copy is retained.</p>
      {publishDraft ? <>
        <p><strong>{publishDraft.name}</strong> · {publishDraft.phases.length} phases · {publishDraft.assignments.length} verified booking links. Ready to publish.</p>
        <button type="button" disabled={saving} onClick={() => void runPublish(false)}>Save shared Project</button>
      </> : <button type="button" disabled={saving} onClick={() => void runPublish(true)}>Review shared Project</button>}
    </> : <>
      <p>Adjust the original reservation in place. The date, Van, crew and start time stay fixed. This changes booked capacity only—not each technician’s verified hours, Field work, payroll or billing. No automatic customer notification is requested.</p>
      <button type="button" disabled={loading || saving} onClick={() => setRefreshNonce(value => value + 1)}>Refresh bookings</button>
      {loading ? <p role="status">Checking linked bookings and budget…</p> : null}
      {snapshot ? <>
        <div className={styles.fields}>
          <label className={styles.wide}>Past Project booking
            <select value={sourceId} disabled={saving} onChange={event => chooseSource(snapshot.sources.find(item => item.appointmentId === event.target.value))}>
              <option value="">Select a booking</option>
              {snapshot.sources.map(item => <option key={item.appointmentId} value={item.appointmentId}>
                {item.date} · {item.vanName || item.vanId} · {item.start} · {item.currentSlots} slots{item.eligible ? '' : ' · Review required'}
              </option>)}
            </select>
          </label>
          {source ? <>
            <p className={styles.wide}>Recorded crew: <strong>{source.technicianNames?.length ? source.technicianNames.join(' · ') : source.technicianIds.join(' · ') || 'Not verified'}</strong><br />Work Order: {source.workOrderId}</p>
            {source.eligible ? <>
              <label>Booked Van slots after correction
                <select value={slots} disabled={saving} onChange={event => { setSlots(Number(event.target.value)); setOverBudgetAcknowledged(false); requestId.current = ''; setMessage(''); }}>
                  {wholeSlots.map(value => <option key={value} value={value}>{value} slot{value === 1 ? '' : 's'}</option>)}
                </select>
              </label>
              <label className={styles.wide}>Reason for correction
                <textarea maxLength={1000} value={reason} disabled={saving} onChange={event => { setReason(event.target.value); requestId.current = ''; setMessage(''); }} placeholder="What changed after this visit?" />
              </label>
            </> : <p className={styles.wide} role="status">This booking cannot be changed here: {source.reason || 'Field, billing or booking evidence requires review.'}</p>}
          </> : null}
        </div>
        {source?.eligible ? <div className={styles.review}>
          <strong>{source.currentSlots} → {slots} booked Van slots · {delta > 0 ? `+${delta}` : delta} change</strong>
          <p>Project consumption: {snapshot.usedSlots} → {usedAfter} of {snapshot.budgetSlots} approved slots.<br />Budget remaining: {remainingBefore} → {remainingAfter} slots{remainingAfter !== null && remainingAfter < 0 ? ' (over budget)' : ''}.</p>
          {needsOverBudgetConsent ? <label className={styles.check}><input type="checkbox" checked={overBudgetAcknowledged} disabled={saving} onChange={event => { setOverBudgetAcknowledged(event.target.checked); requestId.current = ''; }} />I authorize this Project to exceed its approved slot budget by {Math.abs(remainingAfter || 0)} slot{Math.abs(remainingAfter || 0) === 1 ? '' : 's'}.</label> : null}
          <label className={styles.check}><input type="checkbox" checked={noBillingAcknowledged} disabled={saving} onChange={event => { setNoBillingAcknowledged(event.target.checked); requestId.current = ''; }} />I verified this booking has no invoice or payment, including outside DEMAC ERP.</label>
          <p>Only whole slots 1–6 are supported. Increasing slots requires free contiguous Van and crew capacity; Field or billing evidence blocks this action. The server checks again before saving.</p>
          <button type="button" disabled={!canSave} onClick={() => void save()}>{saving ? 'Saving…' : 'Save slot correction'}</button>
        </div> : null}
        {!snapshot.sources.length ? <p>No past confirmed single-Van Project bookings are available for correction. Nothing was changed.</p> : null}
      </> : null}
    </>}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}{requestId.current ? ' If the connection stopped after saving, retry with the same details to recover the result.' : ''}</p> : null}
  </section>;
}
