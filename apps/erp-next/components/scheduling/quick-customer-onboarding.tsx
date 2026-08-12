'use client';

import { useMemo, useState } from 'react';
import {
  addressConfidence,
  formatArubaServiceAddress,
  navigationUrlForAddress,
  parseArubaAddressParts,
  parseLocationInput,
  resolveArubaAddressSuggestion,
  resolveArubaHouseNumberGps,
  suggestArubaServiceAddresses,
} from '../../lib/booking-intelligence/address';
import { resolveCustomerIdentity } from '../../lib/booking-intelligence/identity';
import type { BrowserCrmContactIdentity, BrowserCrmCustomerIdentity, BrowserCrmSiteIdentity, BrowserCustomerMasterSnapshot } from '../../lib/browser-crm';
import styles from './quick-customer-onboarding.module.css';

type PropertyDraft = {
  key: string;
  name: string;
  address: string;
  canonicalStreet: string;
  houseNumber: string;
  unit: string;
  addressSource: 'DEMAC' | 'OpenStreetMap' | 'manual' | 'unknown';
  addressSelected: boolean;
  sector: string;
  sectorResolution: 'address' | 'manual' | 'unresolved';
  manualSectorOpen: boolean;
  gac: string;
  access: string;
  locationInput: string;
  locationSource: 'none' | 'address' | 'manual';
  confidence: 'verified' | 'suggested' | 'unresolved';
};

type ContactDraft = {
  key: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  preferredLanguage: 'Papiamento' | 'English' | 'Spanish' | 'Dutch';
  confirmation: boolean;
  reminder: boolean;
  arrival: boolean;
  billing: boolean;
};

export type QuickCustomerCreateResult = {
  customer: BrowserCrmCustomerIdentity;
  master: BrowserCustomerMasterSnapshot;
  primarySiteId: string;
};

export type QuickExistingPropertyResult = {
  customerId: string;
  site: BrowserCrmSiteIdentity;
};

type Props = {
  open: boolean;
  existingCustomers: BrowserCrmCustomerIdentity[];
  onClose: () => void;
  onCreate: (result: QuickCustomerCreateResult) => void;
  onUseExisting: (customerId: string) => void;
  onUseExistingWithProperty?: (result: QuickExistingPropertyResult) => void;
};

const sectors = ['Noord', 'Palm Beach', 'Oranjestad', 'Santa Cruz', 'Paradera', 'San Nicolas', 'Savaneta'];
const languages = ['Papiamento', 'English', 'Spanish', 'Dutch'] as const;

function propertyDraft(index: number): PropertyDraft {
  return {
    key: `property-${Date.now()}-${index}`,
    name: index === 0 ? 'Primary Property' : `Property ${index + 1}`,
    address: '',
    canonicalStreet: '',
    houseNumber: '',
    unit: '',
    addressSource: 'unknown',
    addressSelected: false,
    sector: '',
    sectorResolution: 'unresolved',
    manualSectorOpen: false,
    gac: '',
    access: '',
    locationInput: '',
    locationSource: 'none',
    confidence: 'unresolved',
  };
}

function contactDraft(index: number): ContactDraft {
  return {
    key: `contact-${Date.now()}-${index}`,
    name: '',
    role: '',
    phone: '',
    email: '',
    preferredLanguage: 'Papiamento',
    confirmation: false,
    reminder: false,
    arrival: false,
    billing: false,
  };
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'CU';
}

function fullPropertyAddress(property: PropertyDraft) {
  return formatArubaServiceAddress({
    street: property.canonicalStreet.trim() || parseArubaAddressParts(property.address).street || property.address.trim(),
    houseNumber: property.houseNumber.trim() || undefined,
    unit: property.unit.trim() || undefined,
  });
}

function siteFromDraft(property: PropertyDraft, index: number, stamp: string): BrowserCrmSiteIdentity {
  const location = parseLocationInput(property.locationInput);
  return {
    id: `ST-${stamp.slice(-6)}-${index + 1}`,
    name: property.name.trim() || (index === 0 ? 'Primary Property' : `Property ${index + 1}`),
    address: fullPropertyAddress(property),
    addressCanonicalStreet: property.canonicalStreet.trim() || undefined,
    addressHouseNumber: property.houseNumber.trim() || undefined,
    addressUnit: property.unit.trim() || undefined,
    addressSource: property.addressSource,
    sector: property.sector || undefined,
    sectorResolution: property.sectorResolution,
    gac: property.gac.trim() || 'Pending mapping',
    access: property.access.trim() || 'No special access notes',
    latitude: location?.latitude,
    longitude: location?.longitude,
    locationUrl: location?.originalUrl,
    addressConfidence: property.confidence,
  };
}

export function QuickCustomerOnboarding({ open, existingCustomers, onClose, onCreate, onUseExisting, onUseExistingWithProperty }: Props) {
  const [name, setName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [type, setType] = useState<'Residential' | 'Commercial' | 'Enterprise'>('Residential');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [preferredLanguage, setPreferredLanguage] = useState<'Papiamento' | 'English' | 'Spanish' | 'Dutch'>('Papiamento');
  const [properties, setProperties] = useState<PropertyDraft[]>([propertyDraft(0)]);
  const [contacts, setContacts] = useState<ContactDraft[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicateReviewed, setDuplicateReviewed] = useState(false);

  const identityMatches = useMemo(() => resolveCustomerIdentity(
    { name, phone, email },
    existingCustomers.map((customer) => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      status: customer.status,
      phoneShared: customer.phoneShared,
      previousPhones: customer.previousPhones,
    })),
  ), [email, existingCustomers, name, phone]);
  const matches = identityMatches.map((match) => ({ match, customer: existingCustomers.find((customer) => customer.id === match.customerId) })).filter((item) => item.customer);
  const blockingIdentityMatch = identityMatches.some((match) => match.strength === 'high' || match.strength === 'medium');

  if (!open) return null;

  const updateProperty = (key: string, patch: Partial<Omit<PropertyDraft, 'key'>>) => {
    setProperties((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  };
  const updateContact = (key: string, patch: Partial<Omit<ContactDraft, 'key'>>) => {
    setContacts((current) => current.map((item) => item.key === key ? { ...item, ...patch } : item));
  };

  const useExistingWithProperty = (customerId: string) => {
    const primary = properties[0];
    if (!primary?.address.trim() || !onUseExistingWithProperty) {
      onUseExisting(customerId);
      return;
    }
    if (!primary.sector) {
      setNotice('Confirm the DEMAC sector for this property before adding it to an existing customer.');
      return;
    }
    onUseExistingWithProperty({ customerId, site: siteFromDraft(primary, 0, Date.now().toString()) });
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
    if (!primary.sector) {
      setNotice('The primary property needs a resolved or manually confirmed DEMAC sector before booking.');
      return;
    }
    if (blockingIdentityMatch && !duplicateReviewed) {
      setNotice('Booking Intelligence found an existing identity. Reuse it, add this property to it, or explicitly confirm that this is a different customer.');
      return;
    }

    const stamp = Date.now().toString();
    const customerId = `C-${stamp.slice(-6)}`;
    const sites = properties.map((property, index) => siteFromDraft(property, index, stamp));
    const savedContacts: BrowserCrmContactIdentity[] = contacts
      .filter((contact) => contact.name.trim() || contact.phone.trim() || contact.email.trim())
      .map((contact, index) => ({
        id: `CT-${stamp.slice(-6)}-${index + 1}`,
        name: contact.name.trim() || 'Additional Contact',
        role: contact.role.trim() || 'Contact',
        phone: contact.phone.trim() || '—',
        email: contact.email.trim() || '—',
        primary: false,
        preferredLanguage: contact.preferredLanguage,
        sendConfirmationDefault: contact.confirmation,
        sendReminderDefault: contact.reminder,
        arrivalContact: contact.arrival,
        billingContact: contact.billing,
      }));

    const customer: BrowserCrmCustomerIdentity = {
      id: customerId,
      name: name.trim(),
      legalName: legalName.trim() || undefined,
      type,
      status: 'active',
      location: primary.sector,
      phone: phone.trim(),
      email: email.trim(),
      preferredLanguage,
      initials: initials(name),
      since: String(new Date().getFullYear()),
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
        <div><span>CRM · Booking Intelligence</span><h2>Add Customer or Property</h2><p>Resolve the person/company first, then keep every service property and communication contact under the same CRM relationship.</p></div>
        <button type="button" onClick={onClose} aria-label="Close">×</button>
      </header>

      <div className={styles.body}>
        {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

        <section className={styles.section}>
          <header><div><span>1</span><div><strong>Customer identity</strong><small>Phone, email and name evidence are evaluated independently.</small></div></div></header>
          <div className={styles.grid}>
            <label className={styles.wide}><span>Customer / display name *</span><input autoFocus value={name} onChange={(event) => { setName(event.target.value); setNotice(null); setDuplicateReviewed(false); }} placeholder="Person or company name" /></label>
            <label><span>Customer type</span><select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option>Residential</option><option>Commercial</option><option>Enterprise</option></select></label>
            <label><span>Legal / registered name</span><input value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Optional" /></label>
            <label><span>Phone / WhatsApp *</span><input value={phone} onChange={(event) => { setPhone(event.target.value); setNotice(null); setDuplicateReviewed(false); }} placeholder="+297 ..." /></label>
            <label><span>Email</span><input type="email" value={email} onChange={(event) => { setEmail(event.target.value); setNotice(null); setDuplicateReviewed(false); }} placeholder="name@example.com" /></label>
            <label><span>Preferred language</span><select value={preferredLanguage} onChange={(event) => setPreferredLanguage(event.target.value as typeof preferredLanguage)}>{languages.map((language) => <option key={language}>{language}</option>)}</select></label>
          </div>
          {matches.length ? <div className={styles.duplicate}>
            <div><strong>Existing CRM identity detected</strong><p>High-confidence identity evidence should be reused. Similar-name evidence requires review instead of silently creating a duplicate.</p></div>
            {matches.slice(0, 3).map(({ customer, match }) => customer ? <div key={customer.id} style={{ display: 'grid', gap: 6, padding: 8, border: '1px solid var(--border)', borderRadius: 8 }}>
              <div><strong>{customer.name}</strong><span style={{ display: 'block' }}>{customer.phone || customer.email || customer.id} · {match.strength.toUpperCase()} {match.score}</span><small>{match.reasons.join(' · ')}</small></div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><button type="button" onClick={() => onUseExisting(customer.id)}>Use Existing</button>{properties[0]?.address.trim() && onUseExistingWithProperty ? <button type="button" onClick={() => useExistingWithProperty(customer.id)}>Use Existing + Add This Property</button> : null}</div>
            </div> : null)}
            {blockingIdentityMatch ? <button type="button" onClick={() => { setDuplicateReviewed(true); setNotice('Duplicate warning reviewed. A new customer can now be created if this is genuinely a different person/company.'); }}>This is a different customer · allow new record</button> : null}
          </div> : null}
        </section>

        <section className={styles.section}>
          <header><div><span>2</span><div><strong>Service properties</strong><small>Address Intelligence validates the street, derives the DEMAC sector, and keeps house/unit details separate.</small></div></div><button type="button" onClick={() => setProperties((current) => [...current, propertyDraft(current.length)])}>+ Add another property</button></header>
          <div className={styles.stack}>{properties.map((property, index) => {
            const suggestions = property.addressSelected ? [] : suggestArubaServiceAddresses(property.address, 4);
            const parsedLocation = parseLocationInput(property.locationInput);
            const displayAddress = fullPropertyAddress(property);
            const navigationUrl = navigationUrlForAddress(displayAddress, parsedLocation);
            return <article className={styles.subcard} key={property.key}>
              <div className={styles.subhead}><div><strong>{index === 0 ? 'Primary service property' : `Additional property ${index}`}</strong><span>{index === 0 ? 'Used automatically for this appointment after creation.' : 'Available for this customer in future bookings.'}</span></div>{index > 0 ? <button type="button" onClick={() => setProperties((current) => current.filter((item) => item.key !== property.key))}>Remove</button> : null}</div>
              <div className={styles.grid}>
                <label><span>Property name</span><input value={property.name} onChange={(event) => updateProperty(property.key, { name: event.target.value })} placeholder="Home, Office, Rental Villa..." /></label>
                <label><span>DEMAC sector · {property.sectorResolution === 'address' ? 'derived from address' : property.sectorResolution === 'manual' ? 'manually confirmed' : 'pending address'}</span>
                  {property.sectorResolution === 'address' && property.sector ? <input readOnly value={property.sector} aria-label="DEMAC sector derived from selected address" /> : property.manualSectorOpen ? <select value={property.sector} onChange={(event) => updateProperty(property.key, { sector: event.target.value, sectorResolution: event.target.value ? 'manual' : 'unresolved' })}><option value="">Select DEMAC sector</option>{sectors.map((sector) => <option key={sector}>{sector}</option>)}</select> : <div style={{ display: 'grid', gap: 6 }}><input readOnly value="" placeholder={property.addressSelected ? 'Sector could not be resolved' : 'Pending address selection'} />{property.addressSelected ? <button type="button" onClick={() => updateProperty(property.key, { manualSectorOpen: true })}>Confirm sector manually</button> : null}</div>}
                </label>
                <label className={styles.wide}><span>Street / neighborhood * · {property.addressSelected ? '✓ address selected' : property.confidence}</span><input value={property.address} onChange={(event) => {
                  const value = event.target.value;
                  const parts = parseArubaAddressParts(value);
                  updateProperty(property.key, {
                    address: value,
                    canonicalStreet: '',
                    houseNumber: parts.houseNumber ?? property.houseNumber,
                    unit: parts.unit ?? property.unit,
                    addressSource: 'unknown',
                    addressSelected: false,
                    sector: '',
                    sectorResolution: 'unresolved',
                    manualSectorOpen: false,
                    confidence: addressConfidence(value),
                  });
                  setNotice(null);
                }} placeholder="Start typing an Aruba street / neighborhood..." /></label>
                {suggestions.length ? <div className={styles.wide} style={{ display: 'grid', gap: 5 }}>{suggestions.map((suggestion) => <button type="button" key={`${property.key}-${suggestion.canonical}`} style={{ textAlign: 'left', padding: '8px 10px' }} onClick={() => {
                  const resolved = resolveArubaAddressSuggestion(property.address, suggestion);
                  const keepManualLocation = property.locationSource === 'manual';
                  const resolvedLocation = resolved.latitude != null && resolved.longitude != null ? `${resolved.latitude},${resolved.longitude}` : '';
                  updateProperty(property.key, {
                    address: resolved.street,
                    canonicalStreet: resolved.street,
                    houseNumber: resolved.houseNumber ?? property.houseNumber,
                    unit: resolved.unit ?? property.unit,
                    addressSource: resolved.source,
                    addressSelected: true,
                    sector: resolved.sector,
                    sectorResolution: resolved.sector ? 'address' : 'unresolved',
                    manualSectorOpen: false,
                    confidence: resolved.confidence,
                    locationInput: keepManualLocation ? property.locationInput : resolvedLocation,
                    locationSource: keepManualLocation ? 'manual' : resolvedLocation ? 'address' : 'none',
                  });
                  setNotice(resolved.sector ? null : 'Address selected, but this street does not yet have a reliable DEMAC sector. Confirm the sector once for this property.');
                }}><strong>{suggestion.canonical}</strong><span style={{ display: 'block' }}>{suggestion.neighborhood || suggestion.operationalZone || 'Aruba'} · {suggestion.demacSector || 'Sector needs confirmation'} · {suggestion.source}</span></button>)}</div> : null}
                {property.addressSelected ? <>
                  <label><span>House / building no.</span><input value={property.houseNumber} onChange={(event) => {
                    const houseNumber = event.target.value;
                    const point = resolveArubaHouseNumberGps(property.canonicalStreet, houseNumber);
                    const canReplaceAddressGps = property.locationSource !== 'manual';
                    updateProperty(property.key, {
                      houseNumber,
                      ...(canReplaceAddressGps ? {
                        locationInput: point?.latitude != null && point?.longitude != null ? `${point.latitude},${point.longitude}` : '',
                        locationSource: point ? 'address' : 'none',
                      } : {}),
                    });
                  }} placeholder="23, 23A, 23-B..." /></label>
                  <label><span>Unit / apartment</span><input value={property.unit} onChange={(event) => updateProperty(property.key, { unit: event.target.value })} placeholder="Apt 2, Unit B, Floor 2..." /></label>
                </> : null}
                {property.addressSelected ? <div className={styles.wide} style={{ padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-soft, transparent)', fontSize: 11 }}><strong>✓ Address selected</strong><span style={{ display: 'block', marginTop: 2 }}>{displayAddress} · {property.addressSource}{property.sector ? ` · ${property.sector}` : ' · sector needs confirmation'}</span></div> : null}
                <label><span>GAC / address code</span><input value={property.gac} onChange={(event) => updateProperty(property.key, { gac: event.target.value })} placeholder="Optional / pending mapping" /></label>
                <label><span>Map link / coordinates</span><input value={property.locationInput} onChange={(event) => updateProperty(property.key, { locationInput: event.target.value, locationSource: event.target.value.trim() ? 'manual' : 'none' })} placeholder="Paste Maps / MAPS.ME URL or coordinates" /></label>
                {property.locationInput ? <div className={styles.wide} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8 }}><span>{parsedLocation?.latitude != null && parsedLocation?.longitude != null ? `✓ GPS captured · ${parsedLocation.latitude.toFixed(6)}, ${parsedLocation.longitude.toFixed(6)}` : 'Map link saved · coordinates not embedded in this link'}</span>{navigationUrl ? <a href={navigationUrl} target="_blank" rel="noreferrer">Open map</a> : null}</div> : null}
                <label className={styles.wide}><span>Access notes / reference</span><input value={property.access} onChange={(event) => updateProperty(property.key, { access: event.target.value })} placeholder="Blue gate, rear house, rooftop access, parking, keys, arrival contact..." /></label>
              </div>
            </article>;
          })}</div>
        </section>

        <section className={styles.section}>
          <header><div><span>3</span><div><strong>Property / relationship contacts</strong><small>Choose who normally receives confirmations, reminders, arrival calls and billing communication.</small></div></div><button type="button" onClick={() => setContacts((current) => [...current, contactDraft(current.length)])}>+ Add contact</button></header>
          {contacts.length ? <div className={styles.stack}>{contacts.map((contact, index) => <article className={styles.subcard} key={contact.key}>
            <div className={styles.subhead}><div><strong>Contact {index + 1}</strong><span>Owner, manager, tenant, access contact, family member, accounting, etc.</span></div><button type="button" onClick={() => setContacts((current) => current.filter((item) => item.key !== contact.key))}>Remove</button></div>
            <div className={styles.grid}>
              <label><span>Full name</span><input value={contact.name} onChange={(event) => updateContact(contact.key, { name: event.target.value })} /></label>
              <label><span>Role / relationship</span><input value={contact.role} onChange={(event) => updateContact(contact.key, { role: event.target.value })} placeholder="Manager, tenant, spouse..." /></label>
              <label><span>Phone</span><input value={contact.phone} onChange={(event) => updateContact(contact.key, { phone: event.target.value })} /></label>
              <label><span>Email</span><input value={contact.email} onChange={(event) => updateContact(contact.key, { email: event.target.value })} /></label>
              <label><span>Preferred language</span><select value={contact.preferredLanguage} onChange={(event) => updateContact(contact.key, { preferredLanguage: event.target.value as ContactDraft['preferredLanguage'] })}>{languages.map((language) => <option key={language}>{language}</option>)}</select></label>
              <div style={{ display: 'grid', gap: 5, alignContent: 'end' }}><label><input type="checkbox" checked={contact.confirmation} onChange={(event) => updateContact(contact.key, { confirmation: event.target.checked })} /> Confirmation</label><label><input type="checkbox" checked={contact.reminder} onChange={(event) => updateContact(contact.key, { reminder: event.target.checked })} /> Reminder</label><label><input type="checkbox" checked={contact.arrival} onChange={(event) => updateContact(contact.key, { arrival: event.target.checked })} /> Arrival contact</label><label><input type="checkbox" checked={contact.billing} onChange={(event) => updateContact(contact.key, { billing: event.target.checked })} /> Billing</label></div>
            </div>
          </article>)}</div> : <div className={styles.empty}>No additional contacts. The customer's primary phone/email remain the fallback communication recipient.</div>}
        </section>

        <section className={styles.rule}><span>BOOKING INTELLIGENCE RULE</span><strong>Identity first. Property second. Appointment third.</strong><p>A known customer can add a new property without creating a duplicate CRM record, and every property keeps its verified street, separate house/unit details, route sector, GPS/access information and communication context.</p></section>
      </div>

      <footer className={styles.footer}><button type="button" onClick={onClose}>Cancel</button><button type="button" className={styles.primary} onClick={create}>Create Customer & Use Property</button></footer>
    </aside>
  </div>;
}
