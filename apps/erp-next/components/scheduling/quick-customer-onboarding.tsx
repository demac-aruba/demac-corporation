'use client';

import { useMemo, useState } from 'react';
import type { BrowserCrmContactIdentity, BrowserCrmCustomerIdentity, BrowserCrmSiteIdentity, BrowserCustomerMasterSnapshot } from '../../lib/browser-crm';
import styles from './quick-customer-onboarding.module.css';

type PropertyDraft = {
  key: string;
  name: string;
  address: string;
  sector: string;
  gac: string;
  access: string;
};

type ContactDraft = {
  key: string;
  name: string;
  role: string;
  phone: string;
  email: string;
};

export type QuickCustomerCreateResult = {
  customer: BrowserCrmCustomerIdentity;
  master: BrowserCustomerMasterSnapshot;
  primarySiteId: string;
};

type Props = {
  open: boolean;
  existingCustomers: BrowserCrmCustomerIdentity[];
  onClose: () => void;
  onCreate: (result: QuickCustomerCreateResult) => void;
  onUseExisting: (customerId: string) => void;
};

const sectors = ['Noord', 'Palm Beach', 'Oranjestad', 'Santa Cruz', 'Paradera', 'San Nicolas', 'Savaneta'];

function propertyDraft(index: number): PropertyDraft {
  return { key: `property-${Date.now()}-${index}`, name: index === 0 ? 'Primary Property' : `Property ${index + 1}`, address: '', sector: 'Noord', gac: '', access: '' };
}

function contactDraft(index: number): ContactDraft {
  return { key: `contact-${Date.now()}-${index}`, name: '', role: '', phone: '', email: '' };
}

function normalize(value?: string) {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'CU';
}

export function QuickCustomerOnboarding({ open, existingCustomers, onClose, onCreate, onUseExisting }: Props) {
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [type, setType] = useState<'Residential' | 'Commercial' | 'Enterprise'>('Residential');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<'Papiamento' | 'English' | 'Spanish' | 'Dutch'>('Papiamento');
  const [properties, setProperties] = useState<PropertyDraft[]>([propertyDraft(0)]);
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const duplicates = useMemo(() => {
    const nameKey = normalize(name);
    const phoneKey = normalize(phone);
    const emailKey = normalize(email);
    if (!nameKey && !phoneKey && !emailKey) return [];
    return existingCustomers.filter((customer) => (
      (nameKey && normalize(customer.name) === nameKey)
      || (phoneKey && normalize(customer.phone) === phoneKey)
      || (emailKey && normalize(customer.email) === emailKey)
    ));
  }, [email, existingCustomers, name, phone]);

  if (!open) return null;

  const updateProperty = (key: string, field: keyof Omit<PropertyDraft, 'key'>, value: string) => {
    setProperties((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  };
  const updateContact = (key: string, field: keyof Omit<ContactDraft, 'key'>, value: string) => {
    setContacts((current) => current.map((item) => item.key === key ? { ...item, [field]: value } : item));
  };

  const create = () => {
    const primary = properties[0];
    if (!name.trim() || !phone.trim()) {
      setNotice('Customer name and phone / WhatsApp are required.');
      return;
    }
    if (!primary?.address.trim()) {
      setNotice('The primary service property needs an address.');
      return;
    }
    if (duplicates.length) {
      setNotice('A possible duplicate exists. Review it before creating another customer.');
      return;
    }

    const stamp = Date.now().toString();
    const customerId = `C-${stamp.slice(-6)}`;
    const sites: BrowserCrmSiteIdentity[] = properties.map((property, index) => ({
      id: `ST-${stamp.slice(-6)}-${index + 1}`,
      name: property.name.trim() || (index === 0 ? 'Primary Property' : `Property ${index + 1}`),
      address: property.address.trim(),
      sector: property.sector,
      gac: property.gac.trim() || 'Pending mapping',
      access: property.access.trim() || 'No special access notes',
    }));
    const savedContacts: BrowserCrmContactIdentity[] = contacts
      .filter((contact) => contact.name.trim() || contact.phone.trim() || contact.email.trim())
      .map((contact, index) => ({
        id: `CT-${stamp.slice(-6)}-${index + 1}`,
        name: contact.name.trim() || 'Additional Contact',
        role: contact.role.trim() || 'Contact',
        phone: contact.phone.trim() || '—',
        email: contact.email.trim() || '—',
        primary: false,
      }));

    const customer: BrowserCrmCustomerIdentity = {
      id: customerId,
      name: name.trim(),
      legalName: legalName.trim() || undefined,
      type,
      location: primary.sector,
      phone: phone.trim(),
      email: email.trim(),
      preferredLanguage,
      initials: initials(name),
      since: '2026',
      health: 80,
      lifetimeRevenue: 'Afl. 0',
      outstanding: 'Afl. 0',
      openJobs: 0,
      openProposals: 0,
      assets: 0,
      sites: sites.length,
      maintenance: 'None',
      nextAction: 'Complete HVAC equipment registration after first service visit',
    };

    onCreate({ customer, master: { contacts: savedContacts, sites, assets: [] }, primarySiteId: sites[0].id });
  };

  return <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label="Add customer from Scheduling">
      <header className={styles.header}>
        <div><span>CRM · Quick onboarding</span><h2>Add Customer</h2><p>Create the customer relationship once, then register every service property and additional contact underneath it.</p></div>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className={styles.body}>
        {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

        <section className={styles.section}>
          <header><div><span>1</span><div><strong>Customer information</strong><small>Identity and primary communication only.</small></div></div></header>
          <div className={styles.grid}>
            <label className={styles.wide}><span>Customer / display name *</span><input autoFocus value={name} onChange={(event) => { setName(event.target.value); setNotice(null); }} placeholder="Person or company name" /></label>
            <label><span>Customer type</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option>Residential</option><option>Commercial</option><option>Enterprise</option></select></label>
            <label><span>Legal / registered name</span><input value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Optional" /></label>
            <label><span>Phone / WhatsApp *</span><input value={phone} onChange={(event) => { setPhone(event.target.value); setNotice(null); }} placeholder="+297 ..." /></label>
            <label><span>Email</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setNotice(null); }} placeholder="name@example.com" /></label>
            <label><span>Preferred language</span><select value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value as typeof preferredLanguage)}><option>Papiamento</option><option>English</option><option>Spanish</option><option>Dutch</option></select></label>
          </div>
          {duplicates.length ? <div className={styles.duplicate}><div><strong>Possible duplicate detected</strong><p>Use the existing CRM relationship instead of creating a second customer.</p></div>{duplicates.slice(0, 3).map((customer) => <button type="button" key={customer.id} onClick={() => onUseExisting(customer.id)}><strong>{customer.name}</strong><span>{customer.phone || customer.email || customer.id}</span></button>)}</div> : null}
        </section>

        <section className={styles.section}>
          <header><div><span>2</span><div><strong>Service properties</strong><small>The appointment must point to a real property/site.</small></div></div><button type="button" onClick={() => setProperties((current) => [...current, propertyDraft(current.length)])}>+ Add another property</button></header>
          <div className={styles.stack}>{properties.map((property, index) => <article className={styles.subcard} key={property.key}>
            <div className={styles.subhead}><div><strong>{index === 0 ? 'Primary service property' : `Additional property ${index}`}</strong><span>{index === 0 ? 'Used automatically for this appointment after creation.' : 'Available for this customer in future bookings.'}</span></div>{index > 0 ? <button type="button" onClick={() => setProperties((current) => current.filter((item) => item.key !== property.key))}>Remove</button> : null}</div>
            <div className={styles.grid}><label><span>Property name</span><input value={property.name} onChange={(event) => updateProperty(property.key, 'name', event.target.value)} placeholder="Home, Office, Rental Villa..." /></label><label><span>DEMAC sector</span><select value={property.sector} onChange={(event) => updateProperty(property.key, 'sector', event.target.value)}>{sectors.map((sector) => <option key={sector}>{sector}</option>)}</select></label><label className={styles.wide}><span>Service address *</span><input value={property.address} onChange={(event) => { updateProperty(property.key, 'address', event.target.value); setNotice(null); }} placeholder="Street / house / building information" /></label><label><span>GAC / address code</span><input value={property.gac} onChange={(event) => updateProperty(property.key, 'gac', event.target.value)} placeholder="Optional / pending mapping" /></label><label><span>Access notes</span><input value={property.access} onChange={(event) => updateProperty(property.key, 'access', event.target.value)} placeholder="Gate, contact on arrival, parking..." /></label></div>
          </article>)}</div>
        </section>

        <section className={styles.section}>
          <header><div><span>3</span><div><strong>Additional contacts</strong><small>Optional people associated with this customer relationship.</small></div></div><button type="button" onClick={() => setContacts((current) => [...current, contactDraft(current.length)])}>+ Add contact</button></header>
          {contacts.length ? <div className={styles.stack}>{contacts.map((contact, index) => <article className={styles.subcard} key={contact.key}><div className={styles.subhead}><div><strong>Contact {index + 1}</strong><span>Decision maker, tenant, manager, family member, maintenance contact, etc.</span></div><button type="button" onClick={() => setContacts((current) => current.filter((item) => item.key !== contact.key))}>Remove</button></div><div className={styles.grid}><label><span>Full name</span><input value={contact.name} onChange={(event) => updateContact(contact.key, 'name', event.target.value)} /></label><label><span>Role / relationship</span><input value={contact.role} onChange={(event) => updateContact(contact.key, 'role', event.target.value)} placeholder="Manager, tenant, spouse..." /></label><label><span>Phone</span><input value={contact.phone} onChange={(event) => updateContact(contact.key, 'phone', event.target.value)} /></label><label><span>Email</span><input value={contact.email} onChange={(event) => updateContact(contact.key, 'email', event.target.value)} /></label></div></article>)}</div> : <div className={styles.empty}>No additional contacts. The customer's primary phone/email remain on the Customer record.</div>}
        </section>

        <section className={styles.rule}><span>DATA MODEL RULE</span><strong>One customer can own many properties, contacts and HVAC assets.</strong><p>Scheduling reuses these records. It never creates a second customer just because the same person requests service at another address.</p></section>
      </div>

      <footer className={styles.footer}><button type="button" onClick={onClose}>Cancel</button><button type="button" className={styles.primary} onClick={create}>Create Customer & Use Property</button></footer>
    </aside>
  </div>;
}
