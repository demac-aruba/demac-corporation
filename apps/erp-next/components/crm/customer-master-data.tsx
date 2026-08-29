'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';
import type {
  LiveCrmContact,
  LiveCrmCustomerGraph,
  LiveCrmProperty,
} from '@/lib/live-crm';
import { matchesLiveCrmContactSearch } from '@/lib/live-crm';
import { createOfficeLifecycleRequestId } from '@/lib/office-booking-authority';
import contactLinkStyles from './customer-contact-link.module.css';
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

export type ContactCustomerCandidate = {
  id: string;
  active: boolean;
  name: string;
  company: string;
  type: string;
  phone: string;
  whatsapp: string;
  email: string;
  preferredLanguage: string;
  propertyLabels: string[];
};

export type ContactEditorValue = {
  requestId?: string;
  id?: string;
  linkedCustomerId?: string;
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
  customerCandidates: ContactCustomerCandidate[];
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
  return { id: contact.id, linkedCustomerId: contact.linkedCustomerId, expectedUpdatedAt: contact.updatedAt, name: contact.name, phone: contact.phone ?? '', whatsapp: contact.whatsapp ?? '', email: contact.email ?? '', preferredLanguage: contact.preferredLanguage ?? 'Papiamento', propertyId: assignment?.propertyId ?? graph.properties[0]?.id ?? '', scope: assignment?.scope ?? 'property', role: assignment?.role ?? 'Contact' };
}

function propertyEditorValue(property: LiveCrmProperty): PropertyEditorValue {
  return { id: property.id, expectedUpdatedAt: property.updatedAt, name: property.name ?? '', type: property.type ?? 'Casa', address: property.address ?? property.addressRaw ?? '', zone: property.zone ?? property.operationalZone ?? '', neighborhood: property.neighborhood ?? '', accessInstructions: property.accessInstructions ?? '', notes: property.notes ?? '' };
}

function propertyName(property: LiveCrmProperty) {
  return property.name || property.address || property.id;
}

export function CustomerMasterDataTab({ tab, graph, customerCandidates, onAddContact, onUpdateContact, onAddProperty, onUpdateProperty }: MasterDataProps) {
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
          const relationshipLabel = person.kind === 'owner' ? 'Customer / owner' : `${person.linkedCustomerId ? 'Existing customer · ' : ''}${person.roles.join(' · ')}`;
          return <article className={styles.recordCard} key={person.id}><div className={styles.recordAvatar}>{person.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</div><div className={styles.recordMain}><div><strong>{person.name}</strong><b>{relationshipLabel}</b></div><span>{assignmentLabel}</span><small>{person.whatsapp || person.phone || 'No phone'}{person.email ? ` · ${person.email}` : ''}</small></div>{person.contact ? person.linkedCustomerId ? <span className={contactLinkStyles.linkedIndicator}>Live identity</span> : <button type="button" onClick={() => setEditor({ kind: 'contact', mode: 'edit', requestId: createOfficeLifecycleRequestId('crm-contact-update'), initial: contactEditorValue(person.contact!, graph) })}>Edit</button> : null}</article>;
        })}
        {activeProperties.length === 0 ? <div className={styles.emptyState}><strong>Add an active property before assigning contacts</strong><p>A property-specific role needs a real active property relationship.</p></div> : null}
      </div> : null}

      {tab === 'Properties' ? <div className={styles.recordList}>
        {graph.properties.map((property) => <article className={styles.siteCard} key={property.id}><div className={styles.siteIcon}>⌂</div><div className={styles.recordMain}><div><strong>{propertyName(property)}</strong><b>{property.active === false ? 'Inactive' : 'Active'}</b></div><span>{property.address || property.addressRaw || 'Address pending'}</span><small>{property.neighborhood || property.zone || property.operationalZone || 'Area pending'} · {property.type || 'Property'}</small>{property.accessInstructions ? <em>{property.accessInstructions}</em> : null}</div><button type="button" onClick={() => setEditor({ kind: 'property', mode: 'edit', requestId: createOfficeLifecycleRequestId('crm-property-update'), initial: propertyEditorValue(property) })}>Edit property</button></article>)}
        {graph.properties.length === 0 ? <div className={styles.emptyState}><strong>No properties registered</strong><p>Add the first real service location for this customer.</p></div> : null}
      </div> : null}

      {tab === 'Equipment' ? (graph.equipment.length ? <div className={styles.assetTableWrap}><table className={styles.assetTable}><thead><tr><th>Equipment</th><th>Property</th><th>System</th><th>Condition</th><th>QR / Serial</th><th>Status</th></tr></thead><tbody>{graph.equipment.map((item) => <tr key={item.id}><td><strong>{item.locationLabel || 'Registered A/C'}</strong><span>{item.id}</span></td><td>{item.propertyId ? propertyName(propertyById.get(item.propertyId) ?? { id: item.propertyId, clientId: graph.client.id }) : 'Unassigned'}</td><td>{item.systemType || item.brand || 'HVAC'}</td><td>{item.condition || 'Not recorded'}</td><td>{item.qrCode || item.serialNumber || '—'}</td><td><b>{item.active === false ? 'Inactive' : 'Active'}</b></td></tr>)}</tbody></table></div> : <div className={styles.emptyState}><strong>No equipment registered</strong><p>Equipment recorded during field execution will appear here under the correct customer and property.</p></div>) : null}

      {editor?.kind === 'contact' ? <ContactEditorDrawer mode={editor.mode} requestId={editor.requestId} initial={editor.initial} properties={activeProperties} customerCandidates={customerCandidates} currentCustomerId={graph.client.id} onClose={() => setEditor(null)} onSave={editor.mode === 'edit' ? onUpdateContact : onAddContact} /> : null}
      {editor?.kind === 'property' ? <PropertyEditorDrawer mode={editor.mode} requestId={editor.requestId} initial={editor.initial} onClose={() => setEditor(null)} onSave={editor.mode === 'edit' ? onUpdateProperty : onAddProperty} /> : null}
    </section>
  );
}

function ContactEditorDrawer({ mode, requestId, initial, properties, customerCandidates, currentCustomerId, onClose, onSave }: { mode: 'create' | 'edit'; requestId: string; initial?: ContactEditorValue; properties: LiveCrmProperty[]; customerCandidates: ContactCustomerCandidate[]; currentCustomerId: string; onClose: () => void; onSave: (value: ContactEditorValue) => Promise<void> }) {
  const empty: ContactEditorValue = { name: '', phone: '', whatsapp: '', email: '', preferredLanguage: 'Papiamento', propertyId: properties[0]?.id ?? '', scope: 'property', role: 'Contact' };
  const [form, setForm] = useState<ContactEditorValue>(initial ?? empty);
  const [identityMode, setIdentityMode] = useState<'existing' | 'new'>(() => mode === 'create' || initial?.linkedCustomerId ? 'existing' : 'new');
  const [customerQuery, setCustomerQuery] = useState('');
  const [resultsOpen, setResultsOpen] = useState(false);
  const [activeResult, setActiveResult] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useDialogFocus(true, onClose, saving);
  const searchInputId = useId();
  const resultsId = useId();
  const availableCustomers = useMemo(() => customerCandidates.filter((candidate) => candidate.active && candidate.id !== currentCustomerId), [currentCustomerId, customerCandidates]);
  const selectedCustomer = useMemo(() => form.linkedCustomerId ? availableCustomers.find((candidate) => candidate.id === form.linkedCustomerId) : undefined, [availableCustomers, form.linkedCustomerId]);
  const searchResults = useMemo(() => {
    if (!customerQuery.trim()) return [];
    return availableCustomers.filter((candidate) => matchesLiveCrmContactSearch([
      candidate.name,
      candidate.company,
      candidate.phone,
      candidate.whatsapp,
      candidate.email,
      ...candidate.propertyLabels,
    ], customerQuery)).slice(0, 8);
  }, [availableCustomers, customerQuery]);
  const update = <K extends keyof ContactEditorValue>(key: K, value: ContactEditorValue[K]) => setForm((current) => ({ ...current, [key]: value }));
  const selectExistingCustomer = (candidate: ContactCustomerCandidate) => {
    setIdentityMode('existing');
    setForm((current) => ({
      ...current,
      linkedCustomerId: candidate.id,
      name: candidate.name,
      phone: candidate.phone,
      whatsapp: candidate.whatsapp,
      email: candidate.email,
      preferredLanguage: candidate.preferredLanguage || 'Papiamento',
    }));
    setCustomerQuery('');
    setResultsOpen(false);
    setActiveResult(0);
    setError('');
  };
  const clearExistingCustomer = (focusSearch = true) => {
    setForm((current) => ({ ...current, linkedCustomerId: undefined, name: '', phone: '', whatsapp: '', email: '', preferredLanguage: 'Papiamento' }));
    setCustomerQuery('');
    setResultsOpen(false);
    if (focusSearch) window.setTimeout(() => document.getElementById(searchInputId)?.focus(), 0);
  };
  const changeIdentityMode = (nextMode: 'existing' | 'new') => {
    if (nextMode === identityMode) return;
    setIdentityMode(nextMode);
    clearExistingCustomer(nextMode === 'existing');
  };
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && resultsOpen) {
      event.stopPropagation();
      setResultsOpen(false);
      return;
    }
    if (!searchResults.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setResultsOpen(true);
      setActiveResult((current) => (current + 1) % searchResults.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setResultsOpen(true);
      setActiveResult((current) => (current - 1 + searchResults.length) % searchResults.length);
    } else if (event.key === 'Enter' && resultsOpen) {
      event.preventDefault();
      selectExistingCustomer(searchResults[Math.min(activeResult, searchResults.length - 1)]);
    }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const validIdentity = form.linkedCustomerId || (form.name.trim() && (form.phone.trim() || form.whatsapp.trim() || form.email.trim()));
    if (!validIdentity || (mode === 'create' && !form.propertyId) || saving) return;
    setSaving(true); setError('');
    try {
      await onSave({ ...form, requestId, name: form.name.trim(), phone: form.phone.trim(), whatsapp: form.whatsapp.trim(), email: form.email.trim() });
      onClose();
    } catch (saveError) { setError(errorMessage(saveError)); } finally { setSaving(false); }
  };
  const selectedProfile = selectedCustomer ?? (form.linkedCustomerId ? {
    id: form.linkedCustomerId,
    active: true,
    name: form.name,
    company: '',
    type: 'Customer',
    phone: form.phone,
    whatsapp: form.whatsapp,
    email: form.email,
    preferredLanguage: form.preferredLanguage,
    propertyLabels: [],
  } : undefined);
  const canSubmit = Boolean(form.linkedCustomerId || (form.name.trim() && (form.phone.trim() || form.whatsapp.trim() || form.email.trim()))) && (mode !== 'create' || Boolean(form.propertyId));
  const manualContactFields = <div className={styles.fieldGrid}>
    <label className={styles.fieldWide}><span>Full name *</span><input autoFocus={identityMode === 'new'} value={form.name} onChange={(event) => update('name', event.target.value)} /></label>
    <label><span>Phone</span><input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></label>
    <label><span>WhatsApp</span><input value={form.whatsapp} onChange={(event) => update('whatsapp', event.target.value)} /></label>
    <label><span>Email</span><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
    <label><span>Preferred language</span><select value={form.preferredLanguage} onChange={(event) => update('preferredLanguage', event.target.value)}><option>Papiamento</option><option>English</option><option>Spanish</option><option>Dutch</option></select></label>
  </div>;
  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) onClose(); }}>
      <aside ref={dialogRef} className={styles.drawer} role="dialog" aria-modal="true" aria-label={`${mode} contact`}>
        <header className={styles.drawerHeader}>
          <div><span className={styles.eyebrow}>Canonical contact</span><h2>{mode === 'create' ? 'Add contact' : 'Edit contact'}</h2><p>{mode === 'create' ? 'Find an existing customer profile or create a new contact, then link the person to the right property.' : form.linkedCustomerId ? 'This contact uses an existing customer profile as its canonical identity.' : 'Identity changes preserve the existing property relationships and communication rules.'}</p></div>
          <button type="button" className={styles.closeButton} onClick={onClose} disabled={saving} aria-label="Close">×</button>
        </header>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          {mode === 'create' ? <section className={styles.formSection}>
            <div className={styles.sectionHeading}><strong>{selectedProfile ? 'Selected customer' : 'Customer'}</strong><span>{selectedProfile ? 'Identity details stay connected to the original customer record.' : 'Search canonical CRM records or create a new contact.'}</span></div>
            {selectedProfile ? <div className={contactLinkStyles.selectedIdentity}><div className={contactLinkStyles.selectedIdentityAvatar}>{selectedProfile.name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'CU'}</div><div><strong>{selectedProfile.name}</strong><span>{selectedProfile.company && selectedProfile.company !== selectedProfile.name ? selectedProfile.company : selectedProfile.type || 'Existing customer'}</span><small>{[selectedProfile.whatsapp || selectedProfile.phone, selectedProfile.email, selectedProfile.propertyLabels[0]].filter(Boolean).join(' · ') || 'No communication channel'}</small></div><button type="button" onClick={() => clearExistingCustomer()}>Change</button></div> : <div className={contactLinkStyles.customerLookup}>
              <label htmlFor={searchInputId}>Search customer</label>
              <input id={searchInputId} autoFocus={identityMode === 'existing'} role="combobox" aria-autocomplete="list" aria-expanded={resultsOpen && Boolean(customerQuery.trim())} aria-controls={resultsId} aria-activedescendant={resultsOpen && searchResults.length ? `${resultsId}-${Math.min(activeResult, searchResults.length - 1)}` : undefined} value={customerQuery} onFocus={() => setResultsOpen(Boolean(customerQuery.trim()))} onBlur={() => setResultsOpen(false)} onChange={(event) => { setCustomerQuery(event.target.value); setResultsOpen(Boolean(event.target.value.trim())); setActiveResult(0); }} onKeyDown={onSearchKeyDown} placeholder="Name, company, phone, WhatsApp, address or area…" />
              {resultsOpen && customerQuery.trim() ? <ul id={resultsId} className={contactLinkStyles.customerResults} role="listbox" aria-label="Matching customer profiles">{searchResults.map((candidate, index) => <li id={`${resultsId}-${index}`} key={candidate.id} role="option" aria-selected={index === activeResult} className={index === activeResult ? contactLinkStyles.customerResultActive : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => selectExistingCustomer(candidate)}><strong>{candidate.name}</strong><span>{candidate.company && candidate.company !== candidate.name ? candidate.company : candidate.type || 'Customer'}{candidate.propertyLabels[0] ? ` · ${candidate.propertyLabels[0]}` : ''}</span><small>{[candidate.whatsapp || candidate.phone, candidate.email].filter(Boolean).join(' · ') || 'No communication channel'}</small></li>)}{!searchResults.length ? <li className={contactLinkStyles.customerNoResults} role="option" aria-disabled="true">No existing customer matches this search.</li> : null}</ul> : null}
              <button type="button" className={contactLinkStyles.inlineAction} onClick={() => changeIdentityMode('new')}>＋ Create contact</button>
              {identityMode === 'new' ? <div className={contactLinkStyles.manualEditor}><header><div><strong>Create contact</strong><span>Enter the person only when no customer record matches.</span></div><button type="button" onClick={() => changeIdentityMode('existing')} aria-label="Cancel new contact">×</button></header>{manualContactFields}</div> : null}
            </div>}
          </section> : identityMode === 'existing' ? <section className={styles.formSection}>
            <div className={styles.sectionHeading}><strong>Linked customer profile</strong><span>Identity details stay connected to the original customer record.</span></div>
            {selectedProfile ? <div className={contactLinkStyles.selectedIdentity}><div className={contactLinkStyles.selectedIdentityAvatar}>{selectedProfile.name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'CU'}</div><div><strong>{selectedProfile.name}</strong><span>{selectedProfile.company && selectedProfile.company !== selectedProfile.name ? selectedProfile.company : selectedProfile.type || 'Existing customer'}</span><small>{[selectedProfile.whatsapp || selectedProfile.phone, selectedProfile.email, selectedProfile.propertyLabels[0]].filter(Boolean).join(' · ') || 'No communication channel'}</small></div></div> : null}
          </section> : <section className={styles.formSection}>{manualContactFields}</section>}
          {mode === 'create' ? <section className={styles.formSection}><div className={styles.fieldGrid}><label><span>Role at property</span><input value={form.role} onChange={(event) => update('role', event.target.value)} placeholder="Owner, tenant, manager..." /></label><label><span>Applies to</span><select value={form.scope} onChange={(event) => update('scope', event.target.value as ContactEditorValue['scope'])}><option value="property">One property</option><option value="all_properties">All customer properties</option></select></label><label className={styles.fieldWide}><span>Property</span><select value={form.propertyId} onChange={(event) => update('propertyId', event.target.value)}>{properties.map((property) => <option key={property.id} value={property.id}>{propertyName(property)}</option>)}</select></label></div></section> : null}
          {mode === 'edit' && form.linkedCustomerId ? <section className={styles.dataRule}><span>LIVE CUSTOMER IDENTITY</span><p>Name and communication details come from the linked customer profile. Edit that customer record to change them everywhere without creating a duplicate identity.</p></section> : null}
          {error ? <div className={styles.dataRule} role="alert"><span>SAVE ERROR</span><p>{error}</p></div> : null}
          <footer className={styles.drawerFooter}>{mode === 'edit' && form.linkedCustomerId ? <button type="button" className={styles.primaryButton} onClick={onClose}>Close</button> : <><button type="button" className={styles.secondaryButton} onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className={styles.primaryButton} disabled={!canSubmit || saving}>{saving ? 'Saving…' : form.linkedCustomerId ? 'Link customer as contact' : 'Save contact'}</button></>}</footer>
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
