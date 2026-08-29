'use client';

import { useEffect, useMemo, useState } from 'react';
import { createAfterHoursEmergency } from '../../lib/after-hours-booking';
import type { AfterHoursVanTarget } from '../../lib/live-scheduling-interactions';
import { loadBookingReferenceData, type BookingReferenceData } from '../../lib/live-scheduling-booking-data';
import { liveVanCrew, loadLiveOperationalCapacityState, type LiveOperationalCapacityState } from '../../lib/live-operational-capacity';
import { createOfficeLifecycleRequestId, listOfficeBookingPresets, type OfficeBookingPreset } from '../../lib/office-booking-authority';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';
import styles from './live-appointment-create-drawer.module.css';

type Props = {
  target: AfterHoursVanTarget;
  onClose: () => void;
  onCreated?: (result: Awaited<ReturnType<typeof createAfterHoursEmergency>>) => void;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function customerLabel(customer: BookingReferenceData['clients'][number]) {
  return text(customer.company) || text(customer.name) || customer.id;
}

function propertyLabel(property: BookingReferenceData['properties'][number]) {
  return text(property.name) || text(property.address) || property.id;
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function AfterHoursEmergencyDrawer({ target, onClose, onCreated }: Props) {
  const [references, setReferences] = useState<BookingReferenceData>({ clients: [], properties: [], contacts: [], contactAssignments: [] });
  const [presets, setPresets] = useState<OfficeBookingPreset[]>([]);
  const [capacity, setCapacity] = useState<LiveOperationalCapacityState | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [startTime, setStartTime] = useState('17:00');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [created, setCreated] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotice('');
    void Promise.all([
      loadBookingReferenceData(),
      listOfficeBookingPresets(true),
      loadLiveOperationalCapacityState({ startDate: target.dateKey, endDate: target.dateKey }),
    ]).then(([nextReferences, presetResult, nextCapacity]) => {
      if (!active) return;
      setReferences(nextReferences);
      const nextPresets = presetResult.presets.filter((preset) => preset.active !== false);
      setPresets(nextPresets);
      setPresetId((current) => current || nextPresets[0]?.id || '');
      setCapacity(nextCapacity);
    }).catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : 'After-hours reference data could not be loaded.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [target.dateKey]);

  const properties = useMemo(
    () => references.properties.filter((property) => property.clientId === customerId && property.active !== false),
    [customerId, references.properties],
  );
  const selectedPreset = presets.find((preset) => preset.id === presetId);
  const selectedCrew = liveVanCrew(capacity, target.vanId, target.dateKey);

  const selectCustomer = (nextCustomerId: string) => {
    setCustomerId(nextCustomerId);
    const first = references.properties.find((property) => property.clientId === nextCustomerId && property.active !== false);
    setPropertyId(first?.id || '');
    setCreated(false);
    setNotice('');
  };

  const close = () => {
    if (!busy) onClose();
  };

  const submit = async () => {
    if (target.dateKey !== currentArubaDateKey()) {
      setNotice('After-hours emergencies are same-day operational jobs. Return to Today and choose the Van again.');
      return;
    }
    if (!customerId || !propertyId || !presetId) {
      setNotice('Select customer, property and work type.');
      return;
    }
    const [hour, minute] = startTime.split(':').map(Number);
    if (!/^\d{2}:\d{2}$/.test(startTime) || !Number.isFinite(hour) || !Number.isFinite(minute) || hour * 60 + minute < 17 * 60) {
      setNotice('After-hours emergency start must be 5:00 PM or later.');
      return;
    }
    setBusy(true);
    setCreated(false);
    setNotice('');
    try {
      const result = await createAfterHoursEmergency({
        requestId: createOfficeLifecycleRequestId('after-hours'),
        customerId,
        propertyId,
        presetId,
        serviceId: selectedPreset?.serviceId,
        quantity,
        requestedDate: target.dateKey,
        requestedTime: startTime,
        requiredVanId: target.vanId,
        customerFacingDescription: text(description),
        technicianInstructions: text(instructions),
        recipientSelections: [],
      });
      setCreated(true);
      setNotice(`After-hours emergency ${result.workOrderIds[0]} created for ${target.vanName} at ${startTime}. It remains open until real field completion.`);
      setDescription('');
      setInstructions('');
      onCreated?.(result);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'After-hours emergency could not be created.');
    } finally {
      setBusy(false);
    }
  };

  const formBusy = loading || busy;
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={`Create after-hours emergency for ${target.vanName}`}>
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Booking Authority · After-Hours / Emergency</span>
            <h2>New after-hours job</h2>
            <p>Create another job for this Van from 5:00 PM onward. No planned end or payroll overtime is fabricated.</p>
          </div>
          <button type="button" className={styles.close} disabled={busy} onClick={close} aria-label="Close">×</button>
        </header>

        <div className={styles.body}>
          <section className={styles.targetCard}>
            <div><span>DATE</span><strong>{formatDate(target.dateKey)}</strong></div>
            <div><span>SELECTED VAN</span><strong>{target.vanName}</strong></div>
            <div><span>DATED CREW</span><strong>{selectedCrew.label}</strong></div>
            <div><span>TIME RULE</span><strong>5:00 PM or later · open-ended</strong></div>
          </section>

          {notice ? <div className={styles.errorBox} style={created ? { color: 'var(--success)', borderColor: 'color-mix(in srgb,var(--success) 35%,var(--border))', background: 'var(--success-soft)' } : undefined}>{notice}</div> : null}

          <section className={styles.section}>
            <header><div><span>1</span><strong>Customer and property</strong><small>Select the same canonical CRM records used by normal appointment creation.</small></div></header>
            <div className={styles.formGrid}>
              <label><span>Customer</span><select autoFocus disabled={formBusy} value={customerId} onChange={(event) => selectCustomer(event.target.value)}><option value="">Select customer</option>{references.clients.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}</select></label>
              <label><span>Property / location</span><select disabled={!customerId || formBusy} value={propertyId} onChange={(event) => { setPropertyId(event.target.value); setCreated(false); setNotice(''); }}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{propertyLabel(property)}</option>)}</select></label>
            </div>
          </section>

          <section className={styles.section}>
            <header><div><span>2</span><strong>Emergency work</strong><small>Capture the service and field instructions; actual completion closes the open-ended Work Order.</small></div></header>
            <div className={styles.formGrid}>
              <label><span>Work type</span><select disabled={formBusy} value={presetId} onChange={(event) => { setPresetId(event.target.value); setCreated(false); setNotice(''); }}><option value="">Select work</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
              <label><span>Quantity</span><input type="number" min="1" max="20" value={quantity} disabled={busy} onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
              <label><span>Start time</span><input type="time" min="17:00" required value={startTime} disabled={busy} onChange={(event) => { setStartTime(event.target.value); setCreated(false); setNotice(''); }} /><small style={{ color: 'var(--muted)' }}>Required. No planned ending time is requested.</small></label>
              <label><span>Van</span><input value={target.vanName} readOnly disabled /><small style={{ color: 'var(--muted)' }}>{selectedCrew.label}</small></label>
              <label className={styles.fieldWide}><span>Customer-facing description</span><textarea rows={2} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} placeholder={selectedPreset ? `${selectedPreset.label} × ${quantity}` : 'Emergency work'} /></label>
              <label className={styles.fieldWide}><span>Technician instructions</span><textarea rows={3} value={instructions} disabled={busy} onChange={(event) => setInstructions(event.target.value)} placeholder="Emergency context, access, equipment location, what the team should know…" /></label>
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          <div><span>OPEN-ENDED WORK ORDER</span><strong>Attendance/Payroll remains the overtime authority.</strong></div>
          <div><button type="button" className={styles.secondaryButton} disabled={busy} onClick={close}>Cancel</button><button type="button" className={styles.primaryButton} disabled={formBusy || !customerId || !propertyId || !presetId} onClick={() => void submit()}>{busy ? 'Creating…' : `CREATE FOR ${target.vanName.toUpperCase()}`}</button></div>
        </footer>
      </aside>
    </div>
  );
}
