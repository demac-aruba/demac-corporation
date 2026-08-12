'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadBrowserCrmCustomers, loadBrowserCustomerMaster, sectorFromCrm, type BrowserCrmCustomerIdentity, type BrowserCrmSiteIdentity } from '../../lib/browser-crm';
import { diagnoseBookingRequest, type BookingLiveIssue } from '../../lib/scheduling-booking-diagnostics';
import { browserKeys, saveBrowserValue } from '../../lib/browser-store';
import type { BookingRequest, CandidateSlot, WorkPresetId } from '../../lib/scheduling';
import { customerFacingDescription, defaultWorkPresets } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay, SupportReflowPlan } from '../../lib/scheduling-capacity';
import { findCandidateSlotsForDay, findSupportReflowPlansForDay } from '../../lib/scheduling-capacity';
import { QuickCustomerOnboarding, type QuickCustomerCreateResult } from './quick-customer-onboarding';
import styles from './scheduling-overview-v2.module.css';

export type BookingIdentity = { customerId?: string; siteId?: string };
export type PreferredSlot = { vanId?: string; start?: string };

type Props = {
  day: OperationalDay;
  jobs: CalendarDispatchJob[];
  preferred: PreferredSlot;
  onClose: () => void;
  onReserve: (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string, identity: BookingIdentity) => void;
  onApplySupportReflow: (plan: SupportReflowPlan) => void;
};

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
}

function LiveIssue({ issue }: { issue: BookingLiveIssue }) {
  const isError = issue.severity === 'error';
  const isWarning = issue.severity === 'warning';
  const border = isError ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--brand)';
  const background = isError ? 'var(--danger-soft)' : isWarning ? 'var(--warning-soft)' : 'var(--brand-soft)';
  const color = isError ? 'var(--danger)' : isWarning ? 'var(--warning)' : 'var(--brand)';
  return <div style={{ margin: '0 11px 9px', padding: '9px 10px', border: `1px solid color-mix(in srgb, ${border} 35%, var(--border))`, borderLeft: `3px solid ${border}`, borderRadius: 8, background }}>
    <strong style={{ display: 'block', color, fontSize: '8px' }}>{issue.title}</strong>
    <span style={{ display: 'block', marginTop: 3, color: 'var(--text)', fontSize: '7px', lineHeight: 1.45 }}>{issue.message}</span>
  </div>;
}

export function BookingDrawer({ day, jobs, preferred, onClose, onReserve, onApplySupportReflow }: Props) {
  const [crmCustomers, setCrmCustomers] = useState<BrowserCrmCustomerIdentity[]>(() => loadBrowserCrmCustomers());
  const [customerQuery, setCustomerQuery] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [crmSites, setCrmSites] = useState<BrowserCrmSiteIdentity[]>([]);
  const [customer, setCustomer] = useState('');
  const [site, setSite] = useState('');
  const [sector, setSector] = useState('Noord');
  const [presetId, setPresetId] = useState<WorkPresetId>('standard_service');
  const [quantityInput, setQuantityInput] = useState('1');
  const [restriction, setRestriction] = useState('any');
  const [technicianInstructions, setTechnicianInstructions] = useState('');
  const [selected, setSelected] = useState<CandidateSlot | null>(null);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const selectedCustomer = crmCustomers.find((item) => item.id === customerId);
  const parsedQuantity = Number(quantityInput);
  const quantityValid = quantityInput.trim() !== '' && Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= 14;
  const quantity = quantityValid ? parsedQuantity : 1;
  const customerMatches = useMemo(() => {
    const query = customerQuery.trim().toLowerCase();
    if (!query) return crmCustomers.slice(0, 6);
    return crmCustomers.filter((item) => [item.name, item.phone, item.email].some((value) => (value ?? '').toLowerCase().includes(query))).slice(0, 8);
  }, [crmCustomers, customerQuery]);
  const request = useMemo<BookingRequest>(() => ({
    customer,
    site,
    sector,
    presetId,
    quantity,
    restriction: restriction === 'morning' ? { halfDay: 'am' } : restriction === 'afternoon' ? { halfDay: 'pm' } : restriction === 'after10' ? { notBefore: '10:00' } : restriction === 'after2' ? { notBefore: '14:00' } : undefined,
  }), [customer, site, sector, presetId, quantity, restriction]);
  const slots = useMemo(() => {
    if (!customerId || !siteId || !quantityValid) return [];
    const options = findCandidateSlotsForDay(day, request, jobs);
    return [...options].sort((a, b) => {
      const aPreferred = Number(Boolean(preferred.vanId && a.vanId === preferred.vanId && preferred.start && a.start === preferred.start));
      const bPreferred = Number(Boolean(preferred.vanId && b.vanId === preferred.vanId && preferred.start && b.start === preferred.start));
      return bPreferred - aPreferred || b.score - a.score;
    });
  }, [customerId, day, jobs, preferred.start, preferred.vanId, quantityValid, request, siteId]);
  const reflowPlans = useMemo(() => {
    if (!customerId || !siteId || !quantityValid || slots.length) return [];
    const plans = findSupportReflowPlansForDay(day, request, jobs);
    return [...plans].sort((a, b) => {
      const aPreferred = Number(Boolean(preferred.vanId && a.vanId === preferred.vanId));
      const bPreferred = Number(Boolean(preferred.vanId && b.vanId === preferred.vanId));
      return bPreferred - aPreferred || b.score - a.score;
    });
  }, [customerId, day, jobs, preferred.vanId, quantityValid, request, siteId, slots.length]);
  const liveIssues = useMemo(() => {
    if (!customerId || !siteId) return [];
    return diagnoseBookingRequest({ request, jobs, preferred, candidateSlots: slots, quantityValid });
  }, [customerId, jobs, preferred, quantityValid, request, siteId, slots]);
  const propertyIssues = liveIssues.filter((issue) => issue.field === 'property');
  const quantityIssues = liveIssues.filter((issue) => issue.field === 'quantity' || issue.field === 'support');
  const slotIssues = liveIssues.filter((issue) => issue.field === 'slot');

  useEffect(() => {
    if (!preferred.vanId || !preferred.start) return;
    const exact = slots.find((slot) => slot.vanId === preferred.vanId && slot.start === preferred.start);
    setSelected(exact ?? null);
  }, [preferred.start, preferred.vanId, slots]);

  const chooseCustomer = (id: string) => {
    setSelected(null);
    setCustomerId(id);
    setSiteId('');
    const crmCustomer = crmCustomers.find((item) => item.id === id);
    if (!crmCustomer) {
      setCustomer('');
      setSite('');
      setCrmSites([]);
      return;
    }
    const nextMaster = loadBrowserCustomerMaster(id);
    const sites = nextMaster.sites ?? [];
    const firstSite = sites[0];
    setCustomer(crmCustomer.name);
    setCustomerQuery(crmCustomer.name);
    setCrmSites(sites);
    if (firstSite) {
      setSiteId(firstSite.id);
      setSite(firstSite.name);
      setSector(sectorFromCrm(crmCustomer, firstSite) ?? sector);
    } else {
      setSite('');
      setSector(sectorFromCrm(crmCustomer) ?? sector);
    }
  };

  const chooseSite = (id: string) => {
    setSelected(null);
    setSiteId(id);
    const crmSite = crmSites.find((item) => item.id === id);
    if (!crmSite) {
      setSite('');
      return;
    }
    setSite(crmSite.name);
    setSector(sectorFromCrm(selectedCustomer, crmSite) ?? sector);
  };

  const chooseCreatedCustomer = (result: QuickCustomerCreateResult) => {
    const sites = result.master.sites ?? [];
    const primary = sites.find((item) => item.id === result.primarySiteId) ?? sites[0];
    setCustomerId(result.customer.id);
    setCustomer(result.customer.name);
    setCustomerQuery(result.customer.name);
    setCrmSites(sites);
    setSiteId(primary?.id ?? '');
    setSite(primary?.name ?? '');
    setSector(sectorFromCrm(result.customer, primary) ?? 'Noord');
    setSelected(null);
  };

  const createCustomer = (result: QuickCustomerCreateResult) => {
    const nextCustomers = [result.customer, ...crmCustomers.filter((item) => item.id !== result.customer.id)];
    saveBrowserValue(browserKeys.customers, nextCustomers);
    saveBrowserValue(browserKeys.customerMaster(result.customer.id), result.master);
    setCrmCustomers(nextCustomers);
    setCustomerCreateOpen(false);
    chooseCreatedCustomer(result);
  };

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true">
      <header className={styles.drawerHeader}><div><span>New appointment · {day.weekday} {day.shortDate}</span><h2>Find a valid work spot</h2><p>Search the CRM relationship first. The deterministic scheduler then controls van, sector, duration, restrictions and support capacity.</p></div><button type="button" onClick={onClose}>×</button></header>
      <div className={styles.drawerBody}>
        <section className={styles.formSection}><header><strong>1 · Customer & property</strong><span>One CRM customer can have multiple properties and contacts.</span></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>CRM customer search</span><input value={customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); if (customerId) { setCustomerId(''); setCustomer(''); setSiteId(''); setSite(''); setCrmSites([]); setSelected(null); } }} placeholder="Start typing customer name..." /></label>
            <div className={styles.wide} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><span style={{ color: 'var(--muted)' }}>{selectedCustomer ? `${selectedCustomer.id} · ${selectedCustomer.name}` : `${customerMatches.length} CRM match${customerMatches.length === 1 ? '' : 'es'}`}</span><button type="button" className={styles.secondary} onClick={() => setCustomerCreateOpen(true)}>+ Add Customer</button></div>
          </div>
          {!selectedCustomer ? <div className={styles.slotOptions}>{customerMatches.length ? customerMatches.map((item) => <button type="button" key={item.id} className={styles.slotOption} onClick={() => chooseCustomer(item.id)}><div><strong>{item.name}</strong><span>{item.location || item.type || 'Customer'} · {item.phone || 'No phone'}</span></div><b>Select</b><small>{item.email || item.id}</small></button>) : <div className={styles.noSlots}><strong>No customer found</strong><p>Create the CRM relationship instead of booking an unregistered duplicate.</p><button type="button" className={styles.secondary} onClick={() => setCustomerCreateOpen(true)}>+ Add Customer</button></div>}</div> : <div className={styles.descriptionPreview}><span>SELECTED CRM CUSTOMER</span><strong>{selectedCustomer.name}</strong><small>{selectedCustomer.phone || 'No phone'} · {selectedCustomer.email || 'No email'}</small></div>}
          {customerId ? <div className={styles.formGrid}><label className={styles.wide}><span>Registered property</span><select value={siteId} onChange={(event) => chooseSite(event.target.value)}><option value="">Select a property</option>{crmSites.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.address}</option>)}</select></label><label><span>DEMAC sector</span><select value={sector} onChange={(event) => { setSector(event.target.value); setSelected(null); }}><option>Noord</option><option>Palm Beach</option><option>Oranjestad</option><option>Santa Cruz</option><option>Paradera</option><option>San Nicolas</option><option>Savaneta</option></select></label>{!crmSites.length ? <div className={`${styles.wide} ${styles.noSlots}`}><strong>No registered property</strong><p>Add a property in Customer 360 before booking this existing customer.</p></div> : null}</div> : null}
          {propertyIssues.map((issue) => <LiveIssue issue={issue} key={issue.code} />)}
        </section>

        <section className={styles.formSection}><header><strong>2 · Work & restrictions</strong><span>Changing these values recalculates valid slots.</span></header><div className={styles.formGrid}>
          <label className={styles.wide}><span>Work type</span><select value={presetId} onChange={(event) => { setPresetId(event.target.value as WorkPresetId); setSelected(null); }}>{defaultWorkPresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label>
          <label><span>Number of A/C units</span><input type="number" min={1} max={14} value={quantityInput} onChange={(event) => { const next = event.target.value; if (/^\d*$/.test(next)) { setQuantityInput(next); setSelected(null); } }} /></label>
          <label><span>Customer restriction</span><select value={restriction} onChange={(event) => { setRestriction(event.target.value); setSelected(null); }}><option value="any">No time restriction</option><option value="morning">Morning only</option><option value="afternoon">Afternoon only</option><option value="after10">After 10:00 AM</option><option value="after2">After 2:00 PM</option></select></label>
        </div>
        {quantityIssues.map((issue) => <LiveIssue issue={issue} key={issue.code} />)}
        <div className={styles.descriptionPreview}><span>CUSTOMER-FACING DESCRIPTION</span><strong>{customerId && siteId && quantityValid ? customerFacingDescription(request) : quantityValid ? 'Select a CRM customer and service property first.' : 'Enter a valid A/C quantity from 1 to 14.'}</strong><small>Technician-only instructions remain separate.</small></div><label className={styles.instructions}><span>Technician instructions</span><textarea rows={3} value={technicianInstructions} onChange={(event) => setTechnicianInstructions(event.target.value)} placeholder="Internal access, preparation or technical instructions..." /></label></section>

        <section className={styles.formSection}><header><strong>3 · Valid ERP options</strong><span>{preferred.vanId && preferred.start ? `Requested visual spot: ${preferred.vanId.replace('VAN-', 'Van ')} · ${formatTime(preferred.start)}` : 'Choose one of the valid calculated options.'}</span></header>
          {slotIssues.map((issue) => <LiveIssue issue={issue} key={issue.code} />)}
          <div className={styles.slotOptions}>
          {!customerId || !siteId ? <div className={styles.noSlots}><strong>Customer and property required</strong><p>Choose the CRM relationship and exact service property before the ERP calculates route-aware capacity.</p></div> : !quantityValid ? <div className={styles.noSlots}><strong>Valid A/C quantity required</strong><p>Enter a whole number from 1 to 14. The field can be temporarily blank while typing.</p></div> : slots.length ? slots.map((slot) => <button type="button" key={`${slot.vanId}-${slot.start}-${slot.supportVanId ?? ''}-${slot.supportStart ?? ''}`} className={`${styles.slotOption} ${selected === slot ? styles.slotOptionSelected : ''}`} onClick={() => setSelected(slot)}><div><strong>{slot.vanId.replace('VAN-', 'Van ')} · {formatTime(slot.start)}–{formatTime(slot.end)}</strong><span>{slot.sector}{slot.supportVanId ? ` · support ${slot.supportVanId.replace('VAN-', 'Van ')}${slot.supportStart ? ` ${formatTime(slot.supportStart)}–${formatTime(slot.supportEnd ?? slot.end)}` : ''}` : ''}</span></div><b>{slot.score}</b><small>{slot.reasons.join(' · ') || 'Valid capacity'}</small></button>) : reflowPlans.length ? <>
            <div className={styles.noSlots} style={{ borderLeft: '3px solid var(--brand)', background: 'var(--brand-soft)' }}><strong>Booking Intelligence found recoverable capacity</strong><p>The day has enough total capacity, but it is fragmented. A support-only assignment can move without changing its primary customer appointment. Apply one recommendation below, then reserve the newly unlocked block.</p></div>
            {reflowPlans.map((plan) => <button type="button" key={plan.id} className={styles.slotOption} onClick={() => { setSelected(null); onApplySupportReflow(plan); }}><div><strong>Recover {plan.vanId.replace('VAN-', 'Van ')} · move support {formatTime(plan.fromStart)} → {formatTime(plan.toStart)}</strong><span>{plan.customer} · {plan.quantity} support unit{plan.quantity === 1 ? '' : 's'} · {plan.sector}</span></div><b>APPLY</b><small>Unlocks {formatTime(plan.unlockedSlot.start)}–{formatTime(plan.unlockedSlot.end)} for this request · Primary appointment remains unchanged · {plan.reasons.join(' · ')}</small></button>)}
          </> : <div className={styles.noSlots}><strong>No valid capacity for this request</strong><p>Review the live validation messages above. ERP Next also checked whether support-only assignments could be safely rearranged, but no route-safe recovery plan was available.</p></div>}
        </div></section>
      </div>
      <footer className={styles.drawerFooter}><div>{selected ? <><span>Selected</span><strong>{selected.vanId.replace('VAN-', 'Van ')} · {formatTime(selected.start)}{selected.supportVanId ? ` + ${selected.supportVanId.replace('VAN-', 'Van ')} support` : ''}</strong></> : <span>Select a valid work spot.</span>}</div><div><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button type="button" className={styles.primary} disabled={!selected || !customerId || !siteId || !quantityValid} onClick={() => selected && onReserve(request, selected, technicianInstructions, { customerId, siteId })}>Temporary hold</button></div></footer>
    </aside>
    <QuickCustomerOnboarding open={customerCreateOpen} existingCustomers={crmCustomers} onClose={() => setCustomerCreateOpen(false)} onUseExisting={(id) => { setCustomerCreateOpen(false); chooseCustomer(id); }} onCreate={createCustomer} />
  </div>;
}
