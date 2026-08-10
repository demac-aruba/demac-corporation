'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AssetDetailDrawer, SiteDetailDrawer, type AssetDetail, type SiteDetail } from './relationship-detail';
import styles from './customer-master-data.module.css';

export type CustomerEditorValue = {
  id?: string;
  name: string;
  legalName?: string;
  type: 'Residential' | 'Commercial' | 'Enterprise';
  phone: string;
  email: string;
  location: string;
  preferredLanguage: 'Papiamento' | 'English' | 'Spanish' | 'Dutch';
};

export type ExistingCustomerIdentity = Pick<CustomerEditorValue, 'id' | 'name' | 'phone' | 'email'>;

type DrawerProps = {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: CustomerEditorValue;
  existingCustomers: ExistingCustomerIdentity[];
  onClose: () => void;
  onSave: (value: CustomerEditorValue) => void;
};

const emptyCustomer: CustomerEditorValue = {
  name: '',
  legalName: '',
  type: 'Residential',
  phone: '',
  email: '',
  location: '',
  preferredLanguage: 'Papiamento',
};

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function CustomerEditorDrawer({ open, mode, initial, existingCustomers, onClose, onSave }: DrawerProps) {
  const [form, setForm] = useState<CustomerEditorValue>(initial ?? emptyCustomer);

  useEffect(() => {
    if (open) setForm(initial ?? emptyCustomer);
  }, [open, initial]);

  const duplicates = useMemo(() => {
    const phone = normalize(form.phone);
    const email = normalize(form.email);
    const name = normalize(form.name);
    if (!phone && !email && !name) return [];
    return existingCustomers.filter((candidate) => {
      if (candidate.id && candidate.id === initial?.id) return false;
      return Boolean(
        (phone && normalize(candidate.phone) === phone)
        || (email && normalize(candidate.email) === email)
        || (name && normalize(candidate.name) === name),
      );
    });
  }, [existingCustomers, form.email, form.name, form.phone, initial?.id]);

  if (!open) return null;

  const update = <K extends keyof CustomerEditorValue>(key: K, value: CustomerEditorValue[K]) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    onSave({ ...form, name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), location: form.location.trim(), legalName: form.legalName?.trim() });
    onClose();
  };

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={mode === 'create' ? 'Create customer' : 'Edit customer'}>
        <header className={styles.drawerHeader}>
          <div>
            <span className={styles.eyebrow}>{mode === 'create' ? 'New relationship' : 'Customer master data'}</span>
            <h2>{mode === 'create' ? 'Create customer' : 'Edit customer'}</h2>
            <p>Keep customer identity simple. Properties, contacts and HVAC equipment are registered separately.</p>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">×</button>
        </header>

        <form className={styles.form} onSubmit={submit}>
          <section className={styles.formSection}>
            <div className={styles.sectionHeading}><strong>Identity</strong><span>Who are we doing business with?</span></div>
            <div className={styles.fieldGrid}>
              <label className={styles.fieldWide}><span>Display name *</span><input autoFocus value={form.name} onChange={(event) => update('name', event.target.value)} placeholder="Customer or company name" /></label>
              <label><span>Customer type</span><select value={form.type} onChange={(event) => update('type', event.target.value as CustomerEditorValue['type'])}><option>Residential</option><option>Commercial</option><option>Enterprise</option></select></label>
              <label><span>Legal name</span><input value={form.legalName ?? ''} onChange={(event) => update('legalName', event.target.value)} placeholder="Optional registered name" /></label>
            </div>
          </section>

          <section className={styles.formSection}>
            <div className={styles.sectionHeading}><strong>Primary communication</strong><span>Only the minimum information needed to identify and contact the customer.</span></div>
            <div className={styles.fieldGrid}>
              <label><span>Phone / WhatsApp *</span><input value={form.phone} onChange={(event) => update('phone', event.target.value)} placeholder="+297 ..." /></label>
              <label><span>Email</span><input type="email" value={form.email} onChange={(event) => update('email', event.target.value)} placeholder="name@example.com" /></label>
              <label><span>Preferred language</span><select value={form.preferredLanguage} onChange={(event) => update('preferredLanguage', event.target.value as CustomerEditorValue['preferredLanguage'])}><option>Papiamento</option><option>English</option><option>Spanish</option><option>Dutch</option></select></label>
              <label><span>General area</span><input value={form.location} onChange={(event) => update('location', event.target.value)} placeholder="Noord, Santa Cruz, Oranjestad..." /></label>
            </div>
          </section>

          {duplicates.length > 0 ? (
            <section className={styles.duplicateAlert}>
              <div className={styles.duplicateIcon}>!</div>
              <div><strong>Possible duplicate detected</strong><p>Before creating another customer, review the existing relationship below.</p>{duplicates.map((item) => <button type="button" key={item.id ?? item.name}>{item.name} · {item.phone || item.email}</button>)}</div>
            </section>
          ) : null}

          <section className={styles.dataRule}>
            <span>DATA RULE</span>
            <p>A customer record does not contain property addresses or equipment details. Those belong to Site/Property and HVAC Asset records so DEMAC can support multiple properties and complete service history correctly.</p>
          </section>

          <footer className={styles.drawerFooter}>
            <button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button>
            <button type="submit" className={styles.primaryButton} disabled={!form.name.trim() || !form.phone.trim()}>{mode === 'create' ? 'Create customer' : 'Save changes'}</button>
          </footer>
        </form>
      </aside>
    </div>
  );
}

type MasterTab = 'Contacts' | 'Properties' | 'Equipment';
type ContactRow = { id: string; name: string; role: string; phone: string; email: string; primary: boolean };
type SiteRow = SiteDetail;
type AssetRow = AssetDetail;

const initialContacts: ContactRow[] = [
  { id: 'CT-1', name: 'Primary Contact', role: 'Decision maker', phone: '+297 560 1000', email: 'contact@example.com', primary: true },
];
const initialSites: SiteRow[] = [
  { id: 'ST-1', name: 'Primary Property', address: 'Aruba', sector: 'Primary operating sector', gac: 'Pending mapping', access: 'No special access notes' },
];
const initialAssets: AssetRow[] = [
  { id: 'AC-1', site: 'Primary Property', type: 'Split', name: 'Living Room', brand: 'Adina', capacity: '18,000 BTU', serial: '—', status: 'Active' },
];

export function CustomerMasterDataTab({ tab, customerName }: { tab: MasterTab; customerName: string }) {
  const [contacts, setContacts] = useState(initialContacts);
  const [sites, setSites] = useState(initialSites);
  const [assets, setAssets] = useState(initialAssets);
  const [editor, setEditor] = useState<MasterTab | null>(null);
  const [selectedSite, setSelectedSite] = useState<SiteRow | null>(null);
  const [selectedAsset, setSelectedAsset] = useState<AssetRow | null>(null);

  const rows = tab === 'Contacts' ? contacts : tab === 'Properties' ? sites : assets;
  const copy = tab === 'Contacts'
    ? { title: 'Contacts', subtitle: 'People associated with this customer relationship.', action: 'Add contact' }
    : tab === 'Properties'
      ? { title: 'Properties / Sites', subtitle: 'Physical service locations are separate from customer identity.', action: 'Add property' }
      : { title: 'HVAC Equipment', subtitle: 'Every registered asset belongs to a property and retains its own history.', action: 'Register equipment' };

  return (
    <section className={styles.masterPanel}>
      <header className={styles.masterHeader}>
        <div><span>{customerName}</span><h3>{copy.title}</h3><p>{copy.subtitle}</p></div>
        <button type="button" onClick={() => setEditor(tab)}>+ {copy.action}</button>
      </header>

      {tab === 'Contacts' ? (
        <div className={styles.recordList}>{contacts.map((row) => <article className={styles.recordCard} key={row.id}><div className={styles.recordAvatar}>{row.name.split(' ').map((part) => part[0]).slice(0,2).join('')}</div><div className={styles.recordMain}><div><strong>{row.name}</strong>{row.primary ? <b>Primary</b> : null}</div><span>{row.role}</span><small>{row.phone} · {row.email}</small></div><button type="button">•••</button></article>)}</div>
      ) : null}

      {tab === 'Properties' ? (
        <div className={styles.recordList}>{sites.map((row) => <article className={styles.siteCard} key={row.id}><div className={styles.siteIcon}>⌂</div><div className={styles.recordMain}><div><strong>{row.name}</strong><b>Active</b></div><span>{row.address}</span><small>{row.sector} · GAC: {row.gac}</small><em>{row.access}</em></div><button type="button" onClick={() => setSelectedSite(row)}>Open site</button></article>)}</div>
      ) : null}

      {tab === 'Equipment' ? (
        <div className={styles.assetTableWrap}><table className={styles.assetTable}><thead><tr><th>Equipment</th><th>Property</th><th>Brand</th><th>Capacity</th><th>Serial</th><th>Status</th></tr></thead><tbody>{assets.map((row) => <tr key={row.id} onClick={() => setSelectedAsset(row)}><td><strong>{row.name}</strong><span>{row.type}</span></td><td>{row.site}</td><td>{row.brand}</td><td>{row.capacity}</td><td>{row.serial}</td><td><b>{row.status}</b></td></tr>)}</tbody></table></div>
      ) : null}

      {rows.length === 0 ? <div className={styles.emptyState}><strong>No records yet</strong><p>Add the first {tab.toLowerCase()} record for this customer.</p></div> : null}
      {editor ? <MasterRecordEditor kind={editor} sites={sites} onClose={() => setEditor(null)} onAddContact={(value) => setContacts((current) => [...current, value])} onAddSite={(value) => setSites((current) => [...current, value])} onAddAsset={(value) => setAssets((current) => [...current, value])} /> : null}
      {selectedSite ? <SiteDetailDrawer site={selectedSite} assets={assets} onClose={() => setSelectedSite(null)} /> : null}
      {selectedAsset ? <AssetDetailDrawer asset={selectedAsset} onClose={() => setSelectedAsset(null)} /> : null}
    </section>
  );
}

function MasterRecordEditor({ kind, sites, onClose, onAddContact, onAddSite, onAddAsset }: { kind: MasterTab; sites: SiteRow[]; onClose: () => void; onAddContact: (value: ContactRow) => void; onAddSite: (value: SiteRow) => void; onAddAsset: (value: AssetRow) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const update = (key: string, value: string) => setValues((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const id = `${kind.slice(0,2).toUpperCase()}-${Date.now()}`;
    if (kind === 'Contacts') onAddContact({ id, name: values.name || 'New Contact', role: values.role || 'Contact', phone: values.phone || '—', email: values.email || '—', primary: false });
    if (kind === 'Properties') onAddSite({ id, name: values.name || 'New Property', address: values.address || 'Aruba', sector: values.sector || 'Pending sector mapping', gac: values.gac || 'Pending mapping', access: values.access || 'No special access notes' });
    if (kind === 'Equipment') onAddAsset({ id, site: values.site || sites[0]?.name || 'Unassigned', type: values.type || 'Split', name: values.name || 'HVAC Equipment', brand: values.brand || 'Unknown', capacity: values.capacity || '18,000 BTU', serial: values.serial || '—', status: 'Active' });
    onClose();
  };

  return (
    <div className={styles.overlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className={styles.drawer} role="dialog" aria-modal="true">
        <header className={styles.drawerHeader}><div><span className={styles.eyebrow}>Customer master data</span><h2>{kind === 'Contacts' ? 'Add contact' : kind === 'Properties' ? 'Add property / site' : 'Register HVAC equipment'}</h2><p>{kind === 'Equipment' ? 'Equipment must belong to a property so service history and future maintenance remain traceable.' : 'Capture structured master data once and reuse it throughout the ERP.'}</p></div><button type="button" className={styles.closeButton} onClick={onClose}>×</button></header>
        <form className={styles.form} onSubmit={submit}>
          {kind === 'Contacts' ? <section className={styles.formSection}><div className={styles.fieldGrid}><label className={styles.fieldWide}><span>Full name *</span><input onChange={(e) => update('name', e.target.value)} required /></label><label><span>Role / relationship</span><input onChange={(e) => update('role', e.target.value)} placeholder="Decision maker, tenant, manager..." /></label><label><span>Phone</span><input onChange={(e) => update('phone', e.target.value)} /></label><label><span>Email</span><input type="email" onChange={(e) => update('email', e.target.value)} /></label></div></section> : null}
          {kind === 'Properties' ? <section className={styles.formSection}><div className={styles.fieldGrid}><label><span>Property name *</span><input onChange={(e) => update('name', e.target.value)} placeholder="Home, Office, Warehouse..." required /></label><label><span>Full address *</span><input onChange={(e) => update('address', e.target.value)} required /></label><label><span>GAC code</span><input onChange={(e) => update('gac', e.target.value)} placeholder="Official Aruba address classification" /></label><label><span>DEMAC operating sector</span><input onChange={(e) => update('sector', e.target.value)} placeholder="Mapped operational sector" /></label><label className={styles.fieldWide}><span>Access / parking / gate notes</span><textarea onChange={(e) => update('access', e.target.value)} rows={3} /></label></div></section> : null}
          {kind === 'Equipment' ? <section className={styles.formSection}><div className={styles.fieldGrid}><label><span>Property *</span><select onChange={(e) => update('site', e.target.value)} defaultValue={sites[0]?.name ?? ''}>{sites.length ? sites.map((site) => <option key={site.id}>{site.name}</option>) : <option value="">No property registered</option>}</select></label><label><span>System type *</span><select onChange={(e) => update('type', e.target.value)} defaultValue="Split"><option>Split</option><option>Cassette</option><option>Floor-Ceiling</option><option>Central</option><option>VRF Indoor</option><option>VRF Outdoor</option><option>Other</option></select></label><label><span>Equipment name / room *</span><input onChange={(e) => update('name', e.target.value)} placeholder="Master Bedroom, Lobby cassette..." required /></label><label><span>Capacity</span><select onChange={(e) => update('capacity', e.target.value)} defaultValue="18,000 BTU"><option>12,000 BTU</option><option>18,000 BTU</option><option>24,000 BTU</option><option>36,000 BTU</option><option>60,000 BTU</option><option>7.5 ton</option><option>10 ton</option><option>Other</option></select></label><label><span>Brand</span><input onChange={(e) => update('brand', e.target.value)} /></label><label><span>Serial number</span><input onChange={(e) => update('serial', e.target.value)} /></label></div></section> : null}
          <footer className={styles.drawerFooter}><button type="button" className={styles.secondaryButton} onClick={onClose}>Cancel</button><button type="submit" className={styles.primaryButton}>Save record</button></footer>
        </form>
      </aside>
    </div>
  );
}
