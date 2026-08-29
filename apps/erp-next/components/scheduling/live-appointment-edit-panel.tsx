'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BrowserAppointmentRecord } from '../../lib/browser-operational';
import {
  appointmentDraftHydrationAllowed,
  fixedAppointmentOptions,
  optionAssignmentIsSupport,
  optionSupportAssignment,
} from '../../lib/live-appointment-edit-state';
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

type EditValidation = {
  signature: string;
  result: OfficeAvailabilityResult;
  selectedOptionId: string;
};

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

function normalizedDescription(value: string) {
  return value.trim().replace(/\s+/g, ' ').replace(/[.;]+$/, '').toLowerCase();
}

function isGeneratedDescription(value: string, lines: EditLine[], presetById: Map<string, OfficeBookingPreset>) {
  const quantityFirst = lines.map((line) => {
    const preset = presetById.get(line.presetId);
    return preset ? `${line.quantity} × ${preset.label}` : '';
  }).filter(Boolean);
  const labelFirst = lines.map((line) => {
    const preset = presetById.get(line.presetId);
    return preset ? `${preset.label} × ${line.quantity}` : '';
  }).filter(Boolean);
  const candidates = [
    autoDescription(lines, presetById),
    quantityFirst.join('; '),
    labelFirst.join('; '),
    `Scheduled work: ${labelFirst.join('; ')}.`,
  ];
  const normalized = normalizedDescription(value);
  return Boolean(normalized) && candidates.some((candidate) => normalizedDescription(candidate) === normalized);
}

function formatTime(value: string) {
  const [hourText, minute = '00'] = value.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function appointmentDraftRevision(appointment: BrowserAppointmentRecord) {
  const workLines = (appointment.workLines ?? []).map((line) => [
    line.presetId,
    line.quantity,
    line.customerFacingDescription ?? '',
    line.technicianInstructions ?? '',
  ].join(':')).join('|');
  return [
    appointment.id,
    appointment.updatedAt ?? '',
    appointment.totalQuantity,
    appointment.workTypeId ?? appointment.presetId,
    appointment.serviceId ?? '',
    appointment.customerFacingDescription,
    appointment.technicianInstructions ?? '',
    workLines,
  ].join('|');
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
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [validated, setValidated] = useState<EditValidation | null>(null);
  const lastAutoRef = useRef('');
  const draftDirtyRef = useRef(false);
  const hydratedAppointmentIdRef = useRef('');
  const validationEpochRef = useRef(0);
  const validationSignatureRef = useRef('');
  const validationTimerRef = useRef<number | null>(null);

  const primary = appointment.assignments.find((assignment) => assignment.isPrimaryAssignment && assignment.status !== 'cancelled')
    ?? appointment.assignments.find((assignment) => assignment.status !== 'cancelled')
    ?? appointment.assignments[0];
  const presetById = useMemo(() => new Map(presets.map((preset) => [preset.id, preset])), [presets]);
  const generatedDescription = useMemo(() => autoDescription(lines, presetById), [lines, presetById]);
  const hydrationRevision = appointmentDraftRevision(appointment);
  const workSignature = lines.map((line) => `${line.presetId}:${line.serviceId ?? ''}:${line.quantity}:${line.manualDurationMinutes ?? ''}`).join('|');
  const signature = [
    appointment.id,
    appointment.customerId,
    appointment.siteId,
    appointment.dateKey,
    primary?.vanId,
    primary?.start,
    workSignature,
    description.trim(),
    instructions.trim(),
  ].join('|');
  validationSignatureRef.current = signature;
  const activeValidation = validated?.signature === signature ? validated : null;
  const selectedOption = activeValidation?.result.options.find((option) => option.id === activeValidation.selectedOptionId)
    ?? activeValidation?.result.options[0]
    ?? null;

  useEffect(() => {
    let active = true;
    const sourceAppointment = appointment;
    const initialHydration = hydratedAppointmentIdRef.current !== sourceAppointment.id;
    if (!appointmentDraftHydrationAllowed(hydratedAppointmentIdRef.current, sourceAppointment.id, draftDirtyRef.current)) return;
    if (initialHydration) {
      draftDirtyRef.current = false;
      setLoading(true);
    }
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
    }
    validationEpochRef.current += 1;
    setChecking(false);
    setValidated(null);
    setError('');
    void Promise.all([getOfficeAppointment(sourceAppointment.id), listOfficeBookingPresets(true)])
      .then(([canonical, presetResult]) => {
        if (!active || !appointmentDraftHydrationAllowed(hydratedAppointmentIdRef.current, sourceAppointment.id, draftDirtyRef.current)) return;
        const activePresets = presetResult.presets.filter((preset) => preset.active !== false);
        setPresets(activePresets);
        const rawLines = normalizeCanonicalLines(canonical.appointment.workLines);
        const fallbackPresetId = sourceAppointment.workTypeId || sourceAppointment.presetId;
        const fallbackPreset = activePresets.find((preset) => preset.id === fallbackPresetId);
        const fallback: EditLine[] = fallbackPresetId ? [{
          id: `${sourceAppointment.id}-edit-work`,
          presetId: fallbackPresetId,
          serviceId: sourceAppointment.serviceId,
          quantity: Math.max(1, sourceAppointment.totalQuantity || 1),
          ...(isOtherPreset(fallbackPreset) ? { manualDurationMinutes: sourceAppointment.scheduledDurationMinutes || 60 } : {}),
        }] : [];
        const nextLines = rawLines.length ? rawLines : fallback;
        setLines(nextLines);
        const first = rawLines[0];
        const canonicalDescription = text(first?.customerFacingDescription) || sourceAppointment.customerFacingDescription || '';
        const canonicalInstructions = text(first?.technicianInstructions) || sourceAppointment.technicianInstructions || '';
        setDescription(canonicalDescription);
        setInstructions(canonicalInstructions);
        const byId = new Map(activePresets.map((preset) => [preset.id, preset]));
        lastAutoRef.current = isGeneratedDescription(canonicalDescription, nextLines, byId)
          ? canonicalDescription
          : autoDescription(nextLines, byId);
        draftDirtyRef.current = false;
        hydratedAppointmentIdRef.current = sourceAppointment.id;
      })
      .catch((cause) => {
        if (active && appointmentDraftHydrationAllowed(hydratedAppointmentIdRef.current, sourceAppointment.id, draftDirtyRef.current)) {
          setError(cause instanceof Error ? cause.message : 'The canonical appointment could not be loaded.');
        }
      })
      .finally(() => {
        if (active && initialHydration) setLoading(false);
    });
    return () => { active = false; };
  }, [hydrationRevision]);

  useEffect(() => {
    const previousAuto = lastAutoRef.current;
    setDescription((current) => {
      if (!current.trim() || current.trim() === previousAuto.trim()) return generatedDescription;
      if (previousAuto && current.startsWith(previousAuto)) return `${generatedDescription}${current.slice(previousAuto.length)}`;
      return current;
    });
    lastAutoRef.current = generatedDescription;
  }, [generatedDescription]);

  const resetValidation = useCallback(() => {
    draftDirtyRef.current = true;
    validationEpochRef.current += 1;
    setChecking(false);
    setValidated(null);
    setError('');
  }, []);

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

  const validateChanges = useCallback(async (automatic = false) => {
    if (validationTimerRef.current !== null) {
      window.clearTimeout(validationTimerRef.current);
      validationTimerRef.current = null;
    }
    if (!appointment.customerId || !appointment.siteId || !primary?.vanId || !primary.start) {
      if (!automatic) setError('This appointment is missing its canonical customer, property, van, or start time.');
      return;
    }
    if (!workValid) {
      if (!automatic) setError('Add at least one valid work type. Other requires a manual duration.');
      return;
    }

    const requestEpoch = validationEpochRef.current + 1;
    validationEpochRef.current = requestEpoch;
    const validationSignature = signature;
    setChecking(true);
    setError('');
    setValidated(null);
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
      if (requestEpoch !== validationEpochRef.current || validationSignatureRef.current !== validationSignature) return;
      const exactOptions = fixedAppointmentOptions(result.options, { dateKey: appointment.dateKey, start: primary.start, vanId: primary.vanId });
      if (!result.available || !result.offer || !exactOptions.length) {
        setError(`The edited work does not fit the appointment's existing capacity${result.reason ? ` (${result.reason})` : ''}. Use Reschedule if the schedule must change.`);
        return;
      }
      setValidated({
        signature: validationSignature,
        result: { ...result, options: exactOptions },
        selectedOptionId: exactOptions[0].id,
      });
    } catch (cause) {
      if (requestEpoch === validationEpochRef.current && validationSignatureRef.current === validationSignature) {
        setError(cause instanceof Error ? cause.message : 'The appointment changes could not be validated.');
      }
    } finally {
      if (requestEpoch === validationEpochRef.current) setChecking(false);
    }
  }, [appointment.customerId, appointment.dateKey, appointment.id, appointment.siteId, description, instructions, lines, primary?.start, primary?.vanId, signature, workValid]);

  useEffect(() => {
    if (loading || saving || !appointment.customerId || !appointment.siteId || !primary?.vanId || !primary.start || !workValid) return;
    const timer = window.setTimeout(() => { void validateChanges(true); }, 350);
    validationTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (validationTimerRef.current === timer) validationTimerRef.current = null;
    };
  }, [appointment.customerId, appointment.siteId, loading, primary?.start, primary?.vanId, saving, validateChanges, workValid]);

  const saveChanges = async () => {
    if (!activeValidation?.result.offer || !selectedOption || saving || checking) return;
    setSaving(true);
    setError('');
    try {
      await rescheduleOfficeAppointment({
        appointmentId: appointment.id,
        requestId: createOfficeLifecycleRequestId('details-edit-save'),
        offerId: activeValidation.result.offer.id,
        offerVersion: activeValidation.result.offer.version,
        optionId: selectedOption.id,
        reason: 'Appointment work/details updated',
        note: 'Edited from Live Scheduling appointment details.',
        changeKind: 'details_edited',
      });
      await onSaved();
    } catch (cause) {
      validationEpochRef.current += 1;
      setValidated(null);
      setError(cause instanceof Error ? cause.message : 'The appointment changes could not be saved.');
    } finally {
      setSaving(false);
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
            return <button key={preset.id} type="button" className={styles.secondary} disabled={saving} onClick={() => addPreset(preset)} style={{ textAlign: 'left', padding: 9 }}>
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
              {isOtherPreset(preset) ? <label style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}><span style={{ fontSize: 8, color: 'var(--muted)' }}>Hours</span><input type="number" min={1} max={12} step={0.5} disabled={saving} value={(line.manualDurationMinutes || 60) / 60} onChange={(event) => changeManualHours(line.id, Number(event.target.value))} style={{ width: 75 }} /></label> : <span style={{ display: 'block', marginTop: 3, fontSize: 8, color: 'var(--muted)' }}>{hoursLabel(preset.durationMinutesPerUnit)} each</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {!isOtherPreset(preset) ? <><button type="button" className={styles.secondary} onClick={() => changeQuantity(line.id, -1)} disabled={saving}>−</button><strong>{line.quantity}</strong><button type="button" className={styles.secondary} onClick={() => changeQuantity(line.id, 1)} disabled={saving}>＋</button></> : null}
              <button type="button" className={styles.secondary} onClick={() => removeLine(line.id)} disabled={saving}>Remove</button>
            </div>
          </div>;
        })}

        <div className={styles.formGrid}>
          <label className={styles.wide}><span>Customer-facing work description</span><textarea rows={3} disabled={saving} value={description} onChange={(event) => { setDescription(event.target.value); resetValidation(); }} /></label>
          <label className={styles.wide}><span>Technician instructions</span><textarea rows={3} disabled={saving} value={instructions} onChange={(event) => { setInstructions(event.target.value); resetValidation(); }} /></label>
        </div>

        {checking ? <div className={styles.descriptionPreview}><span>CHECKING LIVE CAPACITY</span><strong>Booking Authority is validating this draft in the background. You can keep editing.</strong></div> : null}
        {activeValidation?.result.offer && selectedOption ? <div className={styles.descriptionPreview} style={{ display: 'grid', gap: 8 }}>
          <span>{optionSupportAssignment(selectedOption) ? 'BOOKING AUTHORITY APPROVED · VAN SUPPORT REQUIRED' : 'BOOKING AUTHORITY APPROVED'}</span>
          {activeValidation.result.options.length > 1 ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 6 }}>
            {activeValidation.result.options.map((option) => {
              const support = optionSupportAssignment(option);
              const selected = option.id === selectedOption.id;
              return <button
                type="button"
                key={option.id}
                className={styles.secondary}
                disabled={saving}
                onClick={() => setValidated((current) => current?.signature === signature ? { ...current, selectedOptionId: option.id } : current)}
                style={{ textAlign: 'left', padding: 8, borderColor: selected ? 'var(--brand)' : undefined, background: selected ? 'var(--brand-soft)' : undefined }}
              >
                <strong style={{ display: 'block' }}>{support ? `${support.vanName || support.vanId} · support` : 'Primary allocation'}</strong>
                <span style={{ display: 'block', marginTop: 3 }}>{support ? `${support.quantity} support service${support.quantity === 1 ? '' : 's'}` : 'No support Van required'}</span>
              </button>;
            })}
          </div> : null}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(145px,1fr))', gap: 6 }}>
            {selectedOption.assignments.map((assignment, index) => {
              const support = optionAssignmentIsSupport(selectedOption, assignment);
              const start = assignment.time || selectedOption.time;
              const end = assignment.endTime || (support ? '' : selectedOption.endTime || '');
              return <article key={`${assignment.vanId}-${start}-${index}`} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 8, background: 'var(--surface)' }}>
                <span style={{ display: 'block' }}>{support ? 'SUPPORT' : 'PRIMARY / RESPONSIBLE'}</span>
                <strong style={{ display: 'block', marginTop: 3 }}>{assignment.vanName || assignment.vanId}</strong>
                <small style={{ display: 'block', marginTop: 3 }}>{assignment.quantity} service{assignment.quantity === 1 ? '' : 's'} · {formatTime(start)}{end ? `–${formatTime(end)}` : ''}</small>
              </article>;
            })}
          </div>
        </div> : null}
        {error ? <div className={styles.descriptionPreview}><span>ATTENTION</span><strong>{error}</strong></div> : null}
      </> : null}
    </div>
    <footer className={styles.drawerFooter}>
      <div><span>Schedule remains</span><strong>{appointment.dateKey} · {primary?.start || '—'} · {primary?.vanId?.replace('VAN-', 'Van ') || '—'}</strong></div>
      <div>
        <button type="button" className={styles.secondary} disabled={saving} onClick={onBack}>Back</button>
        <button type="button" className={styles.secondary} disabled={saving || checking || loading || !workValid} onClick={() => void validateChanges(false)}>{checking ? 'Checking…' : 'Recheck now'}</button>
        <button type="button" className={styles.primary} disabled={saving || checking || !activeValidation?.result.offer || !selectedOption} onClick={() => void saveChanges()}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>
    </footer>
  </section>;
}
