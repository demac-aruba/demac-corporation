'use client';

import { useMemo, useState } from 'react';
import {
  communicationBadges,
  contactDisplayChannel,
  customerContacts,
  defaultContactCommunicationRules,
  resolvedContactsForProperty,
  type AppointmentRecipientSelection,
  type BookingContact,
  type BookingContactAssignment,
  type ContactCommunicationRules,
  type NewBookingContactLink,
} from '../../lib/customer-contacts';
import {
  createOfficeLifecycleRequestId,
  deactivateOfficeContactAssignment,
  saveOfficeContactAssignment,
} from '../../lib/office-booking-authority';

const roles = ['Owner', 'Manager', 'Administrator', 'Tenant', 'Access contact', 'Accounting', 'Supervisor', 'Other'];
const languages = ['Papiamento', 'English', 'Español', 'Nederlands'];

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function linkLabel(link: NewBookingContactLink, contacts: BookingContact[]) {
  if (link.contactId) return contacts.find((contact) => contact.id === link.contactId)?.name || link.contactId;
  return text(link.contact?.name) || 'New contact';
}

function RuleChecks({ rules, onChange }: { rules: ContactCommunicationRules; onChange: (next: ContactCommunicationRules) => void }) {
  const options: Array<[keyof ContactCommunicationRules, string]> = [
    ['appointmentConfirmation', 'Confirmation'],
    ['appointmentReminder', 'Reminder'],
    ['technicianArrival', 'Technician arrival'],
    ['invoice', 'Invoice'],
    ['serviceReport', 'Service report'],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(([key, label]) => (
        <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 7, fontWeight: 750, color: 'var(--text)' }}>
          <input type="checkbox" checked={rules[key]} onChange={(event) => onChange({ ...rules, [key]: event.target.checked })} />
          {label}
        </label>
      ))}
    </div>
  );
}

export function PropertyContactDraftEditor({
  clientId,
  contacts,
  links,
  onChange,
}: {
  clientId: string;
  contacts: BookingContact[];
  links: NewBookingContactLink[];
  onChange: (next: NewBookingContactLink[]) => void;
}) {
  const available = customerContacts(contacts, clientId).filter((contact) => !links.some((link) => link.contactId === contact.id));
  const [existingId, setExistingId] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('Papiamento');
  const [role, setRole] = useState('Manager');
  const [scope, setScope] = useState<'property' | 'all_properties'>('property');
  const [rules, setRules] = useState<ContactCommunicationRules>(defaultContactCommunicationRules);

  const addExisting = () => {
    if (!existingId) return;
    onChange([...links, { contactId: existingId, role, scope, ...rules }]);
    setExistingId('');
  };

  const addNew = () => {
    if (!name.trim() || (!phone.trim() && !whatsapp.trim() && !email.trim())) return;
    onChange([...links, {
      contact: {
        name: name.trim(),
        phone: phone.trim(),
        whatsapp: whatsapp.trim(),
        email: email.trim(),
        preferredLanguage: language,
      },
      role,
      scope,
      ...rules,
    }]);
    setName(''); setPhone(''); setWhatsapp(''); setEmail(''); setLanguage('Papiamento'); setCreating(false);
  };

  return (
    <div style={{ gridColumn: '1 / -1', borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 12, display: 'grid', gap: 10 }}>
      <div><strong style={{ display: 'block', fontSize: 7.4 }}>Contacts & communication</strong><span style={{ color: 'var(--muted)', fontSize: 6 }}>Optional. Reuse one contact across properties and define what this relationship should receive.</span></div>
      {links.length ? <div style={{ display: 'grid', gap: 6 }}>{links.map((link, index) => (
        <div key={`${link.contactId || link.contact?.name}-${index}`} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: 8, background: 'var(--surface-2)', display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8 }}>
          <div><strong style={{ display: 'block', fontSize: 6.8 }}>{linkLabel(link, contacts)} · {link.role}</strong><span style={{ display: 'block', color: 'var(--muted)', fontSize: 5.7, marginTop: 3 }}>{link.scope === 'all_properties' ? 'All customer properties' : 'This property'} · {communicationBadges(link).join(' · ') || 'No automatic communications'}</span></div>
          <button type="button" className="btn" onClick={() => onChange(links.filter((_, itemIndex) => itemIndex !== index))}>Remove</button>
        </div>
      ))}</div> : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(120px,.55fr) minmax(130px,.6fr)', gap: 8 }}>
        <label><span>Existing customer contact</span><select value={existingId} onChange={(event) => setExistingId(event.target.value)}><option value="">Select existing…</option>{available.map((contact) => <option key={contact.id} value={contact.id}>{contact.name} · {contactDisplayChannel(contact)}</option>)}</select></label>
        <label><span>Role</span><select value={role} onChange={(event) => setRole(event.target.value)}>{roles.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Applies to</span><select value={scope} onChange={(event) => setScope(event.target.value as 'property' | 'all_properties')}><option value="property">This property</option><option value="all_properties">All customer properties</option></select></label>
      </div>
      <RuleChecks rules={rules} onChange={setRules} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn" disabled={!existingId} onClick={addExisting}>+ Add existing contact</button>
        <button type="button" className="btn" onClick={() => setCreating((current) => !current)}>{creating ? 'Cancel new contact' : '+ Create new contact'}</button>
      </div>

      {creating ? <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface-2)', display: 'grid', gap: 8 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 8 }}>
          <label><span>Contact name *</span><input value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>Preferred language</span><select value={language} onChange={(event) => setLanguage(event.target.value)}>{languages.map((item) => <option key={item}>{item}</option>)}</select></label>
          <label><span>Phone</span><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+297 ..." /></label>
          <label><span>WhatsApp</span><input value={whatsapp} onChange={(event) => setWhatsapp(event.target.value)} placeholder="Same as phone if blank" /></label>
          <label style={{ gridColumn: '1 / -1' }}><span>Email</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label>
        </div>
        <button type="button" className="btn primary" disabled={!name.trim() || (!phone.trim() && !whatsapp.trim() && !email.trim())} onClick={addNew}>Add contact to property</button>
      </div> : null}
    </div>
  );
}

export function PropertyCommunicationPanel({
  client,
  propertyId,
  contacts,
  assignments,
  selections,
  onSelectionsChange,
  onRefresh,
}: {
  client: { id: string; name?: string; company?: string; phone?: string; whatsapp?: string; email?: string };
  propertyId: string;
  contacts: BookingContact[];
  assignments: BookingContactAssignment[];
  selections: AppointmentRecipientSelection[];
  onSelectionsChange: (next: AppointmentRecipientSelection[]) => void;
  onRefresh: () => Promise<void>;
}) {
  const resolved = useMemo(() => resolvedContactsForProperty(contacts, assignments, client.id, propertyId), [assignments, client.id, contacts, propertyId]);
  const allContacts = customerContacts(contacts, client.id);
  const assignedIds = new Set(resolved.map((item) => item.contact.id));
  const unassigned = allContacts.filter((contact) => !assignedIds.has(contact.id));
  const [manage, setManage] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [draftLinks, setDraftLinks] = useState<NewBookingContactLink[]>([]);

  const selectionFor = (recipientType: 'client' | 'contact', sourceId: string, defaults: { confirmation: boolean; reminder: boolean }) => {
    return selections.find((item) => item.recipientType === recipientType && item.sourceId === sourceId)
      ?? { recipientType, sourceId, sendConfirmation: defaults.confirmation, sendReminder: defaults.reminder };
  };
  const hasContactNotice = resolved.some((item) => item.assignment.appointmentConfirmation || item.assignment.appointmentReminder);
  const primary = selectionFor('client', client.id, { confirmation: !hasContactNotice, reminder: !hasContactNotice });

  const updateSelection = (next: AppointmentRecipientSelection) => {
    onSelectionsChange([...selections.filter((item) => !(item.recipientType === next.recipientType && item.sourceId === next.sourceId)), next]);
  };

  const saveDraftLinks = async () => {
    if (!draftLinks.length || saving) return;
    setSaving(true); setMessage('');
    try {
      for (const link of draftLinks) {
        await saveOfficeContactAssignment({
          requestId: createOfficeLifecycleRequestId('schedule-contact'),
          customerId: client.id,
          propertyId,
          link,
        });
      }
      setDraftLinks([]);
      await onRefresh();
      setMessage('Contact relationships saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The contact relationship could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const removeAssignment = async (assignment: BookingContactAssignment) => {
    if (assignment.scope === 'all_properties' || saving) return;
    setSaving(true); setMessage('');
    try {
      await deactivateOfficeContactAssignment({
        requestId: createOfficeLifecycleRequestId('schedule-contact-remove'),
        customerId: client.id,
        propertyId,
        assignmentId: assignment.id,
      });
      await onRefresh();
      setMessage('Property relationship removed. The contact remains in customer master data.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The contact relationship could not be removed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface)', display: 'grid', gap: 8, marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}><div><strong style={{ display: 'block', fontSize: 7.2 }}>Communication contacts</strong><span style={{ color: 'var(--muted)', fontSize: 5.8 }}>Defaults come from this property relationship. Appointment recipients can be adjusted here without changing master data.</span></div><button type="button" className="btn" onClick={() => setManage((current) => !current)}>{manage ? 'Done' : 'Manage contacts'}</button></div>

      <RecipientRow name={text(client.name) || text(client.company) || 'Customer'} role="Customer / owner fallback" channel={text(client.whatsapp) || text(client.phone) || text(client.email)} selection={primary} onChange={updateSelection} />
      {resolved.map(({ contact, assignment }) => {
        const selection = selectionFor('contact', contact.id, { confirmation: assignment.appointmentConfirmation, reminder: assignment.appointmentReminder });
        return <div key={assignment.id} style={{ display: 'grid', gap: 4 }}><RecipientRow name={contact.name} role={`${assignment.role}${assignment.scope === 'all_properties' ? ' · all properties' : ''}`} channel={contactDisplayChannel(contact)} badges={communicationBadges(assignment)} selection={selection} onChange={updateSelection} />{manage && assignment.scope === 'property' ? <button type="button" className="btn" disabled={saving} style={{ justifySelf: 'end' }} onClick={() => void removeAssignment(assignment)}>Remove from this property</button> : null}</div>;
      })}
      {!resolved.length ? <span style={{ color: 'var(--muted)', fontSize: 6 }}>No canonical property contacts yet. The customer remains the communication fallback.</span> : null}

      {manage ? <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, display: 'grid', gap: 8 }}>
        {unassigned.length ? <div style={{ color: 'var(--muted)', fontSize: 6 }}>Existing customer contacts can be linked here instead of creating duplicates.</div> : null}
        <PropertyContactDraftEditor clientId={client.id} contacts={contacts} links={draftLinks} onChange={setDraftLinks} />
        <button type="button" className="btn primary" disabled={!draftLinks.length || saving} onClick={() => void saveDraftLinks()}>{saving ? 'Saving…' : 'Save contact relationships'}</button>
      </div> : null}
      {message ? <div style={{ fontSize: 6.2, color: message.includes('could not') ? 'var(--danger)' : 'var(--brand)' }}>{message}</div> : null}
    </div>
  );
}

function RecipientRow({
  name,
  role,
  channel,
  badges = [],
  selection,
  onChange,
}: {
  name: string;
  role: string;
  channel: string;
  badges?: string[];
  selection: AppointmentRecipientSelection;
  onChange: (next: AppointmentRecipientSelection) => void;
}) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 10, alignItems: 'center', padding: '8px 9px', border: '1px solid var(--border)', borderRadius: 9, background: 'var(--surface-2)' }}>
    <div><strong style={{ display: 'block', fontSize: 6.8 }}>{name}</strong><span style={{ display: 'block', color: 'var(--muted)', fontSize: 5.6, marginTop: 2 }}>{role}{channel ? ` · ${channel}` : ''}</span>{badges.length ? <span style={{ display: 'block', color: 'var(--brand)', fontSize: 5.4, marginTop: 3 }}>{badges.join(' · ')}</span> : null}</div>
    <div style={{ display: 'flex', gap: 8 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 5.8 }}><input type="checkbox" checked={selection.sendConfirmation} onChange={(event) => onChange({ ...selection, sendConfirmation: event.target.checked })} />Confirmation</label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 5.8 }}><input type="checkbox" checked={selection.sendReminder} onChange={(event) => onChange({ ...selection, sendReminder: event.target.checked })} />Reminder</label>
    </div>
  </div>;
}
