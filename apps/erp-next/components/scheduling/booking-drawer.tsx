'use client';

import { useEffect, useMemo, useState } from 'react';
import { createBookingOffer, validateBookingOffer, type BookingOffer } from '../../lib/booking-intelligence/booking-offer';
import { bookingRestrictionFromConstraints, type BookingConstraintState } from '../../lib/booking-intelligence/constraints';
import { normalizeIdentityText, normalizePhoneKey } from '../../lib/booking-intelligence/identity';
import { rankRouteAwareCandidates } from '../../lib/booking-intelligence/route-ranking';
import { loadBrowserCrmCustomers, loadBrowserCustomerMaster, sectorFromCrm, type BrowserCrmCustomerIdentity, type BrowserCrmSiteIdentity } from '../../lib/browser-crm';
import { diagnoseBookingRequest, type BookingLiveIssue } from '../../lib/scheduling-booking-diagnostics';
import { browserKeys, saveBrowserValue } from '../../lib/browser-store';
import type { BookingRequest, BookingWorkLine, CandidateSlot, WorkPresetId } from '../../lib/scheduling';
import { customerFacingDescription, defaultWorkPresets } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay, SupportReflowPlan } from '../../lib/scheduling-capacity';
import { findCandidateSlotsForDay, findSupportReflowPlansForDay } from '../../lib/scheduling-capacity';
import { QuickCustomerOnboarding, type QuickCustomerCreateResult, type QuickExistingPropertyResult } from './quick-customer-onboarding';
import styles from './scheduling-overview-v2.module.css';

export type BookingIdentity = { customerId?: string; siteId?: string };
export type PreferredSlot = { vanId?: string; start?: string };

type WorkLineDraft = { id: string; presetId: WorkPresetId; quantityInput: string };

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

function workLine(index: number): WorkLineDraft {
  return { id: `work-${Date.now()}-${index}`, presetId: 'standard_service', quantityInput: '1' };
}

function restrictionState(value: string): BookingConstraintState {
  if (value === 'morning') return { halfDay: 'am' };
  if (value === 'afternoon') return { halfDay: 'pm' };
  if (value === 'after10') return { notBefore: '10:00' };
  if (value === 'after2') return { notBefore: '14:00' };
  return {};
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
  const [workLines, setWorkLines] = useState<WorkLineDraft[]>([workLine(0)]);
  const [restriction, setRestriction] = useState('any');
  const [technicianInstructions, setTechnicianInstructions] = useState('');
  const [selected, setSelected] = useState<CandidateSlot | null>(null);
  const [selectedOffer, setSelectedOffer] = useState<BookingOffer | null>(null);
  const [offerNotice, setOfferNotice] = useState<string | null>(null);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const selectedCustomer = crmCustomers.find((item) => item.id === customerId);

  const parsedWorkLines = useMemo<BookingWorkLine[]>(() => workLines.map((line) => ({
    id: line.id,
    presetId: line.presetId,
    quantity: Number(line.quantityInput),
  })), [workLines]);
  const scopeValid = parsedWorkLines.length > 0 && parsedWorkLines.every((line) => Number.isInteger(line.quantity) && line.quantity >= 1 && line.quantity <= 14);
  const safeWorkLines = parsedWorkLines.map((line) => ({ ...line, quantity: Number.isInteger(line.quantity) && line.quantity >= 1 ? line.quantity : 1 }));
  const totalQuantity = safeWorkLines.reduce((sum, line) => sum + line.quantity, 0);
  const primaryLine = safeWorkLines[0] ?? { id: 'work-fallback', presetId: 'standard_service' as WorkPresetId, quantity: 1 };

  const customerMatches = useMemo(() => {
    const query = customerQuery.trim();
    if (!query) return crmCustomers.slice(0, 6);
    const text = normalizeIdentityText(query);
    const phone = normalizePhoneKey(query);
    return crmCustomers.filter((item) => (
      normalizeIdentityText(item.name).includes(text)
      || normalizeIdentityText(item.email).includes(text)
      || Boolean(phone && normalizePhoneKey(item.phone).includes(phone))
    )).slice(0, 8);
  }, [crmCustomers, customerQuery]);

  const request = useMemo<BookingRequest>(() => ({
    customer,
    site,
    sector,
    presetId: primaryLine.presetId,
    quantity: totalQuantity,
    workLines: safeWorkLines,
    restriction: bookingRestrictionFromConstraints(restrictionState(restriction)),
  }), [customer, primaryLine.presetId, restriction, safeWorkLines, sector, site, totalQuantity]);

  const slots = useMemo(() => {
    if (!customerId || !siteId || !scopeValid) return [];
    const options = rankRouteAwareCandidates({
      slots: findCandidateSlotsForDay(day, request, jobs),
      request,
      jobs,
      officeSector: 'Santa Cruz',
    });
    return [...options].sort((a, b) => {
      const aPreferred = Number(Boolean(preferred.vanId && a.vanId === preferred.vanId && preferred.start && a.start === preferred.start));
      const bPreferred = Number(Boolean(preferred.vanId && b.vanId === preferred.vanId && preferred.start && b.start === preferred.start));
      return bPreferred - aPreferred || b.score - a.score;
    });
  }, [customerId, day, jobs, preferred.start, preferred.vanId, request, scopeValid, siteId]);

  const reflowPlans = useMemo(() => {
    if (!customerId || !siteId || !scopeValid || slots.length) return [];
    const plans = findSupportReflowPlansForDay(day, request, jobs);
    return [...plans].sort((a, b) => {
      const aPreferred = Number(Boolean(preferred.vanId && a.vanId === preferred.vanId));
      const bPreferred = Number(Boolean(preferred.vanId && b.vanId === preferred.vanId));
      return bPreferred - aPreferred || b.score - a.score;
    });
  }, [customerId, day, jobs, preferred.vanId, request, scopeValid, siteId, slots.length]);

  const liveIssues = useMemo(() => {
    if (!customerId || !siteId) return [];
    return diagnoseBookingRequest({ request, jobs, preferred, candidateSlots: slots, quantityValid: scopeValid });
  }, [customerId, jobs, preferred, request, scopeValid, siteId, slots]);
  const propertyIssues = liveIssues.filter((issue) => issue.field === 'property');
  const quantityIssues = liveIssues.filter((issue) => issue.field === 'quantity' || issue.field === 'support');
  const slotIssues = liveIssues.filter((issue) => issue.field === 'slot');

  useEffect(() => {
    if (!preferred.vanId || !preferred.start) return;
    const exact = slots.find((slot) => slot.vanId === preferred.vanId && slot.start === preferred.start);
    setSelected(exact ?? null);
    setSelectedOffer(exact ? createBookingOffer({ dayKey: day.dateKey, request, slot: exact, jobs }) : null);
  }, [day.dateKey, jobs, preferred.start, preferred.vanId, request, slots]);

  const clearSelection = () => {
    setSelected(null);
    setSelectedOffer(null);
    setOfferNotice(null);
  };

  const chooseCustomer = (id: string, preferredSiteId?: string) => {
    clearSelection();
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
    const firstSite = sites.find((item) => item.id === preferredSiteId) ?? sites[0];
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
    clearSelection();
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
    clearSelection();
  };

  const createCustomer = (result: QuickCustomerCreateResult) => {
    const nextCustomers = [result.customer, ...crmCustomers.filter((item) => item.id !== result.customer.id)];
    saveBrowserValue(browserKeys.customers, nextCustomers);
    saveBrowserValue(browserKeys.customerMaster(result.customer.id), result.master);
    setCrmCustomers(nextCustomers);
    setCustomerCreateOpen(false);
    chooseCreatedCustomer(result);
  };

  const addPropertyToExisting = (result: QuickExistingPropertyResult) => {
    const currentMaster = loadBrowserCustomerMaster(result.customerId);
    const sites = [result.site, ...(currentMaster.sites ?? []).filter((item) => item.id !== result.site.id)];
    saveBrowserValue(browserKeys.customerMaster(result.customerId), { ...currentMaster, sites });
    const nextCustomers = crmCustomers.map((item) => item.id === result.customerId ? { ...item, sites: sites.length, location: result.site.sector ?? item.location } : item);
    saveBrowserValue(browserKeys.customers, nextCustomers);
    setCrmCustomers(nextCustomers);
    setCustomerCreateOpen(false);
    const customerRecord = nextCustomers.find((item) => item.id === result.customerId);
    setCustomerId(result.customerId);
    setCustomer(customerRecord?.name ?? '');
    setCustomerQuery(customerRecord?.name ?? '');
    setCrmSites(sites);
    setSiteId(result.site.id);
    setSite(result.site.name);
    setSector(sectorFromCrm(customerRecord, result.site) ?? result.site.sector ?? 'Noord');
    clearSelection();
  };

  const updateWorkLine = (id: string, patch: Partial<WorkLineDraft>) => {
    setWorkLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
    clearSelection();
  };

  const chooseSlot = (slot: CandidateSlot) => {
    setSelected(slot);
    setSelectedOffer(createBookingOffer({ dayKey: day.dateKey, request, slot, jobs }));
    setOfferNotice(null);
  };

  const reserveSelected = () => {
    if (!selected || !selectedOffer || !customerId || !siteId || !scopeValid) return;
    const currentCandidates = rankRouteAwareCandidates({ slots: findCandidateSlotsForDay(day, request, jobs), request, jobs, officeSector: 'Santa Cruz' });
    const validation = validateBookingOffer({ offer: selectedOffer, request, currentJobs: jobs, currentCandidates });
    if (!validation.valid || !validation.replacement) {
      clearSelection();
      setOfferNotice('That work spot changed before the hold was committed. Booking Intelligence recalculated the schedule; choose one of the current valid options.');
      return;
    }
    if (validation.reason === 'schedule_changed') setOfferNotice('The schedule changed, but this exact work spot remains valid after revalidation. The latest schedule state will be used.');
    onReserve(request, validation.replacement, technicianInstructions, { customerId, siteId });
  };

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true">
      <header className={styles.drawerHeader}><div><span>New appointment · {day.weekday} {day.shortDate}</span><h2>Find the best valid work spot</h2><p>CRM identity, exact property, work scope, route, customer restrictions and van capacity are evaluated by one deterministic booking core.</p></div><button type="button" onClick={onClose}>×</button></header>
      <div className={styles.drawerBody}>
        {offerNotice ? <div className={styles.noSlots} style={{ margin: '0 11px 9px', borderLeft: '3px solid var(--warning)' }}><strong>Booking state updated</strong><p>{offerNotice}</p></div> : null}
        <section className={styles.formSection}><header><strong>1 · Customer & property</strong><span>One CRM customer can have multiple properties and contacts.</span></header>
          <div className={styles.formGrid}>
            <label className={styles.wide}><span>CRM customer search</span><input value={customerQuery} onChange={(event) => { setCustomerQuery(event.target.value); if (customerId) { setCustomerId(''); setCustomer(''); setSiteId(''); setSite(''); setCrmSites([]); clearSelection(); } }} placeholder="Name, phone / WhatsApp, or email..." /></label>
            <div className={styles.wide} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><span style={{ color: 'var(--muted)' }}>{selectedCustomer ? `${selectedCustomer.id} · ${selectedCustomer.name}` : `${customerMatches.length} CRM match${customerMatches.length === 1 ? '' : 'es'}`}</span><button type="button" className={styles.secondary} onClick={() => setCustomerCreateOpen(true)}>+ Add Customer / Property</button></div>
          </div>
          {!selectedCustomer ? <div className={styles.slotOptions}>{customerMatches.length ? customerMatches.map((item) => <button type="button" key={item.id} className={styles.slotOption} onClick={() => chooseCustomer(item.id)}><div><strong>{item.name}</strong><span>{item.location || item.type || 'Customer'} · {item.phone || 'No phone'}</span></div><b>Select</b><small>{item.email || item.id}</small></button>) : <div className={styles.noSlots}><strong>No customer found</strong><p>Create the CRM relationship instead of booking an unregistered duplicate.</p><button type="button" className={styles.secondary} onClick={() => setCustomerCreateOpen(true)}>+ Add Customer / Property</button></div>}</div> : <div className={styles.descriptionPreview}><span>SELECTED CRM CUSTOMER</span><strong>{selectedCustomer.name}</strong><small>{selectedCustomer.phone || 'No phone'} · {selectedCustomer.email || 'No email'}</small></div>}
          {customerId ? <div className={styles.formGrid}><label className={styles.wide}><span>Registered property</span><select value={siteId} onChange={(event) => chooseSite(event.target.value)}><option value="">Select a property</option>{crmSites.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.address}</option>)}</select></label><label><span>DEMAC sector</span><select value={sector} onChange={(event) => { setSector(event.target.value); clearSelection(); }}><option>Noord</option><option>Palm Beach</option><option>Oranjestad</option><option>Santa Cruz</option><option>Paradera</option><option>San Nicolas</option><option>Savaneta</option></select></label>{!crmSites.length ? <div className={`${styles.wide} ${styles.noSlots}`}><strong>No registered property</strong><p>Add the new property here without leaving the booking flow.</p><button type="button" className={styles.secondary} onClick={() => setCustomerCreateOpen(true)}>+ Add Property to Existing Customer</button></div> : null}</div> : null}
          {propertyIssues.map((issue) => <LiveIssue issue={issue} key={issue.code} />)}
        </section>

        <section className={styles.formSection}><header><strong>2 · Appointment scope & restrictions</strong><span>One customer visit can contain multiple different work lines. ERP calculates the combined continuous duration.</span></header>
          <div style={{ display: 'grid', gap: 8 }}>{workLines.map((line, index) => <div className={styles.formGrid} key={line.id} style={{ padding: 9, border: '1px solid var(--border)', borderRadius: 9 }}>
            <label className={styles.wide}><span>Work line {index + 1}</span><select value={line.presetId} onChange={(event) => updateWorkLine(line.id, { presetId: event.target.value as WorkPresetId })}>{defaultWorkPresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label>
            <label><span>Quantity</span><input type="number" min={1} max={14} value={line.quantityInput} onChange={(event) => { const next = event.target.value; if (/^\d*$/.test(next)) updateWorkLine(line.id, { quantityInput: next }); }} /></label>
            <div style={{ display: 'flex', alignItems: 'end' }}>{workLines.length > 1 ? <button type="button" className={styles.secondary} onClick={() => { setWorkLines((current) => current.filter((item) => item.id !== line.id)); clearSelection(); }}>Remove line</button> : null}</div>
          </div>)}</div>
          <div style={{ margin: '9px 11px', display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" className={styles.secondary} onClick={() => { setWorkLines((current) => [...current, workLine(current.length)]); clearSelection(); }}>+ Add another work type</button><label style={{ minWidth: 180 }}><span>Customer restriction</span><select value={restriction} onChange={(event) => { setRestriction(event.target.value); clearSelection(); }}><option value="any">No time restriction</option><option value="morning">Morning only</option><option value="afternoon">Afternoon only</option><option value="after10">After 10:00 AM</option><option value="after2">After 2:00 PM</option></select></label></div>
          {quantityIssues.map((issue) => <LiveIssue issue={issue} key={issue.code} />)}
          <div className={styles.descriptionPreview}><span>CUSTOMER-FACING APPOINTMENT SCOPE</span><strong>{customerId && siteId && scopeValid ? customerFacingDescription(request) : scopeValid ? 'Select a CRM customer and service property first.' : 'Review the quantity on every work line.'}</strong><small>{safeWorkLines.length} work line{safeWorkLines.length === 1 ? '' : 's'} · {totalQuantity} total item/unit count. Technician-only instructions remain separate.</small></div>
          <label className={styles.instructions}><span>Technician instructions</span><textarea rows={3} value={technicianInstructions} onChange={(event) => setTechnicianInstructions(event.target.value)} placeholder="Internal access, preparation or technical instructions..." /></label>
        </section>

        <section className={styles.formSection}><header><strong>3 · Best valid ERP options</strong><span>{preferred.vanId && preferred.start ? `Requested visual spot: ${preferred.vanId.replace('VAN-', 'Van ')} · ${formatTime(preferred.start)}` : 'Hard constraints are checked first; valid choices are then ranked for route efficiency.'}</span></header>
          {slotIssues.map((issue) => <LiveIssue issue={issue} key={issue.code} />)}
          <div className={styles.slotOptions}>
          {!customerId || !siteId ? <div className={styles.noSlots}><strong>Customer and property required</strong><p>Choose the CRM relationship and exact service property before the ERP calculates route-aware capacity.</p></div> : !scopeValid ? <div className={styles.noSlots}><strong>Valid work scope required</strong><p>Every work line needs a whole-number quantity from 1 to 14.</p></div> : slots.length ? slots.map((slot, index) => <button type="button" key={`${slot.vanId}-${slot.start}-${slot.supportVanId ?? ''}-${slot.supportStart ?? ''}`} className={`${styles.slotOption} ${selected === slot ? styles.slotOptionSelected : ''}`} onClick={() => chooseSlot(slot)}><div><strong>{index === 0 ? 'BEST ROUTE · ' : ''}{slot.vanId.replace('VAN-', 'Van ')} · {formatTime(slot.start)}–{formatTime(slot.end)}</strong><span>{slot.sector}{slot.supportVanId ? ` · support ${slot.supportVanId.replace('VAN-', 'Van ')}${slot.supportStart ? ` ${formatTime(slot.supportStart)}–${formatTime(slot.supportEnd ?? slot.end)}` : ''}` : ''}</span></div><b>{slot.score}</b><small>{slot.reasons.join(' · ') || 'Valid capacity'}</small></button>) : reflowPlans.length ? <>
            <div className={styles.noSlots} style={{ borderLeft: '3px solid var(--brand)', background: 'var(--brand-soft)' }}><strong>Booking Intelligence found recoverable capacity</strong><p>The day has enough total capacity, but it is fragmented. A support-only assignment can move without changing its primary customer appointment.</p></div>
            {reflowPlans.map((plan) => <button type="button" key={plan.id} className={styles.slotOption} onClick={() => { clearSelection(); onApplySupportReflow(plan); }}><div><strong>Recover {plan.vanId.replace('VAN-', 'Van ')} · move support {formatTime(plan.fromStart)} → {formatTime(plan.toStart)}</strong><span>{plan.customer} · {plan.quantity} support unit{plan.quantity === 1 ? '' : 's'} · {plan.sector}</span></div><b>APPLY</b><small>Unlocks {formatTime(plan.unlockedSlot.start)}–{formatTime(plan.unlockedSlot.end)} · Primary appointment remains unchanged · {plan.reasons.join(' · ')}</small></button>)}
          </> : <div className={styles.noSlots}><strong>No valid capacity for this request</strong><p>ERP checked duration, route, lunch, return buffer, customer restrictions, linked support and safe support reflow. No valid work spot is currently available on this day.</p></div>}
        </div></section>
      </div>
      <footer className={styles.drawerFooter}><div>{selected ? <><span>Selected · revalidated on commit</span><strong>{selected.vanId.replace('VAN-', 'Van ')} · {formatTime(selected.start)}{selected.supportVanId ? ` + ${selected.supportVanId.replace('VAN-', 'Van ')} support` : ''}</strong></> : <span>Select a valid work spot.</span>}</div><div><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button type="button" className={styles.primary} disabled={!selected || !selectedOffer || !customerId || !siteId || !scopeValid} onClick={reserveSelected}>Temporary hold</button></div></footer>
    </aside>
    <QuickCustomerOnboarding open={customerCreateOpen} existingCustomers={crmCustomers} onClose={() => setCustomerCreateOpen(false)} onUseExisting={(id) => { setCustomerCreateOpen(false); chooseCustomer(id); }} onUseExistingWithProperty={addPropertyToExisting} onCreate={createCustomer} />
  </div>;
}
