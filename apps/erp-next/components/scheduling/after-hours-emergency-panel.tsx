'use client';

import { useEffect, useMemo, useState } from 'react';
import { createAfterHoursEmergency } from '../../lib/after-hours-booking';
import { loadBookingReferenceData, type BookingReferenceData } from '../../lib/live-scheduling-booking-data';
import { liveVanCrew, loadLiveOperationalCapacityState, type LiveOperationalCapacityState } from '../../lib/live-operational-capacity';
import { createOfficeLifecycleRequestId, listOfficeBookingPresets, type OfficeBookingPreset } from '../../lib/office-booking-authority';
import { currentArubaDateKey } from '../../lib/scheduling-capacity';
import { previewVans } from '../../lib/scheduling';
import styles from './scheduling-overview-v2.module.css';

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function customerLabel(customer: BookingReferenceData['clients'][number]) {
  return text(customer.company) || text(customer.name) || customer.id;
}

function propertyLabel(property: BookingReferenceData['properties'][number]) {
  return text(property.name) || text(property.address) || property.id;
}

export function AfterHoursEmergencyPanel() {
  const [open, setOpen] = useState(false);
  const [references, setReferences] = useState<BookingReferenceData>({ clients: [], properties: [], contacts: [], contactAssignments: [] });
  const [presets, setPresets] = useState<OfficeBookingPreset[]>([]);
  const [capacity, setCapacity] = useState<LiveOperationalCapacityState | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [vanId, setVanId] = useState('VAN-1');
  const [startTime, setStartTime] = useState('17:00');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const today = currentArubaDateKey();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setNotice('');
    void Promise.all([
      loadBookingReferenceData(),
      listOfficeBookingPresets(true),
      loadLiveOperationalCapacityState({ startDate: today, endDate: today }),
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
  }, [open, today]);

  const properties = useMemo(
    () => references.properties.filter((property) => property.clientId === customerId && property.active !== false),
    [customerId, references.properties],
  );
  const selectedPreset = presets.find((preset) => preset.id === presetId);
  const selectedCrew = liveVanCrew(capacity, vanId, today);

  const selectCustomer = (nextCustomerId: string) => {
    setCustomerId(nextCustomerId);
    const first = references.properties.find((property) => property.clientId === nextCustomerId && property.active !== false);
    setPropertyId(first?.id || '');
    setNotice('');
  };

  const close = () => {
    if (busy) return;
    setOpen(false);
    setNotice('');
  };

  const submit = async () => {
    if (!customerId || !propertyId || !presetId || !vanId) {
      setNotice('Select customer, property, work type and Van.');
      return;
    }
    const hour = Number(startTime.split(':')[0]);
    if (!/^\d{2}:\d{2}$/.test(startTime) || hour < 17) {
      setNotice('After-hours emergency start must be 5:00 PM or later.');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await createAfterHoursEmergency({
        requestId: createOfficeLifecycleRequestId('after-hours'),
        customerId,
        propertyId,
        presetId,
        serviceId: selectedPreset?.serviceId,
        quantity,
        requestedDate: today,
        requestedTime: startTime,
        requiredVanId: vanId,
        customerFacingDescription: text(description),
        technicianInstructions: text(instructions),
        recipientSelections: [],
      });
      setNotice(`After-hours emergency ${result.workOrderIds[0]} created for ${startTime}. No planned end time was invented; the job remains open until real field completion.`);
      setDescription('');
      setInstructions('');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'After-hours emergency could not be created.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) return <section className={styles.board} style={{ marginTop: 12 }}>
    <header className={styles.boardHeader}>
      <div><strong>After-Hours / Emergency</strong><span>Extra operational work from 5:00 PM. This is not normal sellable daytime capacity and has no fabricated end time.</span></div>
      <button type="button" className={styles.secondary} onClick={() => setOpen(true)}>＋ ADD AFTER-HOURS JOB</button>
    </header>
  </section>;

  return <section className={styles.board} style={{ marginTop: 12 }}>
    <header className={styles.boardHeader}>
      <div><strong>After-Hours / Emergency</strong><span>{today} · start at 5:00 PM or later · duration stays open until real completion</span></div>
      <button type="button" className={styles.secondary} disabled={busy} onClick={close}>Close</button>
    </header>
    <div style={{ padding: 14, display: 'grid', gap: 12 }}>
      {notice ? <div className={styles.notice}><span>{notice}</span></div> : null}
      <div className={styles.formGrid}>
        <label><span>Customer</span><select disabled={loading || busy} value={customerId} onChange={(event) => selectCustomer(event.target.value)}><option value="">Select customer</option>{references.clients.map((customer) => <option key={customer.id} value={customer.id}>{customerLabel(customer)}</option>)}</select></label>
        <label><span>Property</span><select disabled={!customerId || loading || busy} value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Select property</option>{properties.map((property) => <option key={property.id} value={property.id}>{propertyLabel(property)}</option>)}</select></label>
        <label><span>Work type</span><select disabled={loading || busy} value={presetId} onChange={(event) => setPresetId(event.target.value)}><option value="">Select work</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <label><span>Quantity</span><input type="number" min="1" max="20" value={quantity} disabled={busy} onChange={(event) => setQuantity(Math.max(1, Math.min(20, Number(event.target.value) || 1)))} /></label>
        <label><span>Van</span><select value={vanId} disabled={busy} onChange={(event) => setVanId(event.target.value)}>{previewVans.filter((van) => van.active).map((van) => <option key={van.id} value={van.id}>{van.name}</option>)}</select><small>{selectedCrew.label}</small></label>
        <label><span>Start</span><input type="time" min="17:00" value={startTime} disabled={busy} onChange={(event) => setStartTime(event.target.value)} /><small>No end time is requested.</small></label>
        <label className={styles.wide}><span>Customer-facing description</span><textarea rows={2} value={description} disabled={busy} onChange={(event) => setDescription(event.target.value)} placeholder={selectedPreset ? `${selectedPreset.label} × ${quantity}` : 'Emergency work'} /></label>
        <label className={styles.wide}><span>Technician instructions</span><textarea rows={2} value={instructions} disabled={busy} onChange={(event) => setInstructions(event.target.value)} placeholder="Emergency context, access, equipment location, what the team should know…" /></label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: 'var(--muted)', fontSize: 7 }}>Booking Authority creates an open-ended emergency Work Order. A Van cannot own two simultaneous open-ended after-hours emergencies.</span>
        <button type="button" className={styles.primary} disabled={busy || loading || !customerId || !propertyId || !presetId} onClick={() => void submit()}>{busy ? 'Creating…' : 'CREATE AFTER-HOURS EMERGENCY'}</button>
      </div>
    </div>
  </section>;
}
