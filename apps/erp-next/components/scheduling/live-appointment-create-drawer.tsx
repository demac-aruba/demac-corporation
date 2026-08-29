'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAfterHoursEmergency } from '../../lib/after-hours-booking';
import type { AppointmentRecipientSelection } from '../../lib/customer-contacts';
import {
  checkOfficeCreateAvailability,
  confirmOfficeAppointment,
  createOfficeLifecycleRequestId,
  createOfficeTemporaryHold,
  listOfficeBookingPresets,
  type OfficeBookingOption,
  type OfficeBookingPreset,
  type OfficeBookingWorkLine,
} from '../../lib/office-booking-authority';
import {
  createBookingCustomerWithProperty,
  createBookingProperty,
  loadBookingReferenceData,
  type BookingCustomer,
  type BookingProperty,
  type BookingReferenceData,
  type NewBookingCustomer,
  type NewBookingProperty,
} from '../../lib/live-scheduling-booking-data';
import {
  liveVanCrew,
  loadLiveOperationalCapacityState,
} from '../../lib/live-operational-capacity';
import {
  suggestArubaAddresses,
  type ArubaAddressEntry,
} from '../../lib/aruba-address-directory';
import { PropertyCommunicationPanel, PropertyContactDraftEditor } from './property-communication-editor';
import styles from './live-appointment-create-drawer.module.css';

export type LiveBookingTarget = {
  dateKey: string;
  vanId: string;
  vanName: string;
  start: string;
  end: string;
};

export type LiveCreatedBooking = {
  appointmentId: string;
  workOrderIds: string[];
  option: OfficeBookingOption;
  customer: BookingCustomer;
  property: BookingProperty;
  preset: OfficeBookingPreset;
  status: 'confirmed' | 'temporary_hold';
};

export type LiveBookingMode = 'standard' | 'after_hours';

type Props = {
  target: LiveBookingTarget;
  mode?: LiveBookingMode;
  onClose: () => void;
  onCreated: (booking: LiveCreatedBooking) => void;
};

type CustomerDraft = NewBookingCustomer & {
  preferredLanguage: string;
};

type PropertyDraft = NewBookingProperty & {
  type: string;
  addressDetail: string;
};

type WorkLineDraft = {
  id: string;
  presetId: string;
  quantity: number;
  manualDurationMinutes?: number;
};

type ValidationState = {
  signature: string;
  offerId: string;
  offerVersion: number;
  options: OfficeBookingOption[];
  selectedOptionId: string;
};

const emptyCustomer: CustomerDraft = {
  name: '',
  company: '',
  phone: '',
  whatsapp: '',
  email: '',
  preferredLanguage: 'Papiamento',
};

const emptyProperty: PropertyDraft = {
  name: '',
  type: 'Casa',
  address: '',
  addressDetail: '',
  zone: '',
  neighborhood: '',
  notes: '',
  contactLinks: [],
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function validAfterHoursStart(value: string) {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 && hour * 60 + minute >= 17 * 60;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function durationLabel(minutes: number) {
  const hours = Math.max(0, minutes) / 60;
  const value = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
  return `${value} hour${hours === 1 ? '' : 's'}`;
}

function customerLabel(customer: BookingCustomer) {
  return text(customer.company) || text(customer.name) || customer.id;
}

function normalizeSearch(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function searchFieldScore(value: unknown, needle: string, priority: number) {
  const candidate = normalizeSearch(value);
  if (!candidate || !needle) return 0;
  if (candidate === needle) return 100 + priority;
  if (candidate.startsWith(needle)) return 85 + priority;
  if (candidate.split(' ').some((part) => part.startsWith(needle))) return 72 + priority;
  if (candidate.includes(needle)) return 55 + priority;
  return 0;
}

function customerSearchScore(customer: BookingCustomer, needle: string, propertySearchValues: string[]) {
  const directScores = [
    searchFieldScore(customer.name, needle, 30),
    searchFieldScore(customer.company, needle, 28),
    searchFieldScore(customer.phone, needle, 25),
    searchFieldScore(customer.whatsapp, needle, 25),
    searchFieldScore(customer.email, needle, 20),
    searchFieldScore(customer.address, needle, 10),
    searchFieldScore(customer.zone, needle, 8),
  ];
  const propertyScore = propertySearchValues.reduce((best, value) => Math.max(best, searchFieldScore(value, needle, 5)), 0);
  return Math.max(propertyScore, ...directScores);
}

function propertyLabel(property: BookingProperty) {
  return text(property.name) || text(property.address) || property.id;
}

function optionMatchesTarget(option: OfficeBookingOption, target: LiveBookingTarget) {
  const primary = option.assignments?.[0];
  return option.date === target.dateKey
    && option.time === target.start
    && primary?.vanId === target.vanId;
}

function materializePropertyDraft(draft: PropertyDraft): NewBookingProperty {
  const base = text(draft.address);
  const detail = text(draft.addressDetail);
  const address = detail && !base.toLowerCase().endsWith(detail.toLowerCase())
    ? `${base} ${detail}`
    : base;
  return {
    name: text(draft.name),
    type: text(draft.type),
    address,
    zone: text(draft.zone),
    neighborhood: text(draft.neighborhood),
    notes: text(draft.notes),
    contactLinks: draft.contactLinks ?? [],
  };
}

function supportAssignment(option: OfficeBookingOption) {
  return option.assignments?.[1];
}

function allocationDurationLabel(option: OfficeBookingOption | null, fallbackMinutes: number) {
  if (!option) return fallbackMinutes > 360 ? 'Large job · validate allocation' : fallbackMinutes ? durationLabel(fallbackMinutes) : 'Add work';
  const primary = option.assignments?.[0];
  if (!primary) return fallbackMinutes ? durationLabel(fallbackMinutes) : 'Validated';
  const primaryLabel = primary.fullDay ? 'Full-day primary van' : durationLabel(primary.durationMinutes || primary.slots * 60);
  return option.assignments.length > 1 ? `${primaryLabel} + support van` : primaryLabel;
}

function isOtherPreset(preset?: OfficeBookingPreset) {
  const value = `${preset?.id ?? ''} ${preset?.label ?? ''}`.toLowerCase();
  return /(^|[^a-z])(other|otro)([^a-z]|$)/.test(value);
}

function newWorkLine(preset: OfficeBookingPreset): WorkLineDraft {
  return {
    id: `work-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    presetId: preset.id,
    quantity: 1,
    ...(isOtherPreset(preset) ? { manualDurationMinutes: 60 } : {}),
  };
}

function automaticCustomerDescription(workLines: WorkLineDraft[], presetById: Map<string, OfficeBookingPreset>) {
  const entries = workLines.map((line) => {
    const preset = presetById.get(line.presetId);
    return preset ? `${line.quantity} × ${preset.label}` : '';
  }).filter(Boolean);
  return entries.length ? `Scheduled work: ${entries.join('; ')}.` : '';
}

export function LiveAppointmentCreateDrawer({ target, mode = 'standard', onClose, onCreated }: Props) {
  const isAfterHours = mode === 'after_hours';
  const [references, setReferences] = useState<BookingReferenceData>({ clients: [], properties: [], contacts: [], contactAssignments: [] });
  const [presets, setPresets] = useState<OfficeBookingPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [crewLabel, setCrewLabel] = useState('Crew loading…');
  const [customerQuery, setCustomerQuery] = useState('');
  const [requestedStart, setRequestedStart] = useState(target.start);
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [recipientSelections, setRecipientSelections] = useState<AppointmentRecipientSelection[]>([]);
  const [workLines, setWorkLines] = useState<WorkLineDraft[]>([]);
  const [description, setDescription] = useState('');
  const lastAutoDescriptionRef = useRef('');
  const validationEpochRef = useRef(0);
  const validationSignatureRef = useRef('');
  const [technicianInstructions, setTechnicianInstructions] = useState('');
  const [customerEditorOpen, setCustomerEditorOpen] = useState(false);
  const [propertyEditorOpen, setPropertyEditorOpen] = useState(false);
  const [customerDraft, setCustomerDraft] = useState<CustomerDraft>(emptyCustomer);
  const [customerPropertyDraft, setCustomerPropertyDraft] = useState<PropertyDraft>(emptyProperty);
  const [propertyDraft, setPropertyDraft] = useState<PropertyDraft>(emptyProperty);
  const [masterSaving, setMasterSaving] = useState(false);
  const [masterError, setMasterError] = useState('');
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [holding, setHolding] = useState(false);
  const [authorityError, setAuthorityError] = useState('');
  const [validated, setValidated] = useState<ValidationState | null>(null);

  const requestTarget = useMemo<LiveBookingTarget>(() => ({
    dateKey: target.dateKey,
    vanId: target.vanId,
    vanName: target.vanName,
    start: requestedStart,
    end: target.end,
  }), [requestedStart, target.dateKey, target.end, target.vanId, target.vanName]);

  const refreshReferences = async () => {
    const next = await loadBookingReferenceData();
    setReferences(next);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void Promise.all([loadBookingReferenceData(), listOfficeBookingPresets(true)])
      .then(([referenceData, presetResult]) => {
        if (!active) return;
        setReferences(referenceData);
        setPresets(presetResult.presets.filter((preset) => preset.active !== false));
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Scheduling reference data could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setCrewLabel('Crew loading…');
    void loadLiveOperationalCapacityState({ startDate: target.dateKey, endDate: target.dateKey })
      .then((state) => {
        if (active) setCrewLabel(liveVanCrew(state, target.vanId, target.dateKey).label);
      })
      .catch(() => {
        if (active) setCrewLabel('Crew unavailable');
      });
    return () => { active = false; };
  }, [target.dateKey, target.vanId]);

  const selectedCustomer = references.clients.find((customer) => customer.id === customerId);
  const customerProperties = useMemo(
    () => references.properties.filter((property) => property.clientId === customerId && property.active !== false),
    [customerId, references.properties],
  );
  const selectedProperty = customerProperties.find((property) => property.id === propertyId);
  const presetById = useMemo(() => new Map(presets.map((preset) => [preset.id, preset])), [presets]);
  const selectedPresets = workLines.map((line) => presetById.get(line.presetId)).filter((preset): preset is OfficeBookingPreset => Boolean(preset));
  const autoDescription = useMemo(() => automaticCustomerDescription(workLines, presetById), [presetById, workLines]);

  useEffect(() => {
    const previousAuto = lastAutoDescriptionRef.current;
    setDescription((current) => {
      const currentTrimmed = current.trim();
      const previousTrimmed = previousAuto.trim();
      if (!currentTrimmed || currentTrimmed === previousTrimmed) return autoDescription;
      if (previousAuto && current.startsWith(previousAuto)) {
        return `${autoDescription}${current.slice(previousAuto.length)}`;
      }
      return current;
    });
    lastAutoDescriptionRef.current = autoDescription;
  }, [autoDescription]);

  const filteredCustomers = useMemo(() => {
    const needle = normalizeSearch(customerQuery);
    if (!needle) return [];

    const propertiesByCustomer = new Map<string, string[]>();
    for (const property of references.properties) {
      const id = text(property.clientId);
      if (!id) continue;
      const current = propertiesByCustomer.get(id) ?? [];
      current.push(`${text(property.name)} ${text(property.address)} ${text(property.zone)} ${text(property.neighborhood)}`);
      propertiesByCustomer.set(id, current);
    }

    return references.clients
      .filter((customer) => customer.active !== false)
      .map((customer) => ({
        customer,
        score: customerSearchScore(customer, needle, propertiesByCustomer.get(customer.id) ?? []),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || customerLabel(a.customer).localeCompare(customerLabel(b.customer)))
      .slice(0, 10)
      .map((item) => item.customer);
  }, [customerQuery, references.clients, references.properties]);

  const estimatedMinutes = workLines.reduce((sum, line) => {
    const preset = presetById.get(line.presetId);
    if (!preset) return sum;
    return sum + (isOtherPreset(preset)
      ? Math.max(60, line.manualDurationMinutes ?? 60)
      : preset.durationMinutesPerUnit * line.quantity);
  }, 0);
  const totalQuantity = workLines.reduce((sum, line) => sum + line.quantity, 0);
  const workSignature = workLines.map((line) => `${line.presetId}:${line.quantity}:${line.manualDurationMinutes ?? ''}`).join('|');
  const recipientSignature = recipientSelections.map((item) => `${item.recipientType}:${item.sourceId}:${Number(item.sendConfirmation)}:${Number(item.sendReminder)}`).sort().join('|');
  const signature = [customerId, propertyId, recipientSignature, workSignature, description.trim(), technicianInstructions.trim(), requestTarget.dateKey, requestTarget.vanId, requestTarget.start, mode].join('|');
  validationSignatureRef.current = signature;
  const activeValidation = validated?.signature === signature ? validated : null;
  const selectedValidatedOption = activeValidation?.options.find((option) => option.id === activeValidation.selectedOptionId)
    ?? activeValidation?.options[0]
    ?? null;
  const workValid = workLines.length > 0 && workLines.every((line) => {
    const preset = presetById.get(line.presetId);
    if (!preset || line.quantity < 1) return false;
    if (!isOtherPreset(preset)) return true;
    const minutes = Number(line.manualDurationMinutes || 0);
    return minutes >= 60 && minutes <= 720 && minutes % 30 === 0;
  });

  const resetValidation = () => {
    validationEpochRef.current += 1;
    setChecking(false);
    setValidated(null);
    setAuthorityError('');
  };

  const selectCustomer = (customer: BookingCustomer) => {
    setCustomerId(customer.id);
    const firstProperty = references.properties.find((property) => property.clientId === customer.id && property.active !== false);
    setPropertyId(firstProperty?.id ?? '');
    setRecipientSelections([]);
    setCustomerQuery('');
    setMasterError('');
    setCustomerEditorOpen(false);
    setPropertyEditorOpen(false);
    resetValidation();
  };

  const addPreset = (preset: OfficeBookingPreset) => {
    setWorkLines((current) => {
      const existing = current.find((line) => line.presetId === preset.id);
      if (!existing) return [...current, newWorkLine(preset)];
      if (isOtherPreset(preset)) return current;
      return current.map((line) => line.id === existing.id ? { ...line, quantity: Math.min(20, line.quantity + 1) } : line);
    });
    resetValidation();
  };

  const changeQuantity = (lineId: string, delta: number) => {
    setWorkLines((current) => current.map((line) => line.id === lineId
      ? { ...line, quantity: Math.max(1, Math.min(20, line.quantity + delta)) }
      : line));
    resetValidation();
  };

  const removeWorkLine = (lineId: string) => {
    setWorkLines((current) => current.filter((line) => line.id !== lineId));
    resetValidation();
  };

  const changeManualHours = (lineId: string, hours: number) => {
    const minutes = Math.max(60, Math.min(720, Math.round(hours * 2) * 30));
    setWorkLines((current) => current.map((line) => line.id === lineId ? { ...line, manualDurationMinutes: minutes } : line));
    resetValidation();
  };

  const openCustomerEditor = () => {
    setCustomerDraft({ ...emptyCustomer, name: customerQuery.trim() });
    setCustomerPropertyDraft({ ...emptyProperty, contactLinks: [] });
    setMasterError('');
    setCustomerEditorOpen(true);
    setPropertyEditorOpen(false);
  };

  const saveCustomer = async () => {
    if (masterSaving) return;
    setMasterSaving(true);
    setMasterError('');
    try {
      const created = await createBookingCustomerWithProperty({
        customer: customerDraft,
        property: materializePropertyDraft(customerPropertyDraft),
        references,
      });
      await refreshReferences();
      setCustomerId(created.customer.id);
      setPropertyId(created.property.id);
      setRecipientSelections([]);
      setCustomerQuery('');
      setCustomerEditorOpen(false);
      resetValidation();
    } catch (error) {
      setMasterError(error instanceof Error ? error.message : 'The customer could not be created.');
    } finally {
      setMasterSaving(false);
    }
  };

  const openPropertyEditor = () => {
    if (!selectedCustomer) return;
    setPropertyDraft({ ...emptyProperty, zone: text(selectedCustomer.zone), contactLinks: [] });
    setMasterError('');
    setPropertyEditorOpen(true);
    setCustomerEditorOpen(false);
  };

  const saveProperty = async () => {
    if (!selectedCustomer || masterSaving) return;
    setMasterSaving(true);
    setMasterError('');
    try {
      const created = await createBookingProperty(selectedCustomer.id, materializePropertyDraft(propertyDraft));
      await refreshReferences();
      setPropertyId(created.id);
      setRecipientSelections([]);
      setPropertyEditorOpen(false);
      resetValidation();
    } catch (error) {
      setMasterError(error instanceof Error ? error.message : 'The property could not be created.');
    } finally {
      setMasterSaving(false);
    }
  };

  const workRequestLines = useCallback((): OfficeBookingWorkLine[] => workLines.map((line) => {
    const preset = presetById.get(line.presetId)!;
    return {
      id: line.id,
      presetId: preset.id,
      serviceId: preset.serviceId,
      quantity: line.quantity,
      ...(isOtherPreset(preset) ? { manualDurationMinutes: line.manualDurationMinutes } : {}),
    };
  }), [presetById, workLines]);

  const validateTarget = useCallback(async (automatic = false) => {
    if (isAfterHours) return;
    if (!selectedCustomer) {
      if (!automatic) setAuthorityError('Select or create a customer first.');
      return;
    }
    if (!selectedProperty) {
      if (!automatic) setAuthorityError('Select or add a service property first.');
      return;
    }
    if (!workValid) {
      if (!automatic) setAuthorityError('Add at least one valid work line. Other work requires a manual scheduled duration.');
      return;
    }

    const requestEpoch = validationEpochRef.current + 1;
    validationEpochRef.current = requestEpoch;
    const validationSignature = signature;
    setChecking(true);
    setAuthorityError('');
    setValidated(null);
    try {
      const result = await checkOfficeCreateAvailability({
        requestId: createOfficeLifecycleRequestId('schedule-create-check'),
        customerId: selectedCustomer.id,
        propertyId: selectedProperty.id,
        workLines: workRequestLines(),
        requestedDate: requestTarget.dateKey,
        requestedTime: requestTarget.start,
        requiredVanId: requestTarget.vanId,
        customerFacingDescription: description.trim(),
        technicianInstructions: technicianInstructions.trim(),
        recipientSelections,
        notes: `Created from LIVE Scheduling slot ${requestTarget.vanId} ${requestTarget.dateKey} ${requestTarget.start}.`,
      });
      if (requestEpoch !== validationEpochRef.current || validationSignatureRef.current !== validationSignature) return;
      const exactOptions = result.options.filter((option) => optionMatchesTarget(option, requestTarget));
      if (!result.available || !result.offer || !exactOptions.length) {
        const reason = result.reason ? ` (${result.reason})` : '';
        setAuthorityError(`Booking Authority could not reserve the complete allocation for this van/time${reason}. The schedule was not changed.`);
        return;
      }
      setValidated({
        signature: validationSignature,
        offerId: result.offer.id,
        offerVersion: result.offer.version,
        options: exactOptions,
        selectedOptionId: exactOptions[0].id,
      });
    } catch (error) {
      if (requestEpoch === validationEpochRef.current && validationSignatureRef.current === validationSignature) {
        setAuthorityError(error instanceof Error ? error.message : 'Booking Authority could not validate this target.');
      }
    } finally {
      if (requestEpoch === validationEpochRef.current) setChecking(false);
    }
  }, [description, isAfterHours, recipientSelections, requestTarget, selectedCustomer, selectedProperty, signature, technicianInstructions, workRequestLines, workValid]);

  useEffect(() => {
    if (isAfterHours || loading || masterSaving || saving || holding || !selectedCustomer || !selectedProperty || !workValid) return;
    const timer = window.setTimeout(() => { void validateTarget(true); }, 350);
    return () => window.clearTimeout(timer);
  }, [holding, isAfterHours, loading, masterSaving, saving, selectedCustomer, selectedProperty, validateTarget, workValid]);

  const confirmBooking = async () => {
    if (!selectedCustomer || !selectedProperty || !selectedPresets.length || !workValid || saving || holding) return;
    if (isAfterHours) {
      if (!validAfterHoursStart(requestTarget.start)) {
        setAuthorityError('After-hours work must start at 5:00 PM or later.');
        return;
      }
      setSaving(true);
      setAuthorityError('');
      try {
        const result = await createAfterHoursEmergency({
          requestId: createOfficeLifecycleRequestId('after-hours-emergency'),
          customerId: selectedCustomer.id,
          propertyId: selectedProperty.id,
          workLines: workRequestLines(),
          requestedDate: requestTarget.dateKey,
          requestedTime: requestTarget.start,
          requiredVanId: requestTarget.vanId,
          customerFacingDescription: description.trim(),
          technicianInstructions: technicianInstructions.trim(),
          recipientSelections,
        });
        onCreated({
          appointmentId: result.appointmentId,
          workOrderIds: result.workOrderIds,
          option: {
            id: `after-hours:${result.appointmentId}`,
            date: requestTarget.dateKey,
            time: requestTarget.start,
            assignments: [{
              vanId: requestTarget.vanId,
              vanName: requestTarget.vanName,
              quantity: totalQuantity,
              slots: 0,
              time: requestTarget.start,
              role: 'primary',
            }],
          },
          customer: selectedCustomer,
          property: selectedProperty,
          preset: selectedPresets[0],
          status: 'confirmed',
        });
      } catch (error) {
        setAuthorityError(error instanceof Error ? error.message : 'The after-hours job could not be created.');
      } finally {
        setSaving(false);
      }
      return;
    }

    if (!activeValidation || !selectedValidatedOption) return;
    setSaving(true);
    setAuthorityError('');
    const { offerId, offerVersion } = activeValidation;
    const option = selectedValidatedOption;
    try {
      const result = await confirmOfficeAppointment({
        requestId: `schedule-create:${offerId}:${offerVersion}:${option.id}`,
        offerId,
        offerVersion,
        optionId: option.id,
      });
      onCreated({
        appointmentId: result.appointmentId,
        workOrderIds: result.workOrderIds ?? [],
        option,
        customer: selectedCustomer,
        property: selectedProperty,
        preset: selectedPresets[0],
        status: 'confirmed',
      });
    } catch (error) {
      setValidated(null);
      setAuthorityError(error instanceof Error ? error.message : 'The appointment could not be confirmed.');
    } finally {
      setSaving(false);
    }
  };

  const holdBooking = async () => {
    if (!activeValidation || !selectedValidatedOption || !selectedCustomer || !selectedProperty || !selectedPresets.length || saving || holding) return;
    setHolding(true);
    setAuthorityError('');
    const { offerId, offerVersion } = activeValidation;
    const option = selectedValidatedOption;
    try {
      const result = await createOfficeTemporaryHold({
        requestId: `schedule-hold:${offerId}:${offerVersion}:${option.id}`,
        offerId,
        offerVersion,
        optionId: option.id,
      });
      onCreated({
        appointmentId: result.appointmentId,
        workOrderIds: result.workOrderIds ?? [],
        option,
        customer: selectedCustomer,
        property: selectedProperty,
        preset: selectedPresets[0],
        status: 'temporary_hold',
      });
    } catch (error) {
      setValidated(null);
      setAuthorityError(error instanceof Error ? error.message : 'The temporary hold could not be created.');
    } finally {
      setHolding(false);
    }
  };

  const busy = loading || masterSaving || saving || holding;

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={isAfterHours ? `Create after-hours appointment for ${requestTarget.vanName}` : 'Create appointment'}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Booking Authority · {isAfterHours ? 'After-Hours / Emergency' : 'Canonical Scheduling'}</span>
            <h2>{isAfterHours ? 'New after-hours appointment' : 'New appointment'}</h2>
            <p>{isAfterHours
              ? 'Use the same canonical customer, property, contacts and work-selection flow as every appointment. The selected Van receives one extra open-ended job from 5:00 PM onward.'
              : 'Select the real customer and work details. Add one or more quick work types; Booking Authority validates the combined allocation before anything is committed.'}</p>
          </div>
          <button type="button" className={styles.close} disabled={busy} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={styles.body}>
          <section className={styles.targetCard}>
            <div><span>DATE</span><strong>{formatDate(requestTarget.dateKey)}</strong></div>
            <div><span>PRIMARY VAN</span><strong>{requestTarget.vanName} · {crewLabel}</strong></div>
            {isAfterHours ? (
              <div><label htmlFor="after-hours-start" style={{ display: 'block', color: 'var(--brand)', fontSize: '5.5px', fontWeight: 950, letterSpacing: '.07em' }}>START · 5:00 PM OR LATER</label><input id="after-hours-start" style={{ width: '100%', boxSizing: 'border-box', marginTop: 3, border: '1px solid var(--border)', borderRadius: 7, padding: '5px 7px', color: 'var(--text)', background: 'var(--surface)' }} type="time" min="17:00" value={requestedStart} onChange={(event) => { setRequestedStart(event.target.value); resetValidation(); }} /></div>
            ) : <div><span>START</span><strong>{formatTime(requestTarget.start)}</strong></div>}
            <div><span>{isAfterHours ? 'WORK RULE' : 'OPEN BLOCK'}</span><strong>{isAfterHours ? 'Extra job · open-ended until field completion' : `${formatTime(requestTarget.start)}–${formatTime(requestTarget.end)}`}</strong></div>
          </section>

          {loadError ? <div className={styles.errorBox}>{loadError}</div> : null}
          {authorityError ? <div className={styles.errorBox}>{authorityError}</div> : null}
          {masterError ? <div className={styles.errorBox}>{masterError}</div> : null}

          <section className={styles.section}>
            <header><div><span>1</span><strong>Customer</strong><small>Search canonical CRM records or register a new customer.</small></div></header>
            <div className={styles.sectionBody}>
              <label className={styles.fieldWide}>
                <span>Search customer</span>
                <input autoFocus={!loading} value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} placeholder="Name, company, phone, WhatsApp, address or area…" />
              </label>
              {customerQuery.trim() ? (
                <div className={styles.searchResults}>
                  {filteredCustomers.map((customer) => (
                    <button type="button" key={customer.id} className={`${styles.searchResult} ${customer.id === customerId ? styles.selectedResult : ''}`} onClick={() => selectCustomer(customer)}>
                      <div><strong>{customerLabel(customer)}</strong><span>{text(customer.name) && text(customer.company) ? `${customer.name} · ` : ''}{text(customer.phone) || text(customer.whatsapp) || 'No phone'}</span></div>
                      <small>{text(customer.zone) || 'Area not specified'}</small>
                      <b>{customer.id === customerId ? 'SELECTED' : 'SELECT'}</b>
                    </button>
                  ))}
                  {!filteredCustomers.length ? <div className={styles.emptyResult}>No existing customer matches this search.</div> : null}
                </div>
              ) : null}
              <button type="button" className={styles.inlineAction} onClick={openCustomerEditor}>＋ Create customer</button>

              {customerEditorOpen ? (
                <div className={styles.editorPanel}>
                  <header><div><strong>Create customer + first property</strong><span>Customer, property and optional contact relationships are committed atomically to canonical CRM.</span></div><button type="button" onClick={() => setCustomerEditorOpen(false)}>×</button></header>
                  <div className={styles.formGrid}>
                    <Field label="Customer name *" value={customerDraft.name} onChange={(value) => setCustomerDraft((current) => ({ ...current, name: value }))} />
                    <Field label="Company" value={customerDraft.company ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, company: value }))} />
                    <Field label="Phone / WhatsApp *" value={customerDraft.phone} onChange={(value) => setCustomerDraft((current) => ({ ...current, phone: value }))} placeholder="564-2625" />
                    <Field label="WhatsApp if different" value={customerDraft.whatsapp ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, whatsapp: value }))} />
                    <Field label="Email" value={customerDraft.email ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, email: value }))} type="email" />
                    <label><span>Preferred language</span><select value={customerDraft.preferredLanguage} onChange={(event) => setCustomerDraft((current) => ({ ...current, preferredLanguage: event.target.value }))}><option>Papiamento</option><option>English</option><option>Español</option><option>Nederlands</option></select></label>
                    <div className={styles.formDivider}>First service property</div>
                    <Field label="Property name (optional)" value={customerPropertyDraft.name} onChange={(value) => setCustomerPropertyDraft((current) => ({ ...current, name: value }))} placeholder="Pastechi House Building, Front Office, Rental Villa…" />
                    <label><span>Property type</span><select value={customerPropertyDraft.type} onChange={(event) => setCustomerPropertyDraft((current) => ({ ...current, type: event.target.value }))}><option>Casa</option><option>Apartamento</option><option>Oficina</option><option>Local comercial</option><option>Otro</option></select></label>
                    <PropertyAddressFields draft={customerPropertyDraft} onChange={setCustomerPropertyDraft} />
                    <PropertyContactDraftEditor clientId="new-customer" contacts={[]} links={customerPropertyDraft.contactLinks ?? []} onChange={(contactLinks) => setCustomerPropertyDraft((current) => ({ ...current, contactLinks }))} />
                  </div>
                  <footer><button type="button" className={styles.secondaryButton} disabled={masterSaving} onClick={() => setCustomerEditorOpen(false)}>Cancel</button><button type="button" className={styles.primaryButton} disabled={masterSaving} onClick={() => void saveCustomer()}>{masterSaving ? 'Saving…' : 'Create & select'}</button></footer>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <header><div><span>2</span><strong>Service property</strong><small>Appointments always point to a real property belonging to the selected customer.</small></div></header>
            <div className={styles.sectionBody}>
              {selectedCustomer ? (
                <>
                  <div className={styles.choiceGrid}>
                    {customerProperties.map((property) => (
                      <button type="button" key={property.id} className={`${styles.choice} ${property.id === propertyId ? styles.choiceSelected : ''}`} onClick={() => { setPropertyId(property.id); setRecipientSelections([]); resetValidation(); }}>
                        <strong>{propertyLabel(property)}</strong><span>{text(property.address) || 'No address'}</span><small>{text(property.operationalZone) || text(property.zone) || 'Area not specified'}</small>
                      </button>
                    ))}
                  </div>
                  {!customerProperties.length ? <div className={styles.emptyResult}>This customer has no active service property yet.</div> : null}
                  <button type="button" className={styles.inlineAction} onClick={openPropertyEditor}>＋ Add property</button>
                  {selectedProperty ? <PropertyCommunicationPanel
                    client={selectedCustomer}
                    propertyId={selectedProperty.id}
                    contacts={references.contacts}
                    assignments={references.contactAssignments}
                    selections={recipientSelections}
                    onSelectionsChange={(next) => { setRecipientSelections(next); resetValidation(); }}
                    onRefresh={refreshReferences}
                  /> : null}
                </>
              ) : <div className={styles.emptyResult}>Select a customer to load their properties.</div>}

              {propertyEditorOpen ? (
                <div className={styles.editorPanel}>
                  <header><div><strong>Add property for {selectedCustomer ? customerLabel(selectedCustomer) : 'customer'}</strong><span>Property identity stays separate from reusable customer contacts and communication rules.</span></div><button type="button" onClick={() => setPropertyEditorOpen(false)}>×</button></header>
                  <div className={styles.formGrid}>
                    <Field label="Property name (optional)" value={propertyDraft.name} onChange={(value) => setPropertyDraft((current) => ({ ...current, name: value }))} placeholder="Pastechi House Building, Front Office, Rental Villa…" />
                    <label><span>Property type</span><select value={propertyDraft.type} onChange={(event) => setPropertyDraft((current) => ({ ...current, type: event.target.value }))}><option>Casa</option><option>Apartamento</option><option>Oficina</option><option>Local comercial</option><option>Otro</option></select></label>
                    <PropertyAddressFields draft={propertyDraft} onChange={setPropertyDraft} />
                    <Field label="Notes" value={propertyDraft.notes ?? ''} onChange={(value) => setPropertyDraft((current) => ({ ...current, notes: value }))} wide />
                    {selectedCustomer ? <PropertyContactDraftEditor clientId={selectedCustomer.id} contacts={references.contacts} links={propertyDraft.contactLinks ?? []} onChange={(contactLinks) => setPropertyDraft((current) => ({ ...current, contactLinks }))} /> : null}
                  </div>
                  <footer><button type="button" className={styles.secondaryButton} disabled={masterSaving} onClick={() => setPropertyEditorOpen(false)}>Cancel</button><button type="button" className={styles.primaryButton} disabled={masterSaving} onClick={() => void saveProperty()}>{masterSaving ? 'Saving…' : 'Add & select'}</button></footer>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <header><div><span>3</span><strong>Work & allocation</strong><small>Quick booking services come from Services & Products. Click a tile to add work; click it again to increase quantity.</small></div></header>
            <div className={styles.sectionBody}>
              <div className={styles.presetGrid}>
                {presets.map((preset) => {
                  const selectedLine = workLines.find((line) => line.presetId === preset.id);
                  return (
                    <button type="button" key={preset.id} className={`${styles.preset} ${selectedLine ? styles.presetSelected : ''}`} onClick={() => addPreset(preset)}>
                      <strong>{preset.label}</strong>
                      <span>{isOtherPreset(preset) ? 'Manual scheduled time' : `${durationLabel(preset.durationMinutesPerUnit)} / unit`}{selectedLine ? ` · selected × ${selectedLine.quantity}` : ''}</span>
                    </button>
                  );
                })}
              </div>
              {!presets.length && !loading ? <div className={styles.emptyResult}>No services are marked “Show in Scheduling” yet. Configure the quick booking list in Services & Products.</div> : null}

              {workLines.length ? (
                <div style={{ display: 'grid', gap: 7, marginTop: 10 }}>
                  {workLines.map((line) => {
                    const preset = presetById.get(line.presetId);
                    if (!preset) return null;
                    const other = isOtherPreset(preset);
                    const lineMinutes = other ? Math.max(60, line.manualDurationMinutes ?? 60) : preset.durationMinutesPerUnit * line.quantity;
                    return (
                      <div key={line.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', gap: 10, alignItems: 'center', padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface-2)' }}>
                        <div>
                          <strong style={{ display: 'block', fontSize: '6.9px' }}>{preset.label}</strong>
                          <span style={{ display: 'block', marginTop: 3, color: 'var(--muted)', fontSize: '5.7px' }}>{durationLabel(lineMinutes)} scheduled{other ? ' · manual' : ` · ${durationLabel(preset.durationMinutesPerUnit)} each`}</span>
                        </div>
                        {other ? (
                          <label style={{ display: 'grid', gap: 3, minWidth: 105 }}><span>Manual hours</span><input type="number" min="1" max="12" step="0.5" value={(line.manualDurationMinutes ?? 60) / 60} onChange={(event) => changeManualHours(line.id, Number(event.target.value || 1))} /></label>
                        ) : (
                          <div className={styles.stepper}><button type="button" disabled={line.quantity <= 1} onClick={() => changeQuantity(line.id, -1)}>−</button><b>{line.quantity}</b><button type="button" disabled={line.quantity >= 20} onClick={() => changeQuantity(line.id, 1)}>＋</button></div>
                        )}
                        <button type="button" className={styles.secondaryButton} style={{ padding: '6px 8px' }} onClick={() => removeWorkLine(line.id)}>Remove</button>
                      </div>
                    );
                  })}
                </div>
              ) : <div className={styles.emptyResult}>Add the work expected for this visit. BTU is not required when scheduling.</div>}

              <div className={styles.quantityRow}>
                <div><span>Work lines</span><strong>{workLines.length} line{workLines.length === 1 ? '' : 's'} · {totalQuantity} item{totalQuantity === 1 ? '' : 's'}</strong></div>
                <div><span>Estimated workload</span><strong>{estimatedMinutes ? durationLabel(estimatedMinutes) : '—'}</strong></div>
                <div><span>{isAfterHours ? 'After-hours execution' : 'Scheduled allocation'}</span><strong>{isAfterHours ? 'Open-ended until field completion' : allocationDurationLabel(selectedValidatedOption, estimatedMinutes)}</strong></div>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.fieldWide}><span>Customer-facing work description</span><textarea value={description} onChange={(event) => { setDescription(event.target.value); resetValidation(); }} placeholder="Example: Two standard services and one installation. BTU to be confirmed by technician on site." /></label>
                <label className={styles.fieldWide}><span>Technician instructions</span><textarea value={technicianInstructions} onChange={(event) => { setTechnicianInstructions(event.target.value); resetValidation(); }} placeholder="Access instructions, contact person, equipment location, diagnostic notes…" /></label>
              </div>
            </div>
          </section>

          {isAfterHours ? (
            <section className={styles.authoritySection}>
              <div className={styles.authorityHeading}><div><span>4</span><strong>After-hours operational validation</strong><small>Booking Authority validates the same canonical customer, property, contacts, services, selected Van and dated crew when you confirm. This extra job remains open until real field completion.</small></div></div>
              <div className={styles.authorityIdle}>{selectedCustomer && selectedProperty && workValid && validAfterHoursStart(requestTarget.start)
                ? `${requestTarget.vanName} is selected for an extra job starting ${formatTime(requestTarget.start)}. No daytime capacity, planned end time or payroll overtime is fabricated.`
                : 'Complete the same customer, property and work details used by a normal booking, then choose a start at 5:00 PM or later.'}</div>
            </section>
          ) : (
          <section className={styles.authoritySection}>
            <div className={styles.authorityHeading}><div><span>4</span><strong>Live capacity validation</strong><small>{requestTarget.vanName} stays the primary/responsible van. Booking Authority validates automatically as the complete workload changes; final transaction validation still runs on confirm or hold.</small></div><button type="button" className={styles.validateButton} disabled={busy || checking || !selectedCustomer || !selectedProperty || !workValid} onClick={() => void validateTarget(false)}>{checking ? 'Checking…' : 'Recheck now'}</button></div>

            {activeValidation && selectedValidatedOption ? (
              <div className={styles.validationSuccess}>
                <header><div><b>✓</b><div><strong>Booking Authority approved the complete allocation</strong><span>Offer {activeValidation.offerId} · final transaction validation still runs on commit.</span></div></div></header>
                {activeValidation.options.length > 1 ? (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 6, fontWeight: 850, marginBottom: 6 }}>VALID SUPPORT ALTERNATIVES</div>
                    <div className={styles.choiceGrid}>
                      {activeValidation.options.map((option) => {
                        const support = supportAssignment(option);
                        const selected = option.id === selectedValidatedOption.id;
                        return (
                          <button type="button" key={option.id} className={`${styles.choice} ${selected ? styles.choiceSelected : ''}`} onClick={() => setValidated((current) => current ? { ...current, selectedOptionId: option.id } : current)}>
                            <strong>{support ? `${support.vanName || support.vanId} · support` : 'Primary allocation'}</strong>
                            <span>{support ? `${formatTime(support.time || option.time)}${support.endTime ? `–${formatTime(support.endTime)}` : ''}` : `${formatTime(option.time)}–${formatTime(option.endTime || option.time)}`}</span>
                            <small>{support ? `${support.quantity} support unit${support.quantity === 1 ? '' : 's'} · ${requestTarget.vanName} remains primary` : 'No support van required'}</small>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className={styles.assignmentGrid}>
                  {selectedValidatedOption.assignments.map((assignment, index) => (
                    <article key={`${assignment.vanId}-${assignment.time || selectedValidatedOption.time}-${index}`}>
                      <span>{index === 0 ? 'PRIMARY / RESPONSIBLE' : 'SUPPORT'}</span>
                      <strong>{assignment.vanName || assignment.vanId}</strong>
                      <small>{formatTime(assignment.time || selectedValidatedOption.time)}{assignment.endTime ? `–${formatTime(assignment.endTime)}` : ''} · {durationLabel(assignment.durationMinutes || assignment.slots * 60)}</small>
                    </article>
                  ))}
                </div>
                <div className={styles.authorityIdle} style={{ marginTop: 8 }}><strong>Temporary hold:</strong> reserves these same canonical capacity locks but sends no customer confirmation or reminder until an office user manually confirms it. No automatic expiry is assumed.</div>
              </div>
            ) : (
              <div className={styles.authorityIdle}>{checking ? 'Checking the complete allocation with Booking Authority…' : 'Complete the customer, property and work details. Booking Authority validates the live target automatically; the browser never becomes the source of truth for capacity.'}</div>
            )}
          </section>
          )}
        </div>

        <footer className={styles.footer}>
          <div><span>{isAfterHours ? 'CANONICAL EXTRA-WORK PATH' : 'CANONICAL WRITE PATH'}</span><strong>{isAfterHours ? 'Booking Authority → Appointment + open-ended Work Order + Van guard' : 'Booking Authority → Appointment + Work Order + Capacity Locks'}</strong></div>
          <div>
            <button type="button" className={styles.secondaryButton} disabled={busy} onClick={onClose}>Cancel</button>
            {!isAfterHours ? <button type="button" className={styles.secondaryButton} style={{ color: 'var(--warning, #b45309)', borderColor: 'var(--warning, #f59e0b)' }} disabled={!selectedValidatedOption || busy || checking} onClick={() => void holdBooking()}>{holding ? 'Holding…' : 'Temporary hold'}</button> : null}
            <button type="button" className={styles.confirmButton} disabled={isAfterHours
              ? busy || !selectedCustomer || !selectedProperty || !workValid || !validAfterHoursStart(requestTarget.start)
              : !selectedValidatedOption || busy || checking} onClick={() => void confirmBooking()}>{saving ? 'Confirming…' : isAfterHours ? `Create for ${requestTarget.vanName}` : 'Confirm appointment'}</button>
          </div>
        </footer>
      </aside>
    </div>
  );
}

function PropertyAddressFields({ draft, onChange }: {
  draft: PropertyDraft;
  onChange: React.Dispatch<React.SetStateAction<PropertyDraft>>;
}) {
  const [selectedAddress, setSelectedAddress] = useState('');
  const suggestions = useMemo(
    () => selectedAddress === draft.address.trim() ? [] : suggestArubaAddresses(draft.address, 6),
    [draft.address, selectedAddress],
  );

  const selectSuggestion = (suggestion: ArubaAddressEntry) => {
    setSelectedAddress(suggestion.canonical);
    onChange((current) => ({
      ...current,
      address: suggestion.canonical,
      zone: suggestion.operationalZone || current.zone,
      neighborhood: suggestion.neighborhood || current.neighborhood,
    }));
  };

  return (
    <>
      <label className={styles.fieldWide}>
        <span>Street / area *</span>
        <input
          value={draft.address}
          onChange={(event) => {
            setSelectedAddress('');
            onChange((current) => ({
              ...current,
              address: event.target.value,
              ...(event.target.value.trim() ? {} : { zone: '', neighborhood: '' }),
            }));
          }}
          placeholder="Start typing: Santa Cruz, Savaneta, Pampunastraat…"
          autoComplete="off"
        />
      </label>
      {suggestions.length ? (
        <div className={`${styles.searchResults} ${styles.fieldWide}`} style={{ maxHeight: 180, marginTop: -3 }}>
          {suggestions.map((suggestion) => (
            <button type="button" key={`${suggestion.canonical}-${suggestion.operationalZone}`} className={styles.searchResult} onClick={() => selectSuggestion(suggestion)}>
              <div><strong>{suggestion.canonical}</strong><span>{suggestion.neighborhood || 'Aruba address directory'}</span></div>
              <small>{suggestion.operationalZone || 'Zone not mapped yet'}</small>
              <b>SELECT</b>
            </button>
          ))}
        </div>
      ) : null}
      <Field label="House / unit" value={draft.addressDetail} onChange={(value) => onChange((current) => ({ ...current, addressDetail: value }))} placeholder="175K · 54 C · Apt 2 · Local 1" />
      <Field label="Area / zone" value={draft.zone} onChange={(value) => onChange((current) => ({ ...current, zone: value }))} placeholder="Auto-filled when mapped" />
      <Field label="Neighborhood" value={draft.neighborhood ?? ''} onChange={(value) => onChange((current) => ({ ...current, neighborhood: value }))} />
    </>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', wide = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  wide?: boolean;
}) {
  return <label className={wide ? styles.fieldWide : undefined}><span>{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}
