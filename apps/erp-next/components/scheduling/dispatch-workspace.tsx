'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadBrowserCrmCustomers, loadBrowserCustomerMaster, sectorFromCrm, type BrowserCrmCustomerIdentity, type BrowserCrmSiteIdentity } from '../../lib/browser-crm';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import { createBrowserWorkOrder, type BrowserAppointmentRecord, type BrowserWorkOrderRecord } from '../../lib/browser-operational';
import type { BookingRequest, CandidateSlot, DispatchJob, WorkPresetId } from '../../lib/scheduling';
import { customerFacingDescription, defaultWorkPresets, evaluateReadiness, getHalfDayAnchor, previewVans } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay } from '../../lib/scheduling-capacity';
import { buildOperationalWeek, currentArubaDateKey, findCandidateSlotsForDay, jobsForDate, weekCapacity } from '../../lib/scheduling-capacity';
import styles from './dispatch-board.module.css';
import weekStyles from './dispatch-workspace.module.css';

type BookingIdentity = { customerId?: string; siteId?: string };

function seedJobs(today: string, week: OperationalDay[]): CalendarDispatchJob[] {
  const nextOpen = week.find((day) => day.dateKey !== today && day.isOpen)?.dateKey ?? today;
  return [
    { dateKey: today, id: 'WO-2184', customer: 'John Smith', site: 'Noord Residence', sector: 'Noord', start: '08:30', end: '09:30', segment: 'am', vanId: 'VAN-1', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2188', customer: 'Maria Croes', site: 'Noord Apartment', sector: 'Noord', start: '09:30', end: '10:30', segment: 'am', vanId: 'VAN-1', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2196', customer: 'Palm Beach Villas', site: 'Villa 12', sector: 'Palm Beach', start: '13:30', end: '15:00', segment: 'pm', vanId: 'VAN-1', presetId: 'repair', quantity: 1, status: 'confirmed', readiness: 'at_risk', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2185', customer: 'ABC Aruba N.V.', site: 'Oranjestad Office', sector: 'Oranjestad', start: '08:30', end: '10:30', segment: 'am', vanId: 'VAN-2', presetId: 'deep_cleaning', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2191', customer: 'Ocean View Villas', site: 'Palm Beach Property', sector: 'Palm Beach', start: '13:30', end: '14:30', segment: 'pm', vanId: 'VAN-2', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2186', customer: 'Renaissance Engineering', site: 'Oranjestad Hotel', sector: 'Oranjestad', start: '08:30', end: '09:15', segment: 'am', vanId: 'VAN-3', presetId: 'diagnostic', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2190', customer: 'Commercial Client', site: 'Oranjestad Site B', sector: 'Oranjestad', start: '10:30', end: '11:30', segment: 'am', vanId: 'VAN-3', presetId: 'standard_service', quantity: 1, status: 'temporary_hold', readiness: 'at_risk', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2194', customer: 'Santa Cruz Market', site: 'Santa Cruz', sector: 'Santa Cruz', start: '13:30', end: '15:00', segment: 'pm', vanId: 'VAN-3', presetId: 'repair', quantity: 1, status: 'confirmed', readiness: 'blocked', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2187', customer: 'Residential Client', site: 'Santa Cruz Home', sector: 'Santa Cruz', start: '08:30', end: '09:30', segment: 'am', vanId: 'VAN-4', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: today, id: 'WO-2192', customer: 'Paradera Residence', site: 'Paradera', sector: 'Paradera', start: '13:30', end: '14:30', segment: 'pm', vanId: 'VAN-4', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: nextOpen, id: 'WO-2201', customer: 'Future Booking', site: 'Noord Property', sector: 'Noord', start: '08:30', end: '09:30', segment: 'am', vanId: 'VAN-1', presetId: 'standard_service', quantity: 1, status: 'confirmed', readiness: 'ready', isPrimaryAssignment: true, customerCommunicationOwner: true },
    { dateKey: nextOpen, id: 'WO-2202', customer: 'Future Commercial', site: 'Oranjestad', sector: 'Oranjestad', start: '13:30', end: '15:00', segment: 'pm', vanId: 'VAN-3', presetId: 'repair', quantity: 1, status: 'confirmed', readiness: 'at_risk', isPrimaryAssignment: true, customerCommunicationOwner: true },
  ];
}

const readinessPreview = evaluateReadiness({ crewAssigned: true, requiredSkillAvailable: true, vanAssigned: true, routeCompatible: true, requiredToolsReady: true, requiredPartsReady: false, customerConfirmed: true, commercialClearance: true, accessConfirmed: false });

function labelTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function presetLabel(id: WorkPresetId) {
  return defaultWorkPresets.find((preset) => preset.id === id)?.label ?? 'Other work';
}

function readinessClass(value: DispatchJob['readiness']) {
  return value === 'ready' ? styles.ready : value === 'at_risk' ? styles.risk : value === 'blocked' ? styles.blocked : styles.neutral;
}

function appointmentAssignments(record: BrowserAppointmentRecord): CalendarDispatchJob[] {
  if (record.status === 'cancelled') return [];
  const status = record.status === 'confirmed' ? 'confirmed' : 'temporary_hold';
  return record.assignments.map((assignment) => ({ ...assignment, status }));
}

export function DispatchWorkspace() {
  const [calendar] = useState(() => {
    const today = currentArubaDateKey();
    return { today, week: buildOperationalWeek(today) };
  });
  const seededJobs = useMemo(() => seedJobs(calendar.today, calendar.week), [calendar]);
  const [activeDate, setActiveDate] = useState(calendar.today);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedVan, setSelectedVan] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setAppointments(loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []));
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    saveBrowserValue(browserKeys.appointments, appointments);
  }, [appointments, storageReady]);

  const jobs = useMemo(() => [...seededJobs, ...appointments.flatMap(appointmentAssignments)], [appointments, seededJobs]);
  const activeDay = calendar.week.find((day) => day.dateKey === activeDate) ?? calendar.week[0];
  const activeJobs = jobsForDate(jobs, activeDate);
  const capacity = weekCapacity(jobs, calendar.week);
  const confirmed = activeJobs.filter((job) => job.isPrimaryAssignment && job.status === 'confirmed').length;
  const holds = activeJobs.filter((job) => job.isPrimaryAssignment && job.status === 'temporary_hold').length;
  const attention = activeJobs.filter((job) => job.isPrimaryAssignment && (job.readiness === 'blocked' || job.readiness === 'at_risk')).length;

  const addAppointment = (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string, identity: BookingIdentity) => {
    const stamp = Date.now().toString();
    const appointmentId = `APT-${stamp.slice(-8)}`;
    const primaryId = `${appointmentId}-P`;
    const primaryQty = slot.primaryUnits ?? request.quantity;
    const primary: CalendarDispatchJob = { dateKey: activeDate, id: primaryId, customer: request.customer, site: request.site, sector: request.sector, start: slot.start, end: slot.end, segment: slot.segment, vanId: slot.vanId, presetId: request.presetId, quantity: primaryQty, status: 'temporary_hold', readiness: 'at_risk', isPrimaryAssignment: true, customerCommunicationOwner: true };
    const assignments: CalendarDispatchJob[] = [primary];
    if (slot.requiresSupportVan && slot.supportVanId) assignments.push({ ...primary, id: `${appointmentId}-S`, vanId: slot.supportVanId, quantity: slot.supportUnits ?? Math.max(1, request.quantity - primaryQty), isPrimaryAssignment: false, customerCommunicationOwner: false, supportForJobId: primaryId });
    const record: BrowserAppointmentRecord = { id: appointmentId, dateKey: activeDate, customerId: identity.customerId, siteId: identity.siteId, customer: request.customer, site: request.site, sector: request.sector, presetId: request.presetId, totalQuantity: request.quantity, customerFacingDescription: customerFacingDescription(request), technicianInstructions: technicianInstructions.trim() || undefined, status: 'temporary_hold', assignments, primaryVanId: slot.vanId, supportVanId: slot.supportVanId, createdAt: new Date().toISOString() };
    setAppointments((current) => [...current, record]);
    setDrawerOpen(false);
    setSelectedVan(slot.vanId);
    setNotice(`${record.customerFacingDescription} saved as ${record.id} on ${activeDay.weekday} ${activeDay.shortDate}. ${identity.customerId ? 'CRM customer identity linked. ' : 'Unregistered lead fallback used. '}${slot.requiresSupportVan ? 'Linked support van added with one customer communication owner.' : technicianInstructions ? 'Technician instructions remain internal.' : ''} The hold will survive refresh on this browser.`);
  };

  const confirmAppointment = (appointmentId: string) => {
    const current = appointments.find((appointment) => appointment.id === appointmentId);
    if (!current || current.status !== 'temporary_hold') return;
    const workOrderId = current.workOrderId ?? `WO-${appointmentId.replace(/^APT-/, '').slice(-6)}`;
    const confirmed: BrowserAppointmentRecord = { ...current, status: 'confirmed', workOrderId, confirmedAt: new Date().toISOString(), assignments: current.assignments.map((assignment) => ({ ...assignment, status: 'confirmed' })) };
    setAppointments((items) => items.map((item) => item.id === appointmentId ? confirmed : item));
    const workOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    if (!workOrders.some((order) => order.appointmentId === appointmentId)) saveBrowserValue(browserKeys.workOrders, [...workOrders, createBrowserWorkOrder(confirmed)]);
    setNotice(`${appointmentId} confirmed. ${workOrderId} was created without re-entering customer, site, work, van or technician instructions.${confirmed.customerId ? ' CRM IDs were preserved through the handoff.' : ''}${confirmed.supportVanId ? ' The support assignment remains linked and cannot send duplicate customer confirmations.' : ''}`);
  };

  const moveDay = (direction: -1 | 1) => {
    const index = calendar.week.findIndex((day) => day.dateKey === activeDate);
    const next = Math.max(0, Math.min(calendar.week.length - 1, index + direction));
    setActiveDate(calendar.week[next].dateKey);
    setSelectedVan(null);
  };

  return <section className={styles.page}>
    <header className={styles.pageHeader}><div><span className={styles.eyebrow}>Operations · Aruba</span><h1>Scheduling & Dispatch</h1><p>Capacity, geography, vans and readiness decide the schedule — not an unrestricted customer time picker.</p></div><div className={styles.pageActions}><button type="button" className={styles.secondary}>Capacity settings</button><button type="button" className={styles.primary} disabled={!activeDay.isOpen} onClick={() => setDrawerOpen(true)}>+ New appointment</button></div></header>
    {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

    <section className={weekStyles.weekStrip} aria-label="Operational week">
      {calendar.week.map((day) => {
        const summary = capacity.find((item) => item.dateKey === day.dateKey);
        const usage = day.isOpen ? Math.min(100, ((summary?.jobs ?? 0) / 16) * 100) : 0;
        return <button type="button" key={day.dateKey} disabled={!day.isOpen} className={`${weekStyles.dayCard} ${activeDate === day.dateKey ? weekStyles.dayActive : ''} ${day.isToday ? weekStyles.today : ''}`} onClick={() => { setActiveDate(day.dateKey); setSelectedVan(null); }}><div><span>{day.weekday}</span><strong>{day.shortDate}</strong>{day.isToday ? <b>TODAY</b> : null}</div><small>{day.shiftLabel}</small>{day.isOpen ? <><div className={weekStyles.capacityTrack}><i style={{ width: `${usage}%` }} /></div><em>{summary?.jobs ?? 0} assignments · {summary?.occupiedVans ?? 0}/4 vans</em></> : <em>Operationally closed</em>}</button>;
      })}
    </section>

    <div className={styles.metrics}><article><span>Confirmed</span><strong>{confirmed}</strong><small>{activeDay.weekday} {activeDay.shortDate}</small><i style={{ width: `${Math.min(100, confirmed / 24 * 100)}%` }} /></article><article><span>Temporary Holds</span><strong>{holds}</strong><small>Browser-persistent appointments</small><i style={{ width: `${Math.min(100, holds * 18)}%` }} /></article><article><span>Need Attention</span><strong className={attention ? styles.metricWarning : ''}>{attention}</strong><small>At risk or blocked</small><i style={{ width: `${Math.min(100, attention * 20)}%` }} /></article><article><span>Available Vans</span><strong>{Math.max(0, 4 - new Set(activeJobs.map((job) => job.vanId)).size)}</strong><small>{activeDay.shiftLabel}</small><i style={{ width: `${Math.max(0, 4 - new Set(activeJobs.map((job) => job.vanId)).size) / 4 * 100}%` }} /></article></div>

    <div className={styles.toolbar}><div className={styles.dayNav}><button type="button" onClick={() => moveDay(-1)}>‹</button><div><strong>{activeDay.isToday ? 'Today' : `${activeDay.weekday} · ${activeDay.shortDate}`}</strong><span>{activeDay.shiftLabel} · Aruba time</span></div><button type="button" onClick={() => moveDay(1)}>›</button></div><div className={styles.legend}><span><i className={styles.readyDot} /> Ready</span><span><i className={styles.riskDot} /> At risk</span><span><i className={styles.blockedDot} /> Blocked</span><span><i className={styles.holdDot} /> Hold</span></div></div>

    <div className={styles.layout}><main className={styles.board}><div className={styles.boardHeader}><div><strong>{activeDay.isOpen ? 'Live Dispatch Board' : 'Closed Operational Day'}</strong><span>{activeDay.isOpen ? `${activeDay.weekday} ${activeDay.shortDate} · ${activeDay.shiftLabel}` : 'No appointment capacity is offered for this day.'}</span></div><button type="button">Optimize route</button></div><div className={styles.vanGrid}>{previewVans.map((van) => {
      const vanJobs = activeJobs.filter((job) => job.vanId === van.id);
      const amAnchor = getHalfDayAnchor(activeJobs, van.id, 'am');
      const pmAnchor = getHalfDayAnchor(activeJobs, van.id, 'pm');
      return <section key={van.id} className={`${styles.vanLane} ${selectedVan === van.id ? styles.vanLaneSelected : ''}`}><header><div className={styles.vanIdentity}><span>{van.id.replace('VAN-', 'V')}</span><div><strong>{van.name}</strong><small>{van.team}</small></div></div><b>{activeDay.isOpen ? 'ACTIVE' : 'CLOSED'}</b></header><div className={styles.anchorBar}><div><span>AM anchor</span><strong>{amAnchor?.sector ?? 'Open'}</strong></div><div><span>PM anchor</span><strong>{pmAnchor?.sector ?? 'Open'}</strong></div></div><div className={styles.daySegments}><JobSegment label="Morning" jobs={vanJobs.filter((job) => job.segment === 'am' || job.segment === 'full_day')} onConfirm={confirmAppointment} />{activeDay.weekday !== 'Sat' ? <div className={styles.breakRow}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div> : null}<JobSegment label={activeDay.weekday === 'Sat' ? 'Remaining short shift' : 'Afternoon'} jobs={vanJobs.filter((job) => job.segment === 'pm' || job.segment === 'full_day')} onConfirm={confirmAppointment} /></div></section>;
    })}</div></main>

    <aside className={styles.sideRail}><section className={styles.sideCard}><div className={styles.sideTitle}><span>AI</span><div><strong>Booking Intelligence</strong><small>Deterministic facts first</small></div></div><div className={styles.insight}><b>Date-aware capacity</b><p>Changing the selected day changes the jobs evaluated by the booking engine. Holds on another date do not block today's capacity.</p></div><div className={styles.insight}><b>CRM-aware booking</b><p>Existing customers and registered properties are selected from the CRM graph so identity follows the appointment and work order.</p></div><button type="button" disabled={!activeDay.isOpen} onClick={() => setDrawerOpen(true)}>Find valid appointment</button></section>
      <section className={styles.sideCard}><div className={styles.cardHeading}><div><strong>Job Readiness</strong><span>Pre-dispatch gate</span></div><b className={styles.blockedText}>{readinessPreview.status.toUpperCase()}</b></div><ul className={styles.checkList}><li className={styles.ok}>✓ Crew + skill assigned</li><li className={styles.ok}>✓ Van and route compatible</li><li className={styles.bad}>! Required parts not ready</li><li className={styles.warn}>! Site access not confirmed</li></ul><button type="button">Open readiness queue</button></section>
      <section className={styles.sideCard}><div className={styles.cardHeading}><div><strong>Support Van Rule</strong><span>Large same-site jobs</span></div><b>6 + 4</b></div><div className={styles.supportDiagram}><div><strong>Primary van</strong><span>6 units</span><small>Owns confirmation + reminder</small></div><i>+</i><div><strong>Support van</strong><span>4 units</span><small>No duplicate customer messages</small></div></div><p className={styles.cardFoot}>Linked assignments share one customer appointment and retain distinct van accountability.</p></section>
      <section className={styles.sideCard}><div className={styles.cardHeading}><div><strong>Unscheduled Queue</strong><span>Needs a scheduling decision</span></div><b>3</b></div><div className={styles.queue}><div><span className={styles.queuePriority}>HIGH</span><strong>Commercial diagnostic</strong><small>Oranjestad · requested today</small></div><div><span>NEW</span><strong>2-unit standard service</strong><small>Noord · customer after 10 AM</small></div><div><span>READY</span><strong>Installation</strong><small>Santa Cruz · deposit confirmed</small></div></div></section></aside></div>

    {drawerOpen ? <AppointmentDrawer day={activeDay} jobs={activeJobs} onClose={() => setDrawerOpen(false)} onReserve={addAppointment} /> : null}
  </section>;
}

function JobSegment({ label, jobs, onConfirm }: { label: string; jobs: CalendarDispatchJob[]; onConfirm: (appointmentId: string) => void }) {
  const unique = jobs.filter((job, index, list) => list.findIndex((item) => item.id === job.id) === index).sort((a, b) => a.start.localeCompare(b.start));
  return <section className={styles.segment}><div className={styles.segmentLabel}>{label}</div>{unique.length ? unique.map((job) => { const persistentAppointmentId = job.id.startsWith('APT-') ? job.id.replace(/-(P|S)$/, '') : null; return <article className={`${styles.jobCard} ${job.status === 'temporary_hold' ? styles.jobHold : ''}`} key={job.id}><div className={styles.jobTime}><strong>{labelTime(job.start)}</strong><span>{labelTime(job.end)}</span></div><div className={styles.jobMain}><div><strong>{job.customer}</strong><b className={readinessClass(job.readiness)}>{job.readiness.replace('_', ' ')}</b></div><span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'}</span><small>{job.site} · {job.sector}{job.supportForJobId ? ' · Support assignment' : ''}</small>{persistentAppointmentId && job.status === 'temporary_hold' && job.isPrimaryAssignment ? <button type="button" onClick={() => onConfirm(persistentAppointmentId)} style={{ marginTop: 7, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--brand-soft)', color: 'var(--brand)', padding: '5px 7px', fontSize: 8, fontWeight: 850, cursor: 'pointer' }}>Confirm → Create Work Order</button> : persistentAppointmentId && job.isPrimaryAssignment ? <em style={{ display: 'block', marginTop: 5, color: 'var(--success)', fontSize: 7, fontStyle: 'normal', fontWeight: 800 }}>Confirmed · Work Order created</em> : null}</div></article>; }) : <button type="button" className={styles.openCapacity}>+ Open capacity</button>}</section>;
}

function AppointmentDrawer({ day, jobs, onClose, onReserve }: { day: OperationalDay; jobs: DispatchJob[]; onClose: () => void; onReserve: (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string, identity: BookingIdentity) => void }) {
  const [crmCustomers] = useState<BrowserCrmCustomerIdentity[]>(() => loadBrowserCrmCustomers());
  const [customerId, setCustomerId] = useState('');
  const [siteId, setSiteId] = useState('');
  const [customer, setCustomer] = useState('New Customer');
  const [site, setSite] = useState('Customer Property');
  const [sector, setSector] = useState('Noord');
  const [presetId, setPresetId] = useState<WorkPresetId>('standard_service');
  const [quantity, setQuantity] = useState(1);
  const [restriction, setRestriction] = useState('any');
  const [technicianInstructions, setTechnicianInstructions] = useState('');
  const [selected, setSelected] = useState<CandidateSlot | null>(null);
  const master = useMemo(() => customerId ? loadBrowserCustomerMaster(customerId) : { sites: [], assets: [] }, [customerId]);
  const crmSites = (master.sites ?? []) as BrowserCrmSiteIdentity[];
  const selectedCustomer = crmCustomers.find((item) => item.id === customerId);
  const selectedSite = crmSites.find((item) => item.id === siteId);
  const request = useMemo<BookingRequest>(() => ({ customer, site, sector, presetId, quantity, restriction: restriction === 'morning' ? { halfDay: 'am' } : restriction === 'afternoon' ? { halfDay: 'pm' } : restriction === 'after10' ? { notBefore: '10:00' } : restriction === 'after2' ? { notBefore: '14:00' } : undefined }), [customer, site, sector, presetId, quantity, restriction]);
  const slots = useMemo(() => findCandidateSlotsForDay(day, request, jobs), [day, request, jobs]);
  const description = customerFacingDescription(request);

  const chooseCustomer = (id: string) => {
    setSelected(null);
    setCustomerId(id);
    setSiteId('');
    if (!id) {
      setCustomer('New Customer');
      setSite('Customer Property');
      return;
    }
    const crmCustomer = crmCustomers.find((item) => item.id === id);
    const nextMaster = loadBrowserCustomerMaster(id);
    const firstSite = nextMaster.sites?.[0];
    if (crmCustomer) setCustomer(crmCustomer.name);
    if (firstSite) {
      setSiteId(firstSite.id);
      setSite(firstSite.name);
      setSector(sectorFromCrm(crmCustomer, firstSite) ?? sector);
    } else {
      setSite('Unregistered Property');
      setSector(sectorFromCrm(crmCustomer) ?? sector);
    }
  };

  const chooseSite = (id: string) => {
    setSelected(null);
    setSiteId(id);
    if (!id) {
      setSite('Unregistered Property');
      setSector(sectorFromCrm(selectedCustomer) ?? sector);
      return;
    }
    const crmSite = crmSites.find((item) => item.id === id);
    if (!crmSite) return;
    setSite(crmSite.name);
    setSector(sectorFromCrm(selectedCustomer, crmSite) ?? sector);
  };

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className={styles.drawer} role="dialog" aria-modal="true"><header className={styles.drawerHeader}><div><span>Booking workflow · {day.weekday} {day.shortDate}</span><h2>New appointment</h2><p>{day.shiftLabel}. The ERP offers only valid capacity for the selected operational date.</p></div><button type="button" onClick={onClose}>×</button></header><div className={styles.drawerBody}>
    <section className={styles.formSection}><header><strong>1 · Customer & location</strong><span>Select CRM identity when registered; manual entry is reserved for a genuinely new/unregistered lead.</span></header><div className={styles.formGrid}>
      <label className={styles.wide}><span>CRM customer</span><select value={customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">New / unregistered lead</option>{crmCustomers.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.location || item.type || item.id}</option>)}</select></label>
      {customerId ? <label className={styles.wide}><span>Registered property / site</span><select value={siteId} onChange={(event) => chooseSite(event.target.value)}><option value="">Unregistered property</option>{crmSites.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.address}</option>)}</select></label> : <><label><span>Customer / lead name</span><input value={customer} onChange={(event) => { setCustomer(event.target.value); setSelected(null); }} /></label><label><span>Property / site</span><input value={site} onChange={(event) => { setSite(event.target.value); setSelected(null); }} /></label></>}
      <label><span>DEMAC sector</span><select value={sector} onChange={(event) => { setSector(event.target.value); setSelected(null); }}><option>Noord</option><option>Palm Beach</option><option>Oranjestad</option><option>Santa Cruz</option><option>Paradera</option><option>San Nicolas</option><option>Savaneta</option></select></label>
    </div>{customerId ? <div className={styles.descriptionPreview}><span>CRM IDENTITY LINKED</span><strong>{selectedCustomer?.name ?? customer} · {selectedSite?.name ?? site}</strong><small>Customer ID {customerId}{siteId ? ` · Site ID ${siteId}` : ' · property still needs registration'}. These IDs follow the Work Order.</small></div> : crmCustomers.length === 0 ? <div className={styles.descriptionPreview}><span>CRM TEST DATA</span><strong>No browser CRM customers found yet</strong><small>Create or open customers in CRM first, then Scheduling can reuse them without retyping identity.</small></div> : null}</section>
    <section className={styles.formSection}><header><strong>2 · Work & duration</strong><span>Four-to-seven same-site standard services use the extended-day planner.</span></header><div className={styles.formGrid}><label className={styles.wide}><span>Predetermined work</span><select value={presetId} onChange={(event) => { setPresetId(event.target.value as WorkPresetId); setSelected(null); }}>{defaultWorkPresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label><label><span>Number of A/C units</span><input type="number" min={1} max={12} value={quantity} onChange={(event) => { setQuantity(Math.max(1, Number(event.target.value) || 1)); setSelected(null); }} /></label><label><span>Customer restriction</span><select value={restriction} onChange={(event) => { setRestriction(event.target.value); setSelected(null); }}><option value="any">No time restriction</option><option value="morning">Morning only</option><option value="afternoon">Afternoon only</option><option value="after10">After 10:00 AM</option><option value="after2">After 2:00 PM</option></select></label></div><div className={styles.descriptionPreview}><span>CUSTOMER-FACING DESCRIPTION</span><strong>{description}</strong><small>Technician-only notes remain separate.</small></div><label className={styles.instructions}><span>Technician instructions</span><textarea rows={3} value={technicianInstructions} onChange={(event) => setTechnicianInstructions(event.target.value)} placeholder="Internal access notes, preparation or technical instructions..." /></label></section>
    <section className={styles.formSection}><header><strong>3 · Valid ERP options</strong><span>{day.weekday === 'Sat' ? 'Saturday short-shift solver active.' : 'Date, route anchors, duration and customer restrictions are enforced.'}</span></header><div className={styles.slotList}>{slots.length ? slots.map((slot) => <button type="button" key={`${slot.vanId}-${slot.start}-${slot.supportVanId ?? ''}`} className={`${styles.slotCard} ${selected === slot ? styles.slotSelected : ''}`} onClick={() => setSelected(slot)}><div><strong>{slot.segment === 'full_day' ? `${labelTime(slot.start)} – ${labelTime(slot.end)} · extended plan` : `${labelTime(slot.start)} – ${labelTime(slot.end)}`}</strong><span>{slot.vanId}{slot.supportVanId ? ` + ${slot.supportVanId}` : ''} · {slot.sector}</span></div><b>{slot.score}</b><small>{slot.requiresSupportVan ? `${slot.primaryUnits} + ${slot.supportUnits} units · one customer communication owner` : slot.reasons[0] ?? 'Available capacity'}</small></button>) : <div className={styles.noSlots}><strong>No valid capacity on this date</strong><p>Choose another day, restriction, quantity or work type. The ERP does not invent availability.</p></div>}</div></section>
  </div><footer className={styles.drawerFooter}><div>{selected ? <><span>Selected</span><strong>{selected.vanId}{selected.supportVanId ? ` + ${selected.supportVanId}` : ''} · {selected.segment === 'full_day' ? `${labelTime(selected.start)}–${labelTime(selected.end)}` : labelTime(selected.start)}</strong></> : <span>Select a valid ERP option to continue.</span>}</div><div><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button type="button" className={styles.primary} disabled={!selected || !customer.trim() || !site.trim()} onClick={() => selected && onReserve(request, selected, technicianInstructions, { customerId: customerId || undefined, siteId: siteId || undefined })}>Temporary hold</button></div></footer></aside></div>;
}
