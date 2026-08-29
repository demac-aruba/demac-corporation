'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  joinLiveCrmCustomer,
  joinLiveCrmCustomers,
  loadLiveCrmSnapshot,
  searchLiveCrmCustomers,
  type LiveCrmClient,
  type LiveCrmCustomerGraph,
  type LiveCrmSnapshot,
  type LiveCrmWorkOrder,
} from '@/lib/live-crm';
import {
  createOfficeCustomer,
  createOfficeLifecycleRequestId,
  createOfficeProperty,
  saveOfficeContactAssignment,
  updateOfficeContact,
  updateOfficeCustomer,
  updateOfficeProperty,
} from '@/lib/office-booking-authority';
import { invalidateLiveSchedulingReferenceCache } from '@/lib/live-scheduling-fast';
import { defaultContactCommunicationRules } from '@/lib/customer-contacts';
import {
  CustomerEditorDrawer,
  CustomerMasterDataTab,
  type ContactEditorValue,
  type CustomerEditorValue,
  type PropertyEditorValue,
} from './customer-master-data';
import styles from './customer-360.module.css';

const tabs = ['Overview', 'Contacts', 'Properties', 'Equipment', 'Jobs'] as const;
type Tab = (typeof tabs)[number];
type CustomerEditorState = { mode: 'create' | 'edit'; requestId: string; initial?: CustomerEditorValue } | null;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function customerLabel(customer: LiveCrmClient) {
  return text(customer.company) || text(customer.name) || customer.id;
}

function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).map((part) => part[0]).slice(0, 2).join('').toUpperCase() || 'CU';
}

function customerType(customer: LiveCrmClient): CustomerEditorValue['type'] {
  const value = text(customer.type).toLowerCase();
  if (value === 'enterprise') return 'Enterprise';
  if (value === 'commercial' || customer.company) return 'Commercial';
  return 'Residential';
}

function preferredLanguage(value: unknown): CustomerEditorValue['preferredLanguage'] {
  const normalized = text(value).toLowerCase();
  if (['english', 'en'].includes(normalized)) return 'English';
  if (['spanish', 'español', 'espanol', 'es'].includes(normalized)) return 'Spanish';
  if (['dutch', 'nederlands', 'nl'].includes(normalized)) return 'Dutch';
  return 'Papiamento';
}

function editorValue(customer: LiveCrmClient): CustomerEditorValue {
  return {
    id: customer.id,
    expectedUpdatedAt: customer.updatedAt,
    name: text(customer.name) || customerLabel(customer),
    legalName: text(customer.legalName) || text(customer.company),
    type: customerType(customer),
    phone: text(customer.phone),
    whatsapp: text(customer.whatsapp),
    email: text(customer.email),
    location: text(customer.zone),
    preferredLanguage: preferredLanguage(customer.preferredLanguage),
  };
}

function formatDate(value: unknown) {
  const raw = text(value);
  if (!raw) return 'Not recorded';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatDateTime(value: unknown) {
  const raw = text(value);
  if (!raw) return 'Not recorded';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? raw : date.toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatAwg(value: number | null) {
  return value === null ? 'Not recorded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'AWG', maximumFractionDigits: 2 }).format(value);
}

function workOrderDate(order: LiveCrmWorkOrder) {
  return text(order.date) || text(order.createdAt) || text(order.updatedAt);
}

function workOrderDescription(order: LiveCrmWorkOrder) {
  return text(order.customerFacingDescription) || text(order.problem) || 'Work Order';
}

export function Customer360() {
  const [snapshot, setSnapshot] = useState<LiveCrmSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [customerEditor, setCustomerEditor] = useState<CustomerEditorState>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const refreshSequence = useRef(0);

  const refresh = useCallback(async (preferredCustomerId?: string) => {
    const sequence = ++refreshSequence.current;
    setLoadError('');
    try {
      const next = await loadLiveCrmSnapshot();
      if (sequence !== refreshSequence.current) return next;
      setSnapshot(next);
      setSelectedId((current) => {
        const preferred = preferredCustomerId && next.clients.some((client) => client.id === preferredCustomerId) ? preferredCustomerId : '';
        if (preferred) return preferred;
        if (current && next.clients.some((client) => client.id === current)) return current;
        return joinLiveCrmCustomers(next, true)[0]?.client.id ?? '';
      });
      return next;
    } catch (error) {
      if (sequence === refreshSequence.current) {
        setLoadError(error instanceof Error ? error.message : 'The CRM could not load its canonical data.');
      }
      throw error;
    } finally {
      if (sequence === refreshSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  const graphs = useMemo(() => snapshot ? searchLiveCrmCustomers(snapshot, query, { includeInactive: true }) : [], [query, snapshot]);
  const allGraphs = useMemo(() => snapshot ? joinLiveCrmCustomers(snapshot, true) : [], [snapshot]);
  const activeGraphs = useMemo(() => allGraphs.filter((graph) => graph.client.active !== false), [allGraphs]);
  const selected = useMemo(() => snapshot && selectedId ? joinLiveCrmCustomer(snapshot, selectedId) : null, [selectedId, snapshot]);
  const totals = useMemo(() => ({
    customers: activeGraphs.length,
    properties: activeGraphs.reduce((sum, graph) => sum + graph.facts.activePropertyCount, 0),
    contacts: activeGraphs.reduce((sum, graph) => sum + graph.facts.activeContactCount, 0),
    equipment: activeGraphs.reduce((sum, graph) => sum + graph.facts.activeEquipmentCount, 0),
  }), [activeGraphs]);

  const selectCustomer = (id: string) => {
    setSelectedId(id);
    setActiveTab('Overview');
  };

  const saveCustomer = async (value: CustomerEditorValue) => {
    if (customerEditor?.mode === 'edit' && selected) {
      await updateOfficeCustomer({
        requestId: customerEditor.requestId,
        customerId: selected.client.id,
        expectedUpdatedAt: value.expectedUpdatedAt ?? '',
        changes: { name: value.name, company: value.legalName, legalName: value.legalName, type: value.type, phone: value.phone, whatsapp: value.whatsapp || value.phone, email: value.email, preferredLanguage: value.preferredLanguage, zone: value.location },
      });
      invalidateLiveSchedulingReferenceCache();
      await refresh(selected.client.id).catch(() => undefined);
      setNotice('Customer information saved to the canonical CRM record.');
      return;
    }
    const result = await createOfficeCustomer({
      requestId: customerEditor?.requestId ?? createOfficeLifecycleRequestId('crm-customer-create'),
      customer: { name: value.name, company: value.legalName, legalName: value.legalName, type: value.type, phone: value.phone || value.whatsapp, whatsapp: value.whatsapp || value.phone, email: value.email, preferredLanguage: value.preferredLanguage, zone: value.location },
    });
    invalidateLiveSchedulingReferenceCache();
    await refresh(result.customer.id).catch(() => undefined);
    setActiveTab('Overview');
    setNotice('New customer created in the canonical CRM. Add a property when the service location is known.');
  };

  const addProperty = async (value: PropertyEditorValue) => {
    if (!selected) return;
    await createOfficeProperty({
      requestId: value.requestId ?? createOfficeLifecycleRequestId('crm-property-create'),
      customerId: selected.client.id,
      property: { name: value.name, type: value.type, address: value.address, zone: value.zone, neighborhood: value.neighborhood, accessInstructions: value.accessInstructions, notes: value.notes },
    });
    invalidateLiveSchedulingReferenceCache();
    await refresh(selected.client.id).catch(() => undefined);
    setNotice('Property saved and linked to this customer.');
  };

  const updateProperty = async (value: PropertyEditorValue) => {
    if (!selected || !value.id) return;
    await updateOfficeProperty({
      requestId: value.requestId ?? createOfficeLifecycleRequestId('crm-property-update'),
      customerId: selected.client.id,
      propertyId: value.id,
      expectedUpdatedAt: value.expectedUpdatedAt ?? '',
      changes: { name: value.name, type: value.type, address: value.address, zone: value.zone, neighborhood: value.neighborhood, accessInstructions: value.accessInstructions, notes: value.notes },
    });
    invalidateLiveSchedulingReferenceCache();
    await refresh(selected.client.id).catch(() => undefined);
    setNotice('Property changes saved to the canonical record.');
  };

  const addContact = async (value: ContactEditorValue) => {
    if (!selected) return;
    await saveOfficeContactAssignment({
      requestId: value.requestId ?? createOfficeLifecycleRequestId('crm-contact-create'),
      customerId: selected.client.id,
      propertyId: value.propertyId,
      link: {
        contact: { name: value.name, phone: value.phone, whatsapp: value.whatsapp || value.phone, email: value.email, preferredLanguage: value.preferredLanguage },
        scope: value.scope,
        role: value.role,
        ...defaultContactCommunicationRules,
      },
    });
    await refresh(selected.client.id).catch(() => undefined);
    setNotice('Contact saved with its property relationship.');
  };

  const updateContact = async (value: ContactEditorValue) => {
    if (!selected || !value.id) return;
    await updateOfficeContact({
      requestId: value.requestId ?? createOfficeLifecycleRequestId('crm-contact-update'),
      customerId: selected.client.id,
      contactId: value.id,
      expectedUpdatedAt: value.expectedUpdatedAt ?? '',
      changes: { name: value.name, phone: value.phone, whatsapp: value.whatsapp || value.phone, email: value.email, preferredLanguage: value.preferredLanguage },
    });
    await refresh(selected.client.id).catch(() => undefined);
    setNotice('Contact information saved without changing its property assignments.');
  };

  return (
    <section className={styles.page}>
      <header className={styles.pageHead}>
        <div><div className="eyebrow">Customer Relationship Management</div><h1>CRM · Customer 360</h1><p>Real customers, people, properties, equipment and work history from the same canonical records used by Scheduling.</p></div>
        <div className={styles.pageActions}><button className="btn" type="button" onClick={() => { setLoading(true); void refresh(selectedId).catch(() => undefined); }} disabled={loading}>Refresh</button><button className="btn primary" type="button" onClick={() => setCustomerEditor({ mode: 'create', requestId: createOfficeLifecycleRequestId('crm-customer-create') })}>+ New Customer</button></div>
      </header>

      {notice ? <div className={styles.notice} role="status"><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div> : null}
      {loadError ? <div className={styles.errorState} role="alert"><div><strong>CRM data could not be loaded</strong><p>{loadError}</p></div><button type="button" onClick={() => { setLoading(true); void refresh(selectedId).catch(() => undefined); }}>Try again</button></div> : null}

      <div className={styles.metricGrid}>
        <div className={styles.metricCard}><span>Active Customers</span><strong>{loading ? '—' : totals.customers}</strong><em>Canonical client records</em></div>
        <div className={styles.metricCard}><span>Properties</span><strong>{loading ? '—' : totals.properties}</strong><em>Active service locations</em></div>
        <div className={styles.metricCard}><span>Additional Contacts</span><strong>{loading ? '—' : totals.contacts}</strong><em>Linked people, excluding customers</em></div>
        <div className={styles.metricCard}><span>Registered Equipment</span><strong>{loading ? '—' : totals.equipment}</strong><em>Active equipment systems</em></div>
      </div>

      <div className={styles.workspace}>
        <aside className={styles.customerRail}>
          <div className={styles.railHeader}><div><strong>Customers</strong><span>{loading ? 'Loading…' : loadError && !snapshot ? 'Source unavailable' : `${graphs.length} real record${graphs.length === 1 ? '' : 's'}`}</span></div><span className={`${styles.liveBadge} ${loadError && !snapshot ? styles.errorBadge : ''}`}>{loadError && !snapshot ? 'ERROR' : 'LIVE'}</span></div>
          <label className={styles.searchBox}><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, company, phone, contact or address..." aria-label="Search customers" /></label>
          <div className={styles.customerList}>
            {graphs.map((graph) => <button key={graph.client.id} type="button" onClick={() => selectCustomer(graph.client.id)} className={`${styles.customerRow} ${selected?.client.id === graph.client.id ? styles.customerRowActive : ''}`}><span className={styles.customerAvatar}>{initials(customerLabel(graph.client))}</span><span className={styles.customerIdentity}><strong>{customerLabel(graph.client)}</strong><small>{text(graph.client.company) && text(graph.client.name) !== text(graph.client.company) ? `${graph.client.name} · ` : ''}{graph.facts.activePropertyCount} propert{graph.facts.activePropertyCount === 1 ? 'y' : 'ies'}</small></span><span className={`${styles.recordDot} ${graph.client.active === false ? styles.recordInactive : styles.recordActive}`} title={graph.client.active === false ? 'Inactive' : 'Active'} /></button>)}
            {!loading && !loadError && !graphs.length ? <div className={styles.railEmpty}><strong>{query.trim() ? 'No matching customer' : 'No customers yet'}</strong><span>{query.trim() ? 'Search includes customer, property and contact information.' : 'Create the first canonical customer record.'}</span></div> : null}
          </div>
        </aside>

        <main className={styles.customerDetail}>
          {loading && !snapshot ? <LoadingPanel /> : loadError && !snapshot ? <LoadFailurePanel onRetry={() => { setLoading(true); void refresh().catch(() => undefined); }} /> : selected ? <CustomerDetail graph={selected} activeTab={activeTab} onTab={setActiveTab} onEdit={() => setCustomerEditor({ mode: 'edit', requestId: createOfficeLifecycleRequestId('crm-customer-update'), initial: editorValue(selected.client) })} onAddContact={addContact} onUpdateContact={updateContact} onAddProperty={addProperty} onUpdateProperty={updateProperty} /> : <EmptyCustomerPanel onCreate={() => setCustomerEditor({ mode: 'create', requestId: createOfficeLifecycleRequestId('crm-customer-create') })} />}
        </main>

        <aside className={styles.intelligenceRail}>
          <div className={styles.intelligenceTitle}><span>DB</span><div><strong>Canonical relationship</strong><small>Authenticated production data</small></div></div>
          {loadError && !snapshot ? <section className={styles.intelligenceCard}><span className={styles.cardLabel}>Data unavailable</span><strong>Canonical CRM could not be reached</strong><p>Use Try again after checking the authenticated session or network connection. No local records were substituted.</p></section> : selected ? <>
            <section className={styles.intelligenceCard}><span className={styles.cardLabel}>Identity source</span><strong>clients/{selected.client.id}</strong><p>Appointments and Work Orders keep this same customer ID.</p></section>
            <section className={styles.intelligenceCard}><span className={styles.cardLabel}>People & properties</span><div className={styles.statusLine}><b>{selected.facts.activeContactCount + 1} people</b><span className={styles.okDot} /></div><p>1 customer/owner + {selected.facts.activeContactCount} additional contact{selected.facts.activeContactCount === 1 ? '' : 's'} across {selected.facts.activePropertyCount} propert{selected.facts.activePropertyCount === 1 ? 'y' : 'ies'}.</p></section>
            <section className={styles.intelligenceCard}><span className={styles.cardLabel}>Last canonical update</span><strong>{formatDateTime(selected.facts.updatedAt || snapshot?.loadedAt)}</strong><p>Loaded from Firestore. Changes are persisted server-side and survive refreshes and other devices.</p></section>
          </> : <section className={styles.intelligenceCard}><span className={styles.cardLabel}>Data source</span><strong>Firestore connected</strong><p>No local customer fixtures are used by this workspace.</p></section>}
          {snapshot ? <div className={styles.sourceNotice}><span />Canonical Firebase records · no browser fallback</div> : null}
        </aside>
      </div>

      <CustomerEditorDrawer open={customerEditor !== null} mode={customerEditor?.mode ?? 'create'} initial={customerEditor?.initial} existingCustomers={allGraphs.map(({ client }) => ({ id: client.id, name: customerLabel(client), phone: text(client.phone), whatsapp: text(client.whatsapp), email: text(client.email) }))} onClose={() => setCustomerEditor(null)} onSave={saveCustomer} />
    </section>
  );
}

function CustomerDetail({ graph, activeTab, onTab, onEdit, onAddContact, onUpdateContact, onAddProperty, onUpdateProperty }: { graph: LiveCrmCustomerGraph; activeTab: Tab; onTab: (tab: Tab) => void; onEdit: () => void; onAddContact: (value: ContactEditorValue) => Promise<void>; onUpdateContact: (value: ContactEditorValue) => Promise<void>; onAddProperty: (value: PropertyEditorValue) => Promise<void>; onUpdateProperty: (value: PropertyEditorValue) => Promise<void> }) {
  const label = customerLabel(graph.client);
  const whatsapp = (text(graph.client.whatsapp) || text(graph.client.phone)).replace(/\D/g, '');
  return <>
    <section className={styles.profileHeader}>
      <div className={styles.profileIdentity}><div className={styles.heroAvatar}>{initials(label)}</div><div><div className={styles.idLine}><span>{graph.client.id}</span><b>{graph.client.active === false ? 'Inactive' : 'Active'}</b></div><h2>{label}</h2><p>{text(graph.client.company) && text(graph.client.name) !== text(graph.client.company) ? `${graph.client.name} · ` : ''}Customer since {formatDate(graph.client.createdAt)}</p></div></div>
      <div className={styles.profileActions}>{whatsapp ? <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a> : null}{text(graph.client.phone) ? <a href={`tel:${graph.client.phone}`}>Call</a> : null}<button className={styles.primaryAction} type="button" onClick={onEdit}>Edit customer</button></div>
    </section>

    <section className={styles.summaryGrid}>
      <article><span>Properties</span><strong>{graph.facts.activePropertyCount}</strong><small>Active service locations</small></article>
      <article><span>Additional contacts</span><strong>{graph.facts.activeContactCount}</strong><small>Property-linked people</small></article>
      <article><span>Registered equipment</span><strong>{graph.facts.activeEquipmentCount}</strong><small>Active systems</small></article>
      <article><span>Open work</span><strong>{graph.facts.openWorkOrderCount}</strong><small>Canonical Work Orders</small></article>
      <article><span>Total work history</span><strong>{graph.facts.workOrderCount}</strong><small>All linked Work Orders</small></article>
      <article><span>Customer balance</span><strong className={graph.facts.outstandingBalance && graph.facts.outstandingBalance > 0 ? styles.warningText : styles.positive}>{formatAwg(graph.facts.outstandingBalance)}</strong><small>Value stored on customer</small></article>
    </section>

    <nav className={styles.tabs} aria-label="Customer sections">{tabs.map((tab) => <button key={tab} type="button" className={activeTab === tab ? styles.tabActive : ''} onClick={() => onTab(tab)}>{tab}</button>)}</nav>
    {activeTab === 'Overview' ? <Overview graph={graph} onEdit={onEdit} onViewProperties={() => onTab('Properties')} onViewJobs={() => onTab('Jobs')} /> : null}
    {activeTab === 'Contacts' || activeTab === 'Properties' || activeTab === 'Equipment' ? <CustomerMasterDataTab key={`${graph.client.id}-${activeTab}`} tab={activeTab} graph={graph} onAddContact={onAddContact} onUpdateContact={onUpdateContact} onAddProperty={onAddProperty} onUpdateProperty={onUpdateProperty} /> : null}
    {activeTab === 'Jobs' ? <JobsPanel graph={graph} /> : null}
  </>;
}

function Overview({ graph, onEdit, onViewProperties, onViewJobs }: { graph: LiveCrmCustomerGraph; onEdit: () => void; onViewProperties: () => void; onViewJobs: () => void }) {
  const recent = [...graph.workOrders].sort((left, right) => workOrderDate(right).localeCompare(workOrderDate(left))).slice(0, 6);
  return <div className={styles.overviewGrid}>
    <section className={styles.detailCard}><div className={styles.cardHead}><div><strong>Customer identity</strong><span>Primary canonical contact information</span></div><button type="button" onClick={onEdit}>Edit</button></div><div className={styles.infoRows}><div><span>Phone</span><strong>{graph.client.phone || '—'}</strong></div><div><span>WhatsApp</span><strong>{graph.client.whatsapp || '—'}</strong></div><div><span>Email</span><strong>{graph.client.email || '—'}</strong></div><div><span>Preferred language</span><strong>{graph.client.preferredLanguage || 'Not recorded'}</strong></div></div></section>
    <section className={styles.detailCard}><div className={styles.cardHead}><div><strong>Properties</strong><span>Real service sites, separate from customer identity</span></div><button type="button" onClick={onViewProperties}>View all</button></div><div className={styles.assetRows}>{graph.properties.slice(0, 4).map((property, index) => <div key={property.id}><span className={styles.assetIcon}>S{index + 1}</span><div><strong>{property.name || property.address || property.id}</strong><small>{property.address || 'Address not recorded'}</small></div><b>{graph.equipment.filter((item) => item.propertyId === property.id && item.active !== false).length} units</b></div>)}{!graph.properties.length ? <div className={styles.compactEmpty}>No properties registered yet.</div> : null}</div></section>
    <section className={`${styles.detailCard} ${styles.timelineCard}`}><div className={styles.cardHead}><div><strong>Recent Work Orders</strong><span>Operational history linked by customer/property ID</span></div><button type="button" onClick={onViewJobs}>Full work history</button></div><div className={styles.activityList}>{recent.map((order) => <div className={styles.activityRow} key={order.id}><span className={`${styles.activityDot} ${styles.blue}`} /><time>{workOrderDate(order) || 'No date'}</time><div><strong>{workOrderDescription(order)}</strong><p>{order.id} · {order.status || 'Status not recorded'}{order.time ? ` · ${order.time}` : ''}</p></div></div>)}{!recent.length ? <div className={styles.compactEmpty}>No Work Orders are linked to this customer yet.</div> : null}</div></section>
  </div>;
}

function JobsPanel({ graph }: { graph: LiveCrmCustomerGraph }) {
  const propertyById = new Map(graph.properties.map((property) => [property.id, property]));
  const orders = [...graph.workOrders].sort((left, right) => workOrderDate(right).localeCompare(workOrderDate(left)));
  return <section className={styles.recordsPanel}><header><div><span>{customerLabel(graph.client)}</span><h3>Work Order history</h3><p>Every row below comes from the canonical `workOrders` collection.</p></div><a href="/work-orders/">Open Work Orders</a></header>{orders.length ? <div className={styles.jobsTable}><div className={`${styles.jobRow} ${styles.jobHead}`}><span>Date / time</span><span>Work Order</span><span>Property</span><span>Status</span></div>{orders.map((order) => { const propertyId = text(order.propertyId) || text(order.siteId); const property = propertyById.get(propertyId); return <div className={styles.jobRow} key={order.id}><div><strong>{workOrderDate(order) || 'No date'}</strong><small>{order.time || 'Time not recorded'}</small></div><div><strong>{workOrderDescription(order)}</strong><small>{order.id}</small></div><span>{property?.name || property?.address || propertyId || 'Unassigned'}</span><b>{order.status || 'Not recorded'}</b></div>; })}</div> : <div className={styles.panelEmpty}><strong>No Work Orders found</strong><p>Bookings and field work linked to this customer will appear here automatically.</p></div>}</section>;
}

function LoadingPanel() {
  return <div className={styles.centerState} aria-live="polite"><span className={styles.spinner} /><strong>Loading canonical CRM data…</strong><p>Customers, contacts, properties, equipment and Work Orders are being read from the authenticated source.</p></div>;
}

function EmptyCustomerPanel({ onCreate }: { onCreate: () => void }) {
  return <div className={styles.centerState}><strong>No canonical customers found</strong><p>Create a real customer record or create one during appointment booking. Both paths use the same CRM identity.</p><button type="button" onClick={onCreate}>+ Create customer</button></div>;
}

function LoadFailurePanel({ onRetry }: { onRetry: () => void }) {
  return <div className={styles.centerState}><strong>Canonical CRM is unavailable</strong><p>The application did not replace the failed request with local or sample customers. Restore the authenticated connection and retry.</p><button type="button" onClick={onRetry}>Try again</button></div>;
}
