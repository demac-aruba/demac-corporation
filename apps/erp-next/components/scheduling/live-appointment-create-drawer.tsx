'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  checkOfficeCreateAvailability,
  confirmOfficeAppointment,
  createOfficeLifecycleRequestId,
  listOfficeBookingPresets,
  type OfficeBookingOption,
  type OfficeBookingPreset,
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
};

type Props = {
  target: LiveBookingTarget;
  onClose: () => void;
  onCreated: (booking: LiveCreatedBooking) => void;
};

type CustomerDraft = NewBookingCustomer & {
  preferredLanguage: string;
};

type PropertyDraft = NewBookingProperty & {
  type: string;
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
  name: 'Primary Property',
  type: 'Casa',
  address: '',
  zone: '',
  neighborhood: '',
  notes: '',
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
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
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours} hour${hours === 1 ? '' : 's'}`;
}

function customerLabel(customer: BookingCustomer) {
  return text(customer.company) || text(customer.name) || customer.id;
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

export function LiveAppointmentCreateDrawer({ target, onClose, onCreated }: Props) {
  const [references, setReferences] = useState<BookingReferenceData>({ clients: [], properties: [] });
  const [presets, setPresets] = useState<OfficeBookingPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [presetId, setPresetId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [description, setDescription] = useState('');
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
  const [authorityError, setAuthorityError] = useState('');
  const [validated, setValidated] = useState<{ signature: string; offerId: string; offerVersion: number; option: OfficeBookingOption } | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError('');
    void Promise.all([loadBookingReferenceData(), listOfficeBookingPresets()])
      .then(([referenceData, presetResult]) => {
        if (!active) return;
        const availablePresets = presetResult.presets.filter((preset) => preset.active !== false);
        setReferences(referenceData);
        setPresets(availablePresets);
        setPresetId((current) => current || availablePresets[0]?.id || '');
      })
      .catch((error) => {
        if (active) setLoadError(error instanceof Error ? error.message : 'Scheduling reference data could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const selectedCustomer = references.clients.find((customer) => customer.id === customerId);
  const customerProperties = useMemo(
    () => references.properties.filter((property) => property.clientId === customerId && property.active !== false),
    [customerId, references.properties],
  );
  const selectedProperty = customerProperties.find((property) => property.id === propertyId);
  const selectedPreset = presets.find((preset) => preset.id === presetId);

  const filteredCustomers = useMemo(() => {
    const needle = customerQuery.trim().toLowerCase();
    const propertiesByCustomer = new Map<string, string[]>();
    for (const property of references.properties) {
      const id = text(property.clientId);
      if (!id) continue;
      const current = propertiesByCustomer.get(id) ?? [];
      current.push(`${text(property.name)} ${text(property.address)} ${text(property.zone)} ${text(property.neighborhood)}`);
      propertiesByCustomer.set(id, current);
    }
    const matches = references.clients.filter((customer) => {
      if (customer.active === false) return false;
      if (!needle) return true;
      const haystack = [
        customer.name,
        customer.company,
        customer.phone,
        customer.whatsapp,
        customer.email,
        customer.address,
        customer.zone,
        ...(propertiesByCustomer.get(customer.id) ?? []),
      ].map((item) => text(item)).join(' ').toLowerCase();
      return haystack.includes(needle);
    });
    if (needle) return matches.slice(0, 10);
    if (selectedCustomer) return [selectedCustomer, ...matches.filter((item) => item.id !== selectedCustomer.id).slice(0, 5)];
    return matches.slice(0, 6);
  }, [customerQuery, references.clients, references.properties, selectedCustomer]);

  const estimatedMinutes = (selectedPreset?.durationMinutesPerUnit ?? 0) * quantity;
  const signature = [customerId, propertyId, presetId, quantity, description.trim(), technicianInstructions.trim(), target.dateKey, target.vanId, target.start].join('|');
  const activeValidation = validated?.signature === signature ? validated : null;

  const selectCustomer = (customer: BookingCustomer) => {
    setCustomerId(customer.id);
    const firstProperty = references.properties.find((property) => property.clientId === customer.id && property.active !== false);
    setPropertyId(firstProperty?.id ?? '');
    setCustomerQuery('');
    setAuthorityError('');
    setMasterError('');
    setCustomerEditorOpen(false);
    setPropertyEditorOpen(false);
  };

  const openCustomerEditor = () => {
    setCustomerDraft({ ...emptyCustomer, name: customerQuery.trim() });
    setCustomerPropertyDraft(emptyProperty);
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
        property: customerPropertyDraft,
        references,
      });
      setReferences((current) => ({
        clients: [...current.clients, created.customer],
        properties: [...current.properties, created.property],
      }));
      setCustomerId(created.customer.id);
      setPropertyId(created.property.id);
      setCustomerQuery('');
      setCustomerEditorOpen(false);
    } catch (error) {
      setMasterError(error instanceof Error ? error.message : 'The customer could not be created.');
    } finally {
      setMasterSaving(false);
    }
  };

  const openPropertyEditor = () => {
    if (!selectedCustomer) return;
    setPropertyDraft({ ...emptyProperty, name: `Property ${customerProperties.length + 1}`, zone: text(selectedCustomer.zone) });
    setMasterError('');
    setPropertyEditorOpen(true);
    setCustomerEditorOpen(false);
  };

  const saveProperty = async () => {
    if (!selectedCustomer || masterSaving) return;
    setMasterSaving(true);
    setMasterError('');
    try {
      const created = await createBookingProperty(selectedCustomer.id, propertyDraft);
      setReferences((current) => ({ ...current, properties: [...current.properties, created] }));
      setPropertyId(created.id);
      setPropertyEditorOpen(false);
    } catch (error) {
      setMasterError(error instanceof Error ? error.message : 'The property could not be created.');
    } finally {
      setMasterSaving(false);
    }
  };

  const validateTarget = async () => {
    if (!selectedCustomer) return setAuthorityError('Select or create a customer first.');
    if (!selectedProperty) return setAuthorityError('Select or add a service property first.');
    if (!selectedPreset) return setAuthorityError('Select a work type first.');
    setChecking(true);
    setAuthorityError('');
    setValidated(null);
    try {
      const result = await checkOfficeCreateAvailability({
        requestId: createOfficeLifecycleRequestId('schedule-create-check'),
        customerId: selectedCustomer.id,
        propertyId: selectedProperty.id,
        presetId: selectedPreset.id,
        quantity,
        requestedDate: target.dateKey,
        requestedTime: target.start,
        requiredVanId: target.vanId,
        customerFacingDescription: description.trim(),
        technicianInstructions: technicianInstructions.trim(),
        notes: `Created from LIVE Scheduling slot ${target.vanId} ${target.dateKey} ${target.start}.`,
      });
      const exactOption = result.options.find((option) => optionMatchesTarget(option, target));
      if (!result.available || !result.offer || !exactOption) {
        const reason = result.reason ? ` (${result.reason})` : '';
        setAuthorityError(`Booking Authority could not reserve this exact van/time for the selected work${reason}. The schedule was not changed.`);
        return;
      }
      setValidated({
        signature,
        offerId: result.offer.id,
        offerVersion: result.offer.version,
        option: exactOption,
      });
    } catch (error) {
      setAuthorityError(error instanceof Error ? error.message : 'Booking Authority could not validate this target.');
    } finally {
      setChecking(false);
    }
  };

  const confirmBooking = async () => {
    if (!activeValidation || !selectedCustomer || !selectedProperty || !selectedPreset || saving) return;
    setSaving(true);
    setAuthorityError('');
    const { offerId, offerVersion, option } = activeValidation;
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
        preset: selectedPreset,
      });
    } catch (error) {
      setValidated(null);
      setAuthorityError(error instanceof Error ? error.message : 'The appointment could not be confirmed.');
    } finally {
      setSaving(false);
    }
  };

  const busy = loading || masterSaving || checking || saving;

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Create appointment">
        <header className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Booking Authority · Canonical Scheduling</span>
            <h2>New appointment</h2>
            <p>Select the real customer and work details. The appointment is committed only after Booking Authority revalidates the exact capacity.</p>
          </div>
          <button type="button" className={styles.close} disabled={busy} onClick={onClose} aria-label="Close">×</button>
        </header>

        <div className={styles.body}>
          <section className={styles.targetCard}>
            <div><span>DATE</span><strong>{formatDate(target.dateKey)}</strong></div>
            <div><span>VAN</span><strong>{target.vanName}</strong></div>
            <div><span>START</span><strong>{formatTime(target.start)}</strong></div>
            <div><span>OPEN BLOCK</span><strong>{formatTime(target.start)}–{formatTime(target.end)}</strong></div>
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
              <div className={styles.searchResults}>
                {filteredCustomers.map((customer) => (
                  <button type="button" key={customer.id} className={`${styles.searchResult} ${customer.id === customerId ? styles.selectedResult : ''}`} onClick={() => selectCustomer(customer)}>
                    <div><strong>{customerLabel(customer)}</strong><span>{text(customer.name) && text(customer.company) ? `${customer.name} · ` : ''}{text(customer.phone) || text(customer.whatsapp) || 'No phone'}</span></div>
                    <small>{text(customer.zone) || 'Area not specified'}</small>
                    <b>{customer.id === customerId ? 'SELECTED' : 'SELECT'}</b>
                  </button>
                ))}
                {customerQuery.trim() && !filteredCustomers.length ? <div className={styles.emptyResult}>No existing customer matches this search.</div> : null}
              </div>
              <button type="button" className={styles.inlineAction} onClick={openCustomerEditor}>＋ Create customer</button>

              {customerEditorOpen ? (
                <div className={styles.editorPanel}>
                  <header><div><strong>Create customer + first property</strong><span>Saved directly to canonical CRM master data; no browser-only customer is created.</span></div><button type="button" onClick={() => setCustomerEditorOpen(false)}>×</button></header>
                  <div className={styles.formGrid}>
                    <Field label="Customer name *" value={customerDraft.name} onChange={(value) => setCustomerDraft((current) => ({ ...current, name: value }))} />
                    <Field label="Company" value={customerDraft.company ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, company: value }))} />
                    <Field label="Phone / WhatsApp *" value={customerDraft.phone} onChange={(value) => setCustomerDraft((current) => ({ ...current, phone: value }))} placeholder="564-2625" />
                    <Field label="WhatsApp if different" value={customerDraft.whatsapp ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, whatsapp: value }))} />
                    <Field label="Email" value={customerDraft.email ?? ''} onChange={(value) => setCustomerDraft((current) => ({ ...current, email: value }))} type="email" />
                    <label><span>Preferred language</span><select value={customerDraft.preferredLanguage} onChange={(event) => setCustomerDraft((current) => ({ ...current, preferredLanguage: event.target.value }))}><option>Papiamento</option><option>English</option><option>Español</option><option>Nederlands</option></select></label>
                    <div className={styles.formDivider}>First service property</div>
                    <Field label="Property name" value={customerPropertyDraft.name} onChange={(value) => setCustomerPropertyDraft((current) => ({ ...current, name: value }))} />
                    <label><span>Property type</span><select value={customerPropertyDraft.type} onChange={(event) => setCustomerPropertyDraft((current) => ({ ...current, type: event.target.value }))}><option>Casa</option><option>Apartamento</option><option>Oficina</option><option>Local comercial</option><option>Otro</option></select></label>
                    <Field label="Address *" value={customerPropertyDraft.address} onChange={(value) => setCustomerPropertyDraft((current) => ({ ...current, address: value }))} wide />
                    <Field label="Area / zone *" value={customerPropertyDraft.zone} onChange={(value) => setCustomerPropertyDraft((current) => ({ ...current, zone: value }))} />
                    <Field label="Neighborhood" value={customerPropertyDraft.neighborhood ?? ''} onChange={(value) => setCustomerPropertyDraft((current) => ({ ...current, neighborhood: value }))} />
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
                      <button type="button" key={property.id} className={`${styles.choice} ${property.id === propertyId ? styles.choiceSelected : ''}`} onClick={() => { setPropertyId(property.id); setAuthorityError(''); }}>
                        <strong>{propertyLabel(property)}</strong><span>{text(property.address) || 'No address'}</span><small>{text(property.operationalZone) || text(property.zone) || 'Area not specified'}</small>
                      </button>
                    ))}
                  </div>
                  {!customerProperties.length ? <div className={styles.emptyResult}>This customer has no active service property yet.</div> : null}
                  <button type="button" className={styles.inlineAction} onClick={openPropertyEditor}>＋ Add property</button>
                </>
              ) : <div className={styles.emptyResult}>Select a customer to load their properties.</div>}

              {propertyEditorOpen ? (
                <div className={styles.editorPanel}>
                  <header><div><strong>Add property for {selectedCustomer ? customerLabel(selectedCustomer) : 'customer'}</strong><span>This property becomes available throughout canonical CRM and Scheduling.</span></div><button type="button" onClick={() => setPropertyEditorOpen(false)}>×</button></header>
                  <div className={styles.formGrid}>
                    <Field label="Property name *" value={propertyDraft.name} onChange={(value) => setPropertyDraft((current) => ({ ...current, name: value }))} />
                    <label><span>Property type</span><select value={propertyDraft.type} onChange={(event) => setPropertyDraft((current) => ({ ...current, type: event.target.value }))}><option>Casa</option><option>Apartamento</option><option>Oficina</option><option>Local comercial</option><option>Otro</option></select></label>
                    <Field label="Address *" value={propertyDraft.address} onChange={(value) => setPropertyDraft((current) => ({ ...current, address: value }))} wide />
                    <Field label="Area / zone *" value={propertyDraft.zone} onChange={(value) => setPropertyDraft((current) => ({ ...current, zone: value }))} />
                    <Field label="Neighborhood" value={propertyDraft.neighborhood ?? ''} onChange={(value) => setPropertyDraft((current) => ({ ...current, neighborhood: value }))} />
                    <Field label="Notes" value={propertyDraft.notes ?? ''} onChange={(value) => setPropertyDraft((current) => ({ ...current, notes: value }))} wide />
                  </div>
                  <footer><button type="button" className={styles.secondaryButton} disabled={masterSaving} onClick={() => setPropertyEditorOpen(false)}>Cancel</button><button type="button" className={styles.primaryButton} disabled={masterSaving} onClick={() => void saveProperty()}>{masterSaving ? 'Saving…' : 'Add & select'}</button></footer>
                </div>
              ) : null}
            </div>
          </section>

          <section className={styles.section}>
            <header><div><span>3</span><strong>Work & duration</strong><small>Duration comes from the canonical ERP work preset, not a browser-only estimate.</small></div></header>
            <div className={styles.sectionBody}>
              <div className={styles.presetGrid}>
                {presets.map((preset) => (
                  <button type="button" key={preset.id} className={`${styles.preset} ${preset.id === presetId ? styles.presetSelected : ''}`} onClick={() => { setPresetId(preset.id); setAuthorityError(''); }}>
                    <strong>{preset.label}</strong><span>{preset.durationMinutesPerUnit} min / unit</span>
                  </button>
                ))}
              </div>
              {!presets.length && !loading ? <div className={styles.emptyResult}>No active Booking Authority work presets were found.</div> : null}
              <div className={styles.quantityRow}>
                <div><span>Quantity</span><strong>{quantity} unit{quantity === 1 ? '' : 's'}</strong></div>
                <div className={styles.stepper}><button type="button" disabled={quantity <= 1} onClick={() => setQuantity((value) => Math.max(1, value - 1))}>−</button><b>{quantity}</b><button type="button" disabled={quantity >= 10} onClick={() => setQuantity((value) => Math.min(10, value + 1))}>＋</button></div>
                <div><span>Calculated work duration</span><strong>{estimatedMinutes ? durationLabel(estimatedMinutes) : 'Select work type'}</strong></div>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.fieldWide}><span>Customer-facing work description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Example: Standard service for two split units; customer reports weak cooling in the bedroom." /></label>
                <label className={styles.fieldWide}><span>Technician instructions</span><textarea value={technicianInstructions} onChange={(event) => setTechnicianInstructions(event.target.value)} placeholder="Access instructions, contact person, equipment location, diagnostic notes…" /></label>
              </div>
            </div>
          </section>

          <section className={styles.authoritySection}>
            <div className={styles.authorityHeading}><div><span>4</span><strong>Final capacity validation</strong><small>The exact {target.vanName} / {formatTime(target.start)} target is revalidated server-side before anything is written.</small></div><button type="button" className={styles.validateButton} disabled={busy || !selectedCustomer || !selectedProperty || !selectedPreset} onClick={() => void validateTarget()}>{checking ? 'Validating…' : activeValidation ? 'Revalidate target' : 'Validate target'}</button></div>

            {activeValidation ? (
              <div className={styles.validationSuccess}>
                <header><div><b>✓</b><div><strong>Booking Authority approved this exact target</strong><span>Offer {activeValidation.offerId} · final transaction validation still runs on confirm.</span></div></div></header>
                <div className={styles.assignmentGrid}>
                  {activeValidation.option.assignments.map((assignment, index) => (
                    <article key={`${assignment.vanId}-${assignment.time || activeValidation.option.time}-${index}`}>
                      <span>{index === 0 ? 'PRIMARY' : 'SUPPORT'}</span>
                      <strong>{assignment.vanName || assignment.vanId}</strong>
                      <small>{formatTime(assignment.time || activeValidation.option.time)}{assignment.endTime ? `–${formatTime(assignment.endTime)}` : ''} · {assignment.quantity} unit{assignment.quantity === 1 ? '' : 's'}</small>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.authorityIdle}>Complete the customer, property and work details, then validate. No appointment or capacity lock is created until final confirmation.</div>
            )}
          </section>
        </div>

        <footer className={styles.footer}>
          <div><span>CANONICAL WRITE PATH</span><strong>Booking Authority → Appointment + Work Order + Capacity Locks</strong></div>
          <div><button type="button" className={styles.secondaryButton} disabled={busy} onClick={onClose}>Cancel</button><button type="button" className={styles.confirmButton} disabled={!activeValidation || busy} onClick={() => void confirmBooking()}>{saving ? 'Confirming…' : 'Confirm appointment'}</button></div>
        </footer>
      </aside>
    </div>
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
