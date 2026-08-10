'use client';

import { useMemo, useState } from 'react';
import { CustomerEditorDrawer, CustomerMasterDataTab, type CustomerEditorValue } from './customer-master-data';
import { DuplicateReviewDrawer } from './relationship-detail';
import styles from './customer-360.module.css';

export type CustomerPreview = {
  id: string;
  name: string;
  legalName?: string;
  type: 'Commercial' | 'Residential' | 'Enterprise';
  initials: string;
  location: string;
  phone: string;
  email: string;
  preferredLanguage?: CustomerEditorValue['preferredLanguage'];
  since: string;
  health: number;
  lifetimeRevenue: string;
  outstanding: string;
  openJobs: number;
  openProposals: number;
  assets: number;
  sites: number;
  maintenance: 'Active' | 'Due Soon' | 'None';
  nextAction: string;
};

const initialCustomers: CustomerPreview[] = [
  { id: 'C-1042', name: 'ABC Aruba N.V.', legalName: 'ABC Aruba N.V.', type: 'Commercial', initials: 'AA', location: 'Oranjestad', phone: '+297 582 4410', email: 'operations@abcaruba.aw', preferredLanguage: 'English', since: '2022', health: 88, lifetimeRevenue: 'Afl. 284,500', outstanding: 'Afl. 8,750', openJobs: 2, openProposals: 1, assets: 37, sites: 2, maintenance: 'Active', nextAction: 'Follow up on proposal #2187' },
  { id: 'C-0887', name: 'John Smith', type: 'Residential', initials: 'JS', location: 'Noord', phone: '+297 560 1188', email: 'john.smith@email.com', preferredLanguage: 'English', since: '2021', health: 94, lifetimeRevenue: 'Afl. 14,800', outstanding: 'Afl. 0', openJobs: 0, openProposals: 0, assets: 7, sites: 2, maintenance: 'Due Soon', nextAction: 'Maintenance outreach due this month' },
  { id: 'C-1201', name: 'Ocean View Villas', legalName: 'Ocean View Villas N.V.', type: 'Commercial', initials: 'OV', location: 'Palm Beach', phone: '+297 586 9912', email: 'manager@oceanview.aw', preferredLanguage: 'English', since: '2024', health: 73, lifetimeRevenue: 'Afl. 92,300', outstanding: 'Afl. 14,000', openJobs: 1, openProposals: 2, assets: 18, sites: 1, maintenance: 'None', nextAction: 'Resolve remaining Afl. 1,000 after payment allocation' },
  { id: 'C-1118', name: 'Renaissance Engineering', type: 'Enterprise', initials: 'RE', location: 'Oranjestad', phone: '+297 583 6000', email: 'engineering@renaissance.aw', preferredLanguage: 'English', since: '2023', health: 91, lifetimeRevenue: 'Afl. 418,600', outstanding: 'Afl. 0', openJobs: 3, openProposals: 1, assets: 146, sites: 1, maintenance: 'Active', nextAction: 'Commercial project technical meeting' },
  { id: 'C-0741', name: 'Maria Croes', type: 'Residential', initials: 'MC', location: 'Santa Cruz', phone: '+297 561 7732', email: 'maria.c@email.com', preferredLanguage: 'Papiamento', since: '2020', health: 82, lifetimeRevenue: 'Afl. 9,420', outstanding: 'Afl. 450', openJobs: 1, openProposals: 0, assets: 4, sites: 1, maintenance: 'Due Soon', nextAction: 'Confirm diagnostic appointment' },
];

const tabs = ['Overview', 'Contacts', 'Properties', 'Equipment', 'Jobs', 'Estimates', 'Invoices', 'Payments', 'Communications', 'Opportunities', 'Documents'] as const;
type Tab = (typeof tabs)[number];

function healthTone(score: number) {
  if (score >= 90) return styles.healthExcellent;
  if (score >= 80) return styles.healthGood;
  return styles.healthAttention;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'CU';
}

function editorValue(customer: CustomerPreview): CustomerEditorValue {
  return { id: customer.id, name: customer.name, legalName: customer.legalName ?? '', type: customer.type, phone: customer.phone, email: customer.email, location: customer.location, preferredLanguage: customer.preferredLanguage ?? 'Papiamento' };
}

export function Customer360() {
  const [customers, setCustomers] = useState(initialCustomers);
  const [selectedId, setSelectedId] = useState(initialCustomers[0].id);
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [customerEditor, setCustomerEditor] = useState<'create' | 'edit' | null>(null);
  const [mergeReview, setMergeReview] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return customers;
    return customers.filter((customer) => [customer.name, customer.type, customer.location, customer.phone, customer.email].some((value) => value.toLowerCase().includes(normalized)));
  }, [customers, query]);

  const selected = customers.find((customer) => customer.id === selectedId) ?? customers[0];
  const selectedEditorValue = useMemo(() => editorValue(selected), [selected]);

  const saveCustomer = (value: CustomerEditorValue) => {
    if (customerEditor === 'edit') {
      setCustomers((current) => current.map((customer) => customer.id === selected.id ? { ...customer, name: value.name, legalName: value.legalName, type: value.type, phone: value.phone, email: value.email, location: value.location, preferredLanguage: value.preferredLanguage, initials: initials(value.name) } : customer));
      setNotice('Customer master data updated in preview.');
      return;
    }
    const nextId = `C-${String(1300 + customers.length).padStart(4, '0')}`;
    const next: CustomerPreview = { id: nextId, name: value.name, legalName: value.legalName, type: value.type, initials: initials(value.name), location: value.location || 'Aruba', phone: value.phone, email: value.email, preferredLanguage: value.preferredLanguage, since: '2026', health: 80, lifetimeRevenue: 'Afl. 0', outstanding: 'Afl. 0', openJobs: 0, openProposals: 0, assets: 0, sites: 0, maintenance: 'None', nextAction: 'Complete customer profile and register first property' };
    setCustomers((current) => [next, ...current]);
    setSelectedId(nextId);
    setActiveTab('Overview');
    setNotice('New customer created in ERP Next preview.');
  };

  return (
    <section className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <div className="eyebrow">Customer Relationship Management</div>
          <h1>CRM · Customer 360</h1>
          <p>Every customer relationship, property, HVAC asset, interaction, opportunity and financial signal in one operating view.</p>
        </div>
        <div className={styles.pageActions}>
          <button className="btn" type="button" onClick={() => setMergeReview(true)}>Import / Merge</button>
          <button className="btn primary" type="button" onClick={() => setCustomerEditor('create')}>+ New Customer</button>
        </div>
      </header>

      {notice ? <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px', background: 'var(--brand-soft)', color: 'var(--brand)', fontSize: 9, fontWeight: 800, display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{notice}</span><button type="button" onClick={() => setNotice(null)} style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' }}>×</button></div> : null}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}><span>Active Customers</span><strong>4,281</strong><em>+38 this month</em></div>
        <div className={styles.metricCard}><span>Open Opportunities</span><strong>Afl. 384K</strong><em>26 active opportunities</em></div>
        <div className={styles.metricCard}><span>Maintenance Due</span><strong>183</strong><em>Next 30 days</em></div>
        <div className={styles.metricCard}><span>Outstanding AR</span><strong>Afl. 92K</strong><em>18 accounts need attention</em></div>
      </div>

      <div className={styles.workspace}>
        <aside className={styles.customerRail}>
          <div className={styles.railHeader}><div><strong>Customers</strong><span>{filtered.length} preview records</span></div><button type="button" aria-label="Customer filters">≡</button></div>
          <label className={styles.searchBox}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customer, phone, site..." /></label>
          <div className={styles.customerList}>{filtered.map((customer) => <button key={customer.id} type="button" onClick={() => { setSelectedId(customer.id); setActiveTab('Overview'); }} className={`${styles.customerRow} ${selected.id === customer.id ? styles.customerRowActive : ''}`}><span className={styles.customerAvatar}>{customer.initials}</span><span className={styles.customerIdentity}><strong>{customer.name}</strong><small>{customer.type} · {customer.location}</small></span><span className={`${styles.healthDot} ${healthTone(customer.health)}`} title={`Health ${customer.health}`} /></button>)}</div>
        </aside>

        <main className={styles.customerDetail}>
          <section className={styles.profileHeader}>
            <div className={styles.profileIdentity}><div className={styles.heroAvatar}>{selected.initials}</div><div><div className={styles.idLine}><span>{selected.id}</span><b>{selected.type}</b></div><h2>{selected.name}</h2><p>{selected.location} · Customer since {selected.since}</p></div></div>
            <div className={styles.profileActions}><button type="button">Message</button><button type="button">Call</button><button className={styles.primaryAction} type="button">+ Create</button></div>
          </section>

          <section className={styles.summaryGrid}>
            <article><span>Customer Health</span><strong>{selected.health}/100</strong><div className={styles.healthTrack}><i style={{ width: `${selected.health}%` }} /></div></article>
            <article><span>Lifetime Revenue</span><strong>{selected.lifetimeRevenue}</strong><small>Revenue relationship</small></article>
            <article><span>Outstanding</span><strong className={selected.outstanding === 'Afl. 0' ? styles.positive : styles.warningText}>{selected.outstanding}</strong><small>Customer-level balance</small></article>
            <article><span>HVAC Assets</span><strong>{selected.assets}</strong><small>{selected.sites} site{selected.sites === 1 ? '' : 's'} registered</small></article>
            <article><span>Open Work</span><strong>{selected.openJobs}</strong><small>Scheduled / active jobs</small></article>
            <article><span>Open Proposals</span><strong>{selected.openProposals}</strong><small>Awaiting decision</small></article>
          </section>

          <nav className={styles.tabs} aria-label="Customer sections">{tabs.map((tab) => <button key={tab} type="button" className={activeTab === tab ? styles.tabActive : ''} onClick={() => setActiveTab(tab)}>{tab}</button>)}</nav>

          {activeTab === 'Overview' ? <Overview customer={selected} onEdit={() => setCustomerEditor('edit')} /> : activeTab === 'Contacts' || activeTab === 'Properties' || activeTab === 'Equipment' ? <CustomerMasterDataTab key={`${selected.id}-${activeTab}`} tab={activeTab} customerName={selected.name} /> : <TabPreview tab={activeTab} customer={selected} />}
        </main>

        <aside className={styles.intelligenceRail}>
          <div className={styles.intelligenceTitle}><span>AI</span><div><strong>Customer Intelligence</strong><small>Structured signals + governed AI</small></div></div>
          <section className={styles.intelligenceCard}><span className={styles.cardLabel}>Next Best Action</span><strong>{selected.nextAction}</strong><p>Suggested from customer status, open work, financial context and recent activity.</p><button type="button">Open action</button></section>
          <section className={styles.intelligenceCard}><span className={styles.cardLabel}>Maintenance</span><div className={styles.statusLine}><b>{selected.maintenance}</b><span className={selected.maintenance === 'Active' ? styles.okDot : styles.warnDot} /></div><p>{selected.maintenance === 'None' ? 'Commercial maintenance agreement opportunity detected.' : 'Maintenance relationship is visible at customer and asset level.'}</p></section>
          <section className={styles.intelligenceCard}><span className={styles.cardLabel}>Relationship Snapshot</span><ul><li>{selected.assets} equipment assets registered</li><li>{selected.openJobs} open operational jobs</li><li>{selected.openProposals} proposal(s) awaiting decision</li><li>{selected.outstanding} currently outstanding</li></ul></section>
          <div className={styles.previewNotice}><span />Preview data only · Firebase adapter not connected</div>
        </aside>
      </div>

      <CustomerEditorDrawer open={customerEditor !== null} mode={customerEditor ?? 'create'} initial={customerEditor === 'edit' ? selectedEditorValue : undefined} existingCustomers={customers.map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }))} onClose={() => setCustomerEditor(null)} onSave={saveCustomer} />
      {mergeReview ? <DuplicateReviewDrawer customers={customers.map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, type: customer.type }))} onClose={() => setMergeReview(false)} /> : null}
    </section>
  );
}

function Overview({ customer, onEdit }: { customer: CustomerPreview; onEdit: () => void }) {
  return <div className={styles.overviewGrid}>
    <section className={styles.detailCard}><div className={styles.cardHead}><div><strong>Relationship Overview</strong><span>Primary contact and customer facts</span></div><button type="button" onClick={onEdit}>Edit</button></div><div className={styles.infoRows}><div><span>Phone</span><strong>{customer.phone}</strong></div><div><span>Email</span><strong>{customer.email || '—'}</strong></div><div><span>Primary location</span><strong>{customer.location}</strong></div><div><span>Preferred language</span><strong>{customer.preferredLanguage ?? 'Papiamento'}</strong></div></div></section>
    <section className={styles.detailCard}><div className={styles.cardHead}><div><strong>Properties & Equipment</strong><span>Sites remain separate from customer identity</span></div><button type="button">View all</button></div><div className={styles.assetRows}><div><span className={styles.assetIcon}>S1</span><div><strong>{customer.location} Primary Site</strong><small>{Math.max(0, Math.round(customer.assets * .65))} HVAC assets · active</small></div><b>{customer.sites > 0 ? 'Healthy' : 'Setup'}</b></div>{customer.sites > 1 ? <div><span className={styles.assetIcon}>S2</span><div><strong>Secondary Property</strong><small>{Math.max(1, customer.assets - Math.round(customer.assets * .65))} HVAC assets · active</small></div><b>Healthy</b></div> : null}</div></section>
    <section className={`${styles.detailCard} ${styles.timelineCard}`}><div className={styles.cardHead}><div><strong>Recent Activity</strong><span>One chronological customer timeline</span></div><button type="button">Full timeline</button></div><div className={styles.activityList}><Activity time="Today · 09:14" title="WhatsApp conversation" detail="Customer requested availability and office follow-up." tone="blue" /><Activity time="Yesterday · 15:42" title="Payment detected" detail="Incoming bank transaction matched to customer account for review." tone="green" /><Activity time="Aug 8 · 11:20" title="Work order completed" detail="Technician report submitted and routed to office review." tone="purple" /><Activity time="Aug 5 · 14:05" title="Estimate sent" detail="Proposal delivered with equipment and payment terms." tone="amber" /></div></section>
  </div>;
}

function Activity({ time, title, detail, tone }: { time: string; title: string; detail: string; tone: string }) { return <div className={styles.activityRow}><span className={`${styles.activityDot} ${styles[tone]}`} /><time>{time}</time><div><strong>{title}</strong><p>{detail}</p></div></div>; }

function TabPreview({ tab, customer }: { tab: Tab; customer: CustomerPreview }) {
  return <section className={styles.tabPreview}><div className={styles.tabPreviewIcon}>{tab.slice(0, 2).toUpperCase()}</div><div><h3>{tab}</h3><p>This Customer 360 section is registered in the CRM architecture for <strong>{customer.name}</strong>. It will be implemented after the customer master-data flows, without changing the information hierarchy.</p></div></section>;
}
