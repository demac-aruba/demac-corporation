'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  LiveCrmContact,
  LiveCrmCustomerGraph,
  LiveCrmProperty,
} from '@/lib/live-crm';
import { createOfficeLifecycleRequestId } from '@/lib/office-booking-authority';
import styles from './customer-master-data.module.css';

export type CustomerEditorValue = {
  id?: string;
  expectedUpdatedAt?: string;
  name: string;
  legalName?: string;
  type: 'Residential' | 'Commercial' | 'Enterprise';
  phone: string;
  whatsapp: string;
  email: string;
  location: string;
  preferredLanguage: 'Papiamento' | 'English' | 'Spanish' | 'Dutch';
};

export type ExistingCustomerIdentity = Pick<CustomerEditorValue, 'id' | 'name' | 'phone' | 'whatsapp' | 'email'>;

export type ContactEditorValue = {
  requestId?: string;
  id?: string;
  expectedUpdatedAt?: string;
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  preferredLanguage: string;
  propertyId: string;
  scope: 'property' | 'all_properties';
  role: string;
};

export type PropertyEditorValue = {
  requestId?: string;
  id?: string;
  expectedUpdatedAt?: string;
  name: string;
  type: string;
  address: string;
  zone: string;
  neighborhood: string;
  accessInstructions: string;
  notes: string;
};

type CustomerDrawerProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: CustomerEditorValue;
  existingCustomers: ExistingCustomerIdentity[];
  onClose: () => void;
  onSave: (value: CustomerEditorValue) => Promise<void>;
};

const emptyCustomer: CustomerEditorValue = {
  name: '', legalName: '', type: 'Residential', phone: '', whatsapp: '', email: '', location: '', preferredLanguage: 'Papiamento',
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhoneIdentity(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length === 7 ? `297${digits}` : digits;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The record could not be saved.';
}

function useDialogFocus(open: boolean, onClose: () => void, blocked: boolean) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  const blockedRef = useRef(blocked);
  closeRef.current = onClose;
  blockedRef.current = blocked;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const timer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      (dialog?.querySelector<HTMLElement>('[autofocus]') ?? dialog?.querySelector<HTMLElement>(focusableSelector))?.focus();
    }, 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !blockedRef.current) {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus();
    };
  }, [open]);

  return dialogRef;
}

export function CustomerEditorDrawer({ open, mode, initial, existingCustomers, onClose, onSave }: CustomerDrawerProps) {
  const [form, setForm] = useState<CustomerEditorValue>(initial ?? emptyCustomer);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(open, onClose, saving);

  useEffect(() => {
    if (!open) return;
    setForm(initial ?? emptyCustomer);
    setSaving(false);
    setError('');
  }, [initial, open]);

  const duplicates = useMemo(() => {
    const phone = normalizePhoneIdentity(form.phone);
    const whatsapp = normalizePhoneIdentity(form.whatsapp);
    const email = normalize(form.email);
    const name = normalize(form.name);
    if (!phone && !whatsapp && !email && !name) return [];
    return existingCustomers.filter((candidate) => {
      if (candidate.id && candidate.id === initial?.id) return false;
      return Boolean(
        (phone && [candidate.phone, candidate.whatsapp].some((value) => normalizePhoneIdentity(value) === phone))
        || (whatsapp && [candidate.phone, candidate.whatsapp].some((value) => normalizePhoneIdentity(value) === whatsapp))
        || (email && normalize(candidate.email) === email)
        || (name && normalize(candidate.name) === name),
      );
    });
  }, [existingCustomers, form.email, form.name, form.phone, form.whatsapp, initial?.id]);

  if (!open) return null;

  const update = <K extends keyof CustomerEditorValue>(key: K, value: CustomerEditorValue[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || (!form.phone.trim() && !form.whatsapp.trim()) || saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave({
        ...form,
        name: form.name.trim(),
        phone: form.phone.trim(),
        whatsapp: form.whatsapp.trim(),
        email: form.email.trim(),
        location: form.location.trim(),
        legalName: form.legalName?.trim(),
      });
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialogRef} className={styles.drawer} role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'Create customer' : 'Edit customer'}>
        <header className={styles.drawerHeader}>
          <div><span className={styles.eyebrow}>{mode === 'create' ? 'New relationship' : 'Canonical customer record'}</span><h2>{mode === 'create' ? 'Create customer' : 'Edit customer'}</h2><p>This record is shared by CRM, Scheduling, Work Orders and customer communications.</p></div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close" disabled={saving}>×</button>
        </header>

        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <section className={styles.formSection}>
            <div className={styles.sectionHeading}><strong>Identity</strong><span>One canonical customer, regardless of how many properties or contacts they have.</span></div>
            <div className={styles.fieldGrid}>
              <label className={styles.fieldWide}><span>Customer / display name *</span><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Customer or principal contact" /></label>
              <label><span>Relationship type</span><select value={form.type} onChange={(event) => update('type', event.target.value as CustomerEditorValue['type'])}><option>Residential</option><option>Commercial</option><option>Enterprise</option></select></label>
              <label><span>Company / legal name</span><input value={form.legalName ?? ''} onChange={(event) => update('legalName', event.target.value)} placeholder="Optional company name" /></label>
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.sectionHeading}><strong>Primary communication</strong><span>At least one phone or WhatsApp number is required.</span></div>
            <div className={styles.fieldGrid}>
              <label><span>Phone</span><input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+297 ..." /></label>
              <label><span>WhatsApp</span><input value={form.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} placeholder="Same as phone when applicable" /></label>
              <label><span>Email</span><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="name@example.com" /></label>
              <label><span>Preferred language</span><select value={form.preferredLanguage} onChange={(event) => update('preferredLanguage', event.target.value as CustomerEditorValue['preferredLanguage'])}><option>Papiamento</option><option>English</option><option>Spanish</option><option>Dutch</option></select></label>
              <label className={styles.fieldWide}><span>General area</span><input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="Noord, Santa Cruz, Oranjestad..." /></label>
            </div>
          </section>

          {duplicates.length > 0 ? <section className={styles.duplicateAlert}><div className={styles.duplicateIcon}>!</div><div><strong>Possible duplicate detected</strong><p>Close this form and select the existing relationship unless this is genuinely a different customer.</p>{duplicates.map((item) => <button type="button" disabled key={item.id ?? item.name}>{item.name} · {item.phone || item.whatsapp || item.email}</button>)}</div></section> : null}
          <section className={styles.dataRule}><span>CANONICAL DATA</span><p>Properties and people are separate linked records. Saving here updates the same customer identity used by appointments and Work Orders.</p></section>
          {error ? <div className={styles.dataRule} role="alert"><span>SAVE ERROR</span><p>{error}</p></div> : null}
          <footer className={styles.drawerFooter}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={!form.name.trim() || (!form.phone.trim() && !form.whatsapp.trim()) || saving}>{saving ? 'Saving…' : mode === 'create' ? 'Create customer' : 'Save changes'}</button></footer>
        </form>
      </aside>
    </div>
  );
}

type MasterTab = 'Contacts' | 'Properties' | 'Equipment';
type MasterDataProps = {
  tab: MasterTab;
  graph: LiveCrmCustomerGraph;
  onAddContact: (value: ContactEditorValue) => Promise<void>;
  onUpdateContact: (value: ContactEditorValue) => Promise<void>;
  onAddProperty: (value: PropertyEditorValue) => Promise<void>;
  onUpdateProperty: (value: PropertyEditorValue) => Promise<void>;
};
type EditorState =
  | { kind: 'contact'; mode: 'create' | 'edit'; requestId: string; initial?: ContactEditorValue }
  | { kind: 'property'; mode: 'create' | 'edit'; requestId: string; initial?: PropertyEditorValue }
  | null;

function contactEditorValue(contact: LiveCrmContact, graph: LiveCrmCustomerGraph): ContactEditorValue {
  const relationship = graph.contactRelationships.find((item) => item.contact.id === contact.id);
  const assignment = relationship?.assignments[0];
  return { id: contact.id, expectedUpdatedAt: contact.updatedAt, name: contact.name, phone: contact.phone ?? '', whatsapp: contact.whatsapp ?? '', email: contact.email ?? '', preferredLanguage: contact.preferredLanguage ?? 'Papiamento', propertyId: assignment?.propertyId ?? graph.properties[0]?.id ?? '', scope: assignment?.scope ?? 'property', role: assignment?.role ?? 'Contact' };
}

function propertyEditorValue(property: LiveCrmProperty): PropertyEditorValue {
  return { id: property.id, expectedUpdatedAt: property.updatedAt, name: property.name ?? '', type: property.type ?? 'Casa', address: property.address ?? property.addressRaw ?? '', zone: property.zone ?? property.operationalZone ?? '', neighborhood: property.neighborhood ?? '', accessInstructions: property.accessInstructions ?? '', notes: property.notes ?? '' };
}

function propertyName(property: LiveCrmProperty) {
  return property.name || property.address || property.id;
}

export function CustomerMasterDataTab({ tab, graph, onAddContact, onUpdateContact, onAddProperty, onUpdateProperty }: MasterDataProps) {
  const [editor, setEditor] = useState<EditorState>(null);
  const propertyById = useMemo(() => new Map(graph.properties.map((property) => [property.id, property])), [graph.properties]);
  const activeProperties = useMemo(() => graph.properties.filter((property) => property.active !== false), [graph.properties]);
  const copy = tab === 'Contacts'
    ? { title: 'People & relationships', subtitle: 'The customer/owner is distinct from contacts assigned to one or all properties.', action: 'Add contact' }
    : tab === 'Properties'
      ? { title: 'Properties / Sites', subtitle: 'Real service locations linked to this canonical customer.', action: 'Add property' }
      : { title: 'Registered Equipment', subtitle: 'Equipment registered by the field workflow and linked to a property.', action: '' };
  const openCreate = () => {
    if (tab === 'Contacts' && activeProperties.length > 0) setEditor({ kind: 'contact', mode: 'create', requestId: createOfficeLifecycleRequestId('crm-contact-create') });
    if (tab === 'Properties') setEditor({ kind: 'property', mode: 'create', requestId: createOfficeLifecycleRequestId('crm-property-create') });
  };

  return (
    <section className={styles.masterPanel}>
      <header className={styles.masterHeader}>
        <div><span>{graph.client.company || graph.client.name || graph.client.id}</span><h3>{copy.title}</h3><p>{copy.subtitle}</p></div>
        {copy.action ? <button type="button" onClick={openCreate} disabled={tab === 'Contacts' && activeProperties.length === 0} title={tab === 'Contacts' && activeProperties.length === 0 ? 'Add an active property before assigning a contact.' : undefined}>+ {copy.action}</button> : null}
      </header>

      {tab === 'Contacts' ? <div className={styles.recordList}>
        {graph.people.map((person) => {
          const assignmentLabel = person.scope === 'all_properties' ? `All ${person.properties.length} propert${person.properties.length === 1 ? 'y' : 'ies'}` : person.properties.map(propertyName).join(', ') || 'Not assigned to a property';
          return <article className={styles.recordCard} key={person.id}><div className={styles.recordAvatar}>{person.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div><div className={styles.recordMain}><div><strong>{person.name}</strong><b>{person.kind === 'owner' ? 'Customer / owner' : person.roles.join(' · ')}</b></div><span>{assignmentLabel}</span><small>{person.whatsapp || person.phone || 'No phone'}{person.email ? ` · ${person.email}` : ''}</small></div>{person.contact ? <button type="button" onClick={() => setEditor({ kind: 'contact', mode: 'edit', requestId: createOfficeLifecycleRequestId('crm-contact-update'), initial: contactEditorValue(person.contact!, graph) })}>Edit</button> : null}</article>;
        })}
        {activeProperties.length === 0 ? <div className={styles.emptyState}><strong>Add an active property before assigning contacts</strong><p>A property-specific role needs a real active property relationship.</p></div> : null}
      </div> : null}

      {tab === 'Properties' ? <div className={styles.recordList}>
        {graph.properties.map((property) => <article className={styles.siteCard} key={property.id}><div className={styles.siteIcon}>⌂</div><div className={styles.recordMain}><div><strong>{propertyName(property)}</strong><b>{property.active === false ? 'Inactive' : 'Active'}</b></div><span>{property.address || property.addressRaw || 'Address pending'}</span><small>{property.neighborhood || property.zone || property.operationalZone || 'Area pending'} · {property.type || 'Property'}</small>{property.accessInstructions ? <em>{property.accessInstructions}</em> : null}</div><button type="button" onClick={() => setEditor({ kind: 'property', mode: 'edit', requestId: createOfficeLifecycleRequestId('crm-property-update'), initial: propertyEditorValue(property) })}>Edit property</button></article>)}
        {graph.properties.length === 0 ? <div className={styles.emptyState}><strong>No properties registered</strong><p>Add the first real service location for this customer.</p></div> : null}
      </div> : null}

      {tab === 'Equipment' ? (graph.equipment.length ? <div className={styles.assetTableWrap}><table className={styles.assetTable}><thead><tr><th>Equipment</th><th>Property</th><th>System</th><th>Condition</th><th>QR / Serial</th><th>Status</th></tr></thead><tbody>{graph.equipment.map((item) => <tr key={item.id}><td><strong>{item.locationLabel || 'Registered A/C'}</strong><span>{item.id}</span></td><td>{item.propertyId ? propertyName(propertyById.get(item.propertyId) ?? { id: item.propertyId, clientId: graph.client.id }) : 'Unassigned'}</td><td>{item.systemType || item.brand || 'HVAC'}</td><td>{item.condition || 'Not recorded'}</td><td>{item.qrCode || item.serialNumber || '—'}</td><td><b>{item.active === false ? 'Inactive' : 'Active'}</b></td></tr>)}</tbody></table></div> : <div className={styles.emptyState}><strong>No equipment registered</strong><p>Equipment recorded during field execution will appear here under the correct customer and property.</p></div>) : null}

      {editor?.kind === 'contact' ? <ContactEditorDrawer mode={editor.mode} requestId={editor.requestId} initial={editor.initial} properties={activeProperties} onClose={() => setEditor(null)} onSave={editor.mode === 'edit' ? onUpdateContact : onAddContact} /> : null}
      {editor?.kind === 'property' ? <PropertyEditorDrawer mode={editor.mode} requestId={editor.requestId} initial={editor.initial} onClose={() => setEditor(null)} onSave={editor.mode === 'edit' ? onUpdateProperty : onAddProperty} /> : null}
    </section>
  );
}

function ContactEditorDrawer({ mode, requestId, initial, properties, onClose, onSave }: { mode: 'create' | 'edit'; requestId: string; initial?: ContactEditorValue; properties: LiveCrmProperty[]; onClose: () => void; onSave: (value: ContactEditorValue) => Promise<void> }) {
  const empty: ContactEditorValue = { name: '', phone: '', whatsapp: '', email: '', preferredLanguage: 'Papiamento', propertyId: properties[0]?.id ?? '', scope: 'property', role: 'Contact' };
  const [form, setForm] = useState<ContactEditorValue>(initial ?? empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(true, onClose, saving);
  const update = <K extends keyof ContactEditorValue>(key: K, value: ContactEditorValue[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || (!form.phone.trim() && !form.whatsapp.trim() && !form.email.trim()) || (mode === 'create' && !form.propertyId) || saving) return;
    setSaving(true); setError('');
    try { await onSave({ ...form, requestId }); onClose(); } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); }
  };
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialogRef} className={styles.drawer} role="dialog" aria-modal="true" aria-label={`${mode} contact`}>
        <header className={styles.drawerHeader}>
          <div><span className={styles.eyebrow}>Canonical contact</span><h2>{mode === 'create' ? 'Add contact' : 'Edit contact'}</h2><p>{mode === 'create' ? 'Link this person to one property or to every property owned or managed by the customer.' : 'Identity changes preserve the existing property relationships and communication rules.'}</p></div>
          <button type="button" className={styles.closeButton} onClick={onClose} disabled={saving} aria-label="Close">×</button>
        </header>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <section className={styles.formSection}><div className={styles.fieldGrid}>
            <label className={styles.fieldWide}><span>Full name *</span><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
            <label><span>Phone</span><input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></label>
            <label><span>WhatsApp</span><input value={form.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} /></label>
            <label><span>Email</span><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
            <label><span>Preferred language</span><select value={form.preferredLanguage} onChange={(event) => update('preferredLanguage', event.target.value)}><option>Papiamento</option><option>English</option><option>Spanish</option><option>Dutch</option></select></label>
            {mode === 'create' ? <><label><span>Role at property</span><input value={form.role} onChange={(event) => update('role', event.target.value)} placeholder="Owner, tenant, manager..." /></label><label><span>Applies to</span><select value={form.scope} onChange={(event) => update('scope', event.target.value as ContactEditorValue['scope'])}><option value="property">One property</option><option value="all_properties">All customer properties</option></select></label><label className={styles.fieldWide}><span>Property</span><select value={form.propertyId} onChange={(event) => update('propertyId', event.target.value)}>{properties.map((property) => <option key={property.id} value={property.id}>{propertyName(property)}</option>)}</select></label></> : null}
          </div></section>
          {error ? <div className={styles.dataRule} role="alert"><span>SAVE ERROR</span><p>{error}</p></div> : null}
          <footer className={styles.drawerFooter}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={!form.name.trim() || (!form.phone.trim() && !form.whatsapp.trim() && !form.email.trim()) || (mode === 'create' && !form.propertyId) || saving}>{saving ? 'Saving…' : 'Save contact'}</button></footer>
        </form>
      </aside>
    </div>
  );
}

function PropertyEditorDrawer({ mode, requestId, initial, onClose, onSave }: { mode: 'create' | 'edit'; requestId: string; initial?: PropertyEditorValue; onClose: () => void; onSave: (value: PropertyEditorValue) => Promise<void> }) {
  const empty: PropertyEditorValue = { name: '', type: 'Casa', address: '', zone: '', neighborhood: '', accessInstructions: '', notes: '' };
  const [form, setForm] = useState<PropertyEditorValue>(initial ?? empty);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(true, onClose, saving);
  const update = <K extends keyof PropertyEditorValue>(key: K, value: PropertyEditorValue[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.address.trim() || !form.zone.trim() || saving) return;
    setSaving(true); setError('');
    try { await onSave({ ...form, requestId }); onClose(); } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); }
  };
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialogRef} className={styles.drawer} role="dialog" aria-modal="true" aria-label={`${mode} property`}>
        <header className={styles.drawerHeader}>
          <div><span className={styles.eyebrow}>Canonical service location</span><h2>{mode === 'create' ? 'Add property' : 'Edit property'}</h2><p>The address, access and area remain linked to this property across Scheduling and Work Orders.</p></div>
          <button type="button" className={styles.closeButton} onClick={onClose} disabled={saving} aria-label="Close">×</button>
        </header>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <section className={styles.formSection}><div className={styles.fieldGrid}>
            <label><span>Property name</span><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Home, office, warehouse..." /></label>
            <label><span>Property type</span><select value={form.type} onChange={(event) => update('type', event.target.value)}><option>Casa</option><option>Apartamento</option><option>Oficina</option><option>Local comercial</option><option>Otro</option></select></label>
            <label className={styles.fieldWide}><span>Full address *</span><input value={form.address} onChange={(event) => update('address', event.target.value)} /></label>
            <label><span>Area / zone *</span><input value={form.zone} onChange={(event) => update('zone', event.target.value)} /></label>
            <label><span>Neighborhood</span><input value={form.neighborhood} onChange={(event) => update('neighborhood', event.target.value)} /></label>
            <label className={styles.fieldWide}><span>Access / parking / gate instructions</span><textarea rows={3} value={form.accessInstructions} onChange={(event) => update('accessInstructions', event.target.value)} /></label>
            <label className={styles.fieldWide}><span>Internal property notes</span><textarea rows={3} value={form.notes} onChange={(event) => update('notes', event.target.value)} /></label>
          </div></section>
          {error ? <div className={styles.dataRule} role="alert"><span>SAVE ERROR</span><p>{error}</p></div> : null}
          <footer className={styles.drawerFooter}><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={!form.address.trim() || !form.zone.trim() || saving}>{saving ? 'Saving…' : 'Save property'}</button></footer>
        </form>
      </aside>
    </div>
  );
}
