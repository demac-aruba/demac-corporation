'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  checkOfficeRescheduleAvailability,
  createOfficeLifecycleRequestId,
  getOfficeAppointment,
  listOfficeBookingPresets,
  rescheduleOfficeAppointment,
  type OfficeAvailabilityResult,
  type OfficeBookingPreset,
  type OfficeBookingWorkLine,
} from '../../lib/office-booking-authority';
import styles from './scheduling-overview-v2.module.css';

type Props = {
  appointment: BrowserAppointmentRecord;
  onBack: () => void;
  onSaved: () => Promise<void> | void;
};

type EditLine = OfficeBookingWorkLine;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function isOtherPreset(preset?: OfficeBookingPreset) {
  const value = `${preset?.id ?? ''} ${preset?.label ?? ''}`.toLowerCase();
  return /(^|[^a-z])(other|otro)([^a-z]|$)/.test(value);
}

function hoursLabel(minutes: number) {
  const hours = Math.max(0, Number(minutes) || 0) / 60;
  const value = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
  return `${value} hour${hours === 1 ? '' : 's'}`;
}

function autoDescription(lines: EditLine[], presetById: Map<string, OfficeBookingPreset>) {
  const entries = lines.map((line) => {
    const preset = presetById.get(line.presetId);
    return preset ? `${line.quantity} × ${preset.label}` : '';
  }).filter(Boolean);
  return entries.length ? `Scheduled work: ${entries.join('; ')}.` : '';
}

function normalizeCanonicalLines(value: unknown): EditLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      id: text(record.id) || `edit-work-${index + 1}`,
      presetId: text(record.presetId),
      serviceId: text(record.serviceId) || undefined,
      quantity: Math.max(1, Number(record.quantity) || 1),
      manualDurationMinutes: Number(record.manualDurationMinutes) || undefined,
      customerFacingDescription: text(record.customerFacingDescription) || undefined,
      technicianInstructions: text(record.technicianInstructions) || undefined,
    };
  }).filter((line) => line.presetId);
}

export function LiveAppointmentEditPanel({ appointment, onBack, onSaved }: Props) {
  const [presets, setPresets] = useState<OfficeBookingPreset[]>([]);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [description, setDescription] = useState(appointment.customerFacingDescription || '');
  const [instructions, setInstructions] = useState(appointment.technicianInstructions || '');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [availability, setAvailability] = useState<OfficeAvailabilityResult | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState('');
  const lastAutoRef = useRef('');

  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment && assignment.status !== 'cancelled')
    ?? appointment.assignments.find((assignment) => assignment.status !== 'cancelled')
    ?? appointment.assignments[0];
  const presetById = useMemo(() => new Map(presets.map((preset) => [preset.id, preset])), [presets]);
  const generatedDescription = useMemo(() => autoDescription(lines, presetById), [lines, presetById]);
  const selectedOption = availability?.options.find((option) => option.id === selectedOptionId)
    ?? availability?.options[0]
    ?? null;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void Promise.all([getOfficeAppointment(appointment.id), listOfficeBookingPresets(true)])
      .then(([canonical, presetResult]) => {
        if (!active) return;
        const activePresets = presetResult.presets.filter((preset) => preset.active !== false);
        setPresets(activePresets);
        const rawLines = normalizeCanonicalLines(canonical.appointment.workLines);
        const fallbackPresetId = appointment.workTypeId || appointment.presetId;
        const fallbackPreset = activePresets.find((preset) => preset.id === fallbackPresetId);
        const fallback: EditLine[] = fallbackPresetId ? [{
          id: `${appointment.id}-edit-work`,
          presetId: fallbackPresetId,
          serviceId: appointment.serviceId,
          quantity: Math.max(1, appointment.totalQuantity || 1),
          ...(isOtherPreset(fallbackPreset) ? { manualDurationMinutes: appointment.scheduledDurationMinutes || 60 } : {}),
        }] : [];
        const nextLines = rawLines.length ? rawLines : fallback;
        setLines(nextLines);
        const first = rawLines[0];
        const canonicalDescription = text(first?.customerFacingDescription) || appointment.customerFacingDescription || '';
        const canonicalInstructions = text(first?.technicianInstructions) || appointment.technicianInstructions || '';
        setDescription(canonicalDescription);
        setInstructions(canonicalInstructions);
        const byId = new Map(activePresets.map((preset) => [preset.id, preset]));
        lastAutoRef.current = autoDescription(nextLines, byId);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : 'The canonical appointment could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [appointment]);

  useEffect(() => {
    const previousAuto = lastAutoRef.current;
    setDescription((current) => {
      if (!current.trim() || current.trim() === previousAuto.trim()) return generatedDescription;
      if (previousAuto && current.startsWith(previousAuto)) return `${generatedDescription}${current.slice(previousAuto.length)}`;
      return current;
    });
    lastAutoRef.current = generatedDescription;
  }, [generatedDescription]);

  const resetValidation = () => {
    setAvailability(null);
    setSelectedOptionId('');
    setError('');
  };

  const addPreset = (preset: OfficeBookingPreset) => {
    setLines((current) => {
      const existing = current.find((line) => line.presetId === preset.id);
      if (existing) {
        if (isOtherPreset(preset)) return current;
        return current.map((line) => line.id === existing.id ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line);
      }
      return [...current, {
        id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        presetId: preset.id,
        serviceId: preset.serviceId,
        quantity: 1,
        ...(isOtherPreset(preset) ? { manualDurationMinutes: 60 } : {}),
      }];
    });
    resetValidation();
  };

  const changeQuantity = (id: string, delta: number) => {
    setLines((current) => current.map((line) => line.id === id
      ? { ...line, quantity: Math.max(1, Math.min(20, line.quantity + delta)) }
      : line));
    resetValidation();
  };

  const changeManualHours = (id: string, hours: number) => {
    const minutes = Math.max(60, Math.min(720, Math.round(hours * 2) * 30));
    setLines((current) => current.map((line) => line.id === id ? { ...line, manualDurationMinutes: minutes } : line));
    resetValidation();
  };

  const removeLine = (id: string) => {
    setLines((current) => current.filter((line) => line.id !== id));
    resetValidation();
  };

  const workValid = lines.length > 0 && lines.every((line) => {
    const preset = presetById.get(line.presetId);
    if (!preset || line.quantity < 1) return false;
    if (!isOtherPreset(preset)) return true;
    const minutes = Number(line.manualDurationMinutes || 0);
    return minutes >= 60 && minutes <= 720 && minutes % 30 === 0;
  });

  const validateChanges = async () => {
    if (!appointment.customerId || !appointment.siteId || !primary?.vanId || !primary.start) {
      setError('This appointment is missing its canonical customer, property, van, or start time.');
      return;
    }
    if (!workValid) {
      setError('Add at least one valid work type. Other requires a manual duration.');
      return;
    }
    setBusy(true);
    setError('');
    setAvailability(null);
    try {
      const result = await checkOfficeRescheduleAvailability({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('details-edit-check'),
        customerId: appointment.customerId,
        propertyId: appointment.siteId,
        workLines: lines.map((line) => ({
          ...line,
          customerFacingDescription: description.trim(),
          technicianInstructions: instructions.trim(),
        })),
        requestedDate: appointment.dateKey,
        requestedTime: primary.start,
        requiredVanId: primary.vanId,
        customerFacingDescription: description.trim(),
        technicianInstructions: instructions.trim(),
        notes: `Edited from LIVE Scheduling appointment ${appointment.id}.`,
        changeKind: 'details_edited',
      });
      const exact = result.options.find((option) => option.date === appointment.dateKey
        && option.time === primary.start
        && option.assignments?.[0]?.vanId === primary.vanId);
      if (!result.available || !result.offer || !exact) {
        setError(`The edited work does not fit the appointment's existing capacity${result.reason ? ` (${result.reason})` : ''}. Use Reschedule if the schedule must change.`);
        return;
      }
      setAvailability({ ...result, options: [exact] });
      setSelectedOptionId(exact.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The appointment changes could not be validated.');
    } finally {
      setBusy(false);
    }
  };

  const saveChanges = async () => {
    if (!availability?.offer || !selectedOption || busy) return;
    setBusy(true);
    setError('');
    try {
      await rescheduleOfficeAppointment({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('details-edit-save'),
        offerId: availability.offer.id,
        offerVersion: availability.offer.version,
        optionId: selectedOption.id,
        reason: 'Appointment work/details updated',
        note: 'Edited from Live Scheduling appointment details.',
        changeKind: 'details_edited',
      });
      await onSaved();
    } catch (cause) {
      setAvailability(null);
      setSelectedOptionId('');
      setError(cause instanceof Error ? cause.message : 'The appointment changes could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return <section className={styles.formSection}>
    <header><strong>Edit appointment</strong><span>Work details may change; date, start time and primary Van stay fixed.</span></header>
    <div style={{ padding: 11, display: 'grid', gap: 10 }}>
      {loading ? <div className={styles.descriptionPreview}><span>LOADING</span><strong>Loading canonical appointment…</strong></div> : null}
      {!loading ? <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 6 }}>
          {presets.map((preset) => {
            const selected = lines.find((line) => line.presetId === preset.id);
            return <button key={preset.id} type="button" className={styles.secondary} disabled={busy} onClick={() => addPreset(preset)} style={{ textAlign: 'left', padding: 9 }}>
              <strong style={{ display: 'block' }}>{preset.label}</strong>
              <span style={{ display: 'block', marginTop: 3, fontSize: 8, color: 'var(--muted)' }}>{isOtherPreset(preset) ? 'Manual scheduled time' : `${hoursLabel(preset.durationMinutesPerUnit)} / unit`}{selected ? ` · selected × ${selected.quantity}` : ''}</span>
            </button>;
          })}
        </div>

        {lines.map((line) => {
          const preset = presetById.get(line.presetId);
          if (!preset) return null;
          return <div key={line.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: 9 }}>
            <div>
              <strong>{preset.label}</strong>
              {isOtherPreset(preset) ? <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}><span style={{ fontSize: 8, color: 'var(--muted)' }}>Hours</span><input type="number" min={1} max={12} step={0.5} value={(line.manualDurationMinutes || 60) / 60} onChange={(event) => changeManualHours(line.id, Number(event.target.value))} style={{ width: 75 }} /></label> : <span style={{ display: 'block', marginTop: 3, fontSize: 8, color: 'var(--muted)' }}>{hoursLabel(preset.durationMinutesPerUnit)} each</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {!isOtherPreset(preset) ? <><button type="button" className={styles.secondary} onClick={() => changeQuantity(line.id, -1)} disabled={busy}>−</button><strong>{line.quantity}</strong><button type="button" className={styles.secondary} onClick={() => changeQuantity(line.id, 1)} disabled={busy}>＋</button></> : null}
              <button type="button" className={styles.secondary} onClick={() => removeLine(line.id)} disabled={busy}>Remove</button>
            </div>
          </div>;
        })}

        <div className={styles.formGrid}>
          <label className={styles.wide}><span>Customer-facing work description</span><textarea rows={3} value={description} onChange={(event) => { setDescription(event.target.value); resetValidation(); }} /></label>
          <label className={styles.wide}><span>Technician instructions</span><textarea rows={3} value={instructions} onChange={(event) => { setInstructions(event.target.value); resetValidation(); }} /></label>
        </div>

        {availability?.offer && selectedOption ? <div className={styles.descriptionPreview}><span>BOOKING AUTHORITY APPROVED</span><strong>{selectedOption.assignments?.[0]?.slots ?? 0} capacity spot(s) · {selectedOption.endTime ? `ends ${selectedOption.endTime}` : 'validated'}</strong></div> : null}
        {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
      </> : null}
    </div>
    <footer className={styles.drawerFooter}>
      <div><span>Schedule remains</span><strong>{appointment.dateKey} · {primary?.start || '—'} · {primary?.vanId?.replace('VAN-', 'Van ') || '—'}</strong></div>
      <div>
        <button type="button" className={styles.secondary} disabled={busy} onClick={onBack}>Back</button>
        {!availability?.offer ? <button type="button" className={styles.primary} disabled={busy || loading || !workValid} onClick={() => void validateChanges()}>{busy ? 'Validating…' : 'Validate changes'}</button> : <button type="button" className={styles.primary} disabled={busy} onClick={() => void saveChanges()}>{busy ? 'Saving…' : 'Save changes'}</button>}
      </div>
    </footer>
  </section>;
}
