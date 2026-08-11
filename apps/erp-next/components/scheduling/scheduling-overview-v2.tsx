'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadBrowserCrmCustomers, loadBrowserCustomerMaster, sectorFromCrm, type BrowserCrmCustomerIdentity, type BrowserCrmSiteIdentity } from '../../lib/browser-crm';
import { createBrowserWorkOrder, type BrowserAppointmentRecord, type BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BookingRequest, CandidateSlot, DispatchJob, WorkPresetId } from '../../lib/scheduling';
import { customerFacingDescription, defaultWorkPresets, getHalfDayAnchor, getRuntimeSchedulingSettings, minutesToTime, previewVans, timeToMinutes } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay } from '../../lib/scheduling-capacity';
import { buildOperationalWeek, currentArubaDateKey, findCandidateSlotsForDay } from '../../lib/scheduling-capacity';
import styles from './scheduling-overview-v2.module.css';

type BookingIdentity = { customerId?: string; siteId?: string };
type PreferredSlot = { vanId?: string; start?: string };

type DisplaySlot = {
  start: string;
  end: string;
  segment: 'am' | 'pm';
};

function appointmentAssignments(record: BrowserAppointmentRecord): CalendarDispatchJob[] {
  if (record.status === 'cancelled') return [];
  const status = record.status === 'confirmed' ? 'confirmed' : 'temporary_hold';
  return record.assignments.map((assignment) => ({ ...assignment, dateKey: record.dateKey, status }));
}

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function presetLabel(id: WorkPresetId) {
  return defaultWorkPresets.find((preset) => preset.id === id)?.label ?? 'Other work';
}

function readinessLabel(value: DispatchJob['readiness']) {
  return value === 'ready' ? 'Ready' : value === 'blocked' ? 'Blocked' : value === 'at_risk' ? 'At Risk' : 'Not Checked';
}

function slotClass(value: DispatchJob['readiness']) {
  return value === 'ready' ? styles.ready : value === 'blocked' ? styles.blocked : value === 'at_risk' ? styles.risk : styles.notChecked;
}

function displaySlotsForDay(day: OperationalDay): DisplaySlot[] {
  if (!day.isOpen) return [];
  const starts = day.weekday === 'Sat' ? ['09:00', '10:00', '11:00', '12:00'] : getRuntimeSchedulingSettings().serviceStartTimes;
  return starts.map((start) => {
    const startMinutes = timeToMinutes(start);
    return {
      start,
      end: minutesToTime(startMinutes + 60),
      segment: startMinutes < 12 * 60 ? 'am' : 'pm',
    };
  });
}

function overlapsSlot(job: CalendarDispatchJob, slot: DisplaySlot) {
  if (job.status === 'cancelled') return false;
  return timeToMinutes(job.start) < timeToMinutes(slot.end) && timeToMinutes(job.end) > timeToMinutes(slot.start);
}

function occupancyForDay(day: OperationalDay, jobs: CalendarDispatchJob[]) {
  const slots = displaySlotsForDay(day);
  const total = slots.length * previewVans.length;
  if (!total) return { total: 0, occupied: 0, open: 0, percent: 0 };
  let occupied = 0;
  for (const van of previewVans) {
    for (const slot of slots) {
      if (jobs.some((job) => job.dateKey === day.dateKey && job.vanId === van.id && overlapsSlot(job, slot))) occupied += 1;
    }
  }
  return { total, occupied, open: total - occupied, percent: Math.round((occupied / total) * 100) };
}

export function SchedulingOverviewV2() {
  const [calendar] = useState(() => {
    const today = currentArubaDateKey();
    return { today, week: buildOperationalWeek(today) };
  });
  const [activeDate, setActiveDate] = useState(calendar.today);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preferredSlot, setPreferredSlot] = useState<PreferredSlot>({});
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setAppointments(loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []));
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    saveBrowserValue(browserKeys.appointments, appointments);
  }, [appointments, storageReady]);

  const jobs = useMemo(() => appointments.flatMap(appointmentAssignments), [appointments]);
  const activeDay = calendar.week.find((day) => day.dateKey === activeDate) ?? calendar.week[0];
  const activeJobs = jobs.filter((job) => job.dateKey === activeDate);
  const activeSlots = displaySlotsForDay(activeDay);
  const activeOccupancy = occupancyForDay(activeDay, jobs);
  const confirmed = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'confirmed').length;
  const holds = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'temporary_hold').length;
  const attention = activeJobs.filter((job) => job.isPrimaryAssignment && (job.readiness === 'blocked' || job.readiness === 'at_risk')).length;

  const openBooking = (slot?: PreferredSlot) => {
    setPreferredSlot(slot ?? {});
    setDrawerOpen(true);
  };

  const addAppointment = (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string, identity: BookingIdentity) => {
    const stamp = Date.now().toString();
    const appointmentId = `APT-${stamp.slice(-8)}`;
    const primaryId = `${appointmentId}-P`;
    const primaryQty = slot.primaryUnits ?? request.quantity;
    const primary: CalendarDispatchJob = {
      dateKey: activeDate,
      id: primaryId,
      customer: request.customer,
      site: request.site,
      sector: request.sector,
      start: slot.start,
      end: slot.end,
      segment: slot.segment,
      vanId: slot.vanId,
      presetId: request.presetId,
      quantity: primaryQty,
      status: 'temporary_hold',
      readiness: 'at_risk',
      isPrimaryAssignment: true,
      customerCommunicationOwner: true,
    };
    const assignments: CalendarDispatchJob[] = [primary];
    if (slot.requiresSupportVan && slot.supportVanId) {
      assignments.push({
        ...primary,
        id: `${appointmentId}-S`,
        vanId: slot.supportVanId,
        quantity: slot.supportUnits ?? Math.max(1, request.quantity - primaryQty),
        isPrimaryAssignment: false,
        customerCommunicationOwner: false,
        supportForJobId: primaryId,
      });
    }
    const record: BrowserAppointmentRecord = {
      id: appointmentId,
      dateKey: activeDate,
      customerId: identity.customerId,
      siteId: identity.siteId,
      customer: request.customer,
      site: request.site,
      sector: request.sector,
      presetId: request.presetId,
      totalQuantity: request.quantity,
      customerFacingDescription: customerFacingDescription(request),
      technicianInstructions: technicianInstructions.trim() || undefined,
      status: 'temporary_hold',
      assignments,
      primaryVanId: slot.vanId,
      supportVanId: slot.supportVanId,
      createdAt: new Date().toISOString(),
    };
    setAppointments((current) => [...current, record]);
    setDrawerOpen(false);
    setPreferredSlot({});
    setNotice(`${record.customerFacingDescription} placed on temporary hold for ${slot.vanId.replace('VAN-', 'Van ')} at ${formatTime(slot.start)}.`);
  };

  const confirmAppointment = (appointmentId: string) => {
    const current = appointments.find((appointment) => appointment.id === appointmentId);
    if (!current || current.status !== 'temporary_hold') return;
    const workOrderId = current.workOrderId ?? `WO-${appointmentId.replace(/^APT-/, '').slice(-6)}`;
    const confirmedRecord: BrowserAppointmentRecord = {
      ...current,
      status: 'confirmed',
      workOrderId,
      confirmedAt: new Date().toISOString(),
      assignments: current.assignments.map((assignment) => ({ ...assignment, status: 'confirmed' })),
    };
    setAppointments((items) => items.map((item) => item.id === appointmentId ? confirmedRecord : item));
    const workOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    if (!workOrders.some((order) => order.appointmentId === appointmentId)) {
      saveBrowserValue(browserKeys.workOrders, [...workOrders, createBrowserWorkOrder(confirmedRecord)]);
    }
    setNotice(`${appointmentId} confirmed and linked to ${workOrderId}.`);
  };

  const moveDay = (direction: -1 | 1) => {
    const index = calendar.week.findIndex((day) => day.dateKey === activeDate);
    const next = Math.max(0, Math.min(calendar.week.length - 1, index + direction));
    setActiveDate(calendar.week[next].dateKey);
  };

  return (
    <section className={styles.page}>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>Operations · Aruba</span><h1>Scheduling & Dispatch</h1><p>See the entire week, all four vans and every available work spot from one primary agenda view.</p></div>
        <div className={styles.pageActions}><button type="button" className={styles.secondary}>Capacity settings</button><button type="button" className={styles.primary} disabled={!activeDay.isOpen} onClick={() => openBooking()}>+ New appointment</button></div>
      </header>

      {notice ? <div className={styles.notice}><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>×</button></div> : null}

      <section className={styles.weekStrip} aria-label="Operational week">
        {calendar.week.map((day) => {
          const summary = occupancyForDay(day, jobs);
          return <button type="button" key={day.dateKey} disabled={!day.isOpen} className={`${styles.dayCard} ${day.dateKey === activeDate ? styles.dayActive : ''} ${day.isToday ? styles.today : ''}`} onClick={() => setActiveDate(day.dateKey)}>
            <div><span>{day.weekday}</span><strong>{day.shortDate}</strong>{day.isToday ? <b>TODAY</b> : null}</div>
            <small>{day.shiftLabel}</small>
            {day.isOpen ? <><i><em style={{ width: `${summary.percent}%` }} /></i><p>{summary.occupied}/{summary.total} spots filled · {summary.open} open</p></> : <p>Operationally closed</p>}
          </button>;
        })}
      </section>

      <div className={styles.metrics}>
        <article><span>Confirmed</span><strong>{confirmed}</strong><small>{activeDay.weekday} {activeDay.shortDate}</small><i style={{ width: `${Math.min(100, activeOccupancy.percent)}%` }} /></article>
        <article><span>Temporary Holds</span><strong>{holds}</strong><small>Awaiting confirmation</small><i style={{ width: `${Math.min(100, holds * 14)}%` }} /></article>
        <article><span>Need Attention</span><strong className={attention ? styles.metricWarning : ''}>{attention}</strong><small>At risk or blocked assignments</small><i style={{ width: `${Math.min(100, attention * 16)}%` }} /></article>
        <article><span>Open Spots</span><strong className={activeOccupancy.open ? styles.metricGood : ''}>{activeOccupancy.open}</strong><small>{activeOccupancy.occupied}/{activeOccupancy.total} occupied today</small><i style={{ width: `${activeOccupancy.total ? Math.round((activeOccupancy.open / activeOccupancy.total) * 100) : 0}%` }} /></article>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.dayNav}><button type="button" onClick={() => moveDay(-1)}>‹</button><div><strong>{activeDay.isToday ? 'Today' : `${activeDay.weekday} · ${activeDay.shortDate}`}</strong><span>{activeDay.shiftLabel} · Aruba time</span></div><button type="button" onClick={() => moveDay(1)}>›</button></div>
        <div className={styles.legend}><span><i className={styles.readyDot} /> Ready</span><span><i className={styles.riskDot} /> At risk</span><span><i className={styles.blockedDot} /> Blocked</span><span><i className={styles.holdDot} /> Hold</span><span><i className={styles.openDot} /> Open spot</span></div>
      </div>

      <section className={styles.bookingIntelligence}>
        <div className={styles.aiBadge}>AI</div>
        <div className={styles.intelligenceTitle}><strong>Booking Intelligence</strong><span>Deterministic booking engine</span></div>
        <div className={styles.intelligenceInsight}><span>Date-aware capacity</span><p>{activeOccupancy.open} open spot{activeOccupancy.open === 1 ? '' : 's'} across four vans on the selected day.</p></div>
        <div className={styles.intelligenceInsight}><span>CRM-aware booking</span><p>Existing customers and registered properties flow into the appointment and Work Order without retyping.</p></div>
        <div className={styles.intelligenceInsight}><span>Route-aware offers</span><p>The booking engine still enforces sector anchors, duration, restrictions and support-van rules.</p></div>
        <button type="button" disabled={!activeDay.isOpen} onClick={() => openBooking()}>Find valid appointment</button>
      </section>

      <section className={styles.board}>
        <header className={styles.boardHeader}><div><strong>Four-Van Schedule</strong><span>{activeDay.weekday} {activeDay.shortDate} · every standard work spot remains visible whether occupied or empty.</span></div><b>{activeOccupancy.open} OPEN SPOTS</b></header>
        <div className={styles.boardScroll}>
          <div className={styles.vanGrid}>
            {previewVans.map((van) => {
              const vanJobs = activeJobs.filter((job) => job.vanId === van.id);
              const amAnchor = getHalfDayAnchor(activeJobs, van.id, 'am');
              const pmAnchor = getHalfDayAnchor(activeJobs, van.id, 'pm');
              return <section className={styles.vanLane} key={van.id}>
                <header><div className={styles.vanIdentity}><span>{van.id.replace('VAN-', 'V')}</span><div><strong>{van.name}</strong><small>{van.team}</small></div></div><b>ACTIVE</b></header>
                <div className={styles.anchorBar}><div><span>AM anchor</span><strong>{amAnchor?.sector ?? 'Open'}</strong></div><div><span>PM anchor</span><strong>{pmAnchor?.sector ?? 'Open'}</strong></div></div>
                <div className={styles.slotList}>
                  {activeSlots.map((slot, index) => {
                    const slotJobs = vanJobs.filter((job) => overlapsSlot(job, slot)).sort((a, b) => a.start.localeCompare(b.start));
                    const isFirstAfternoon = index > 0 && activeSlots[index - 1]?.segment === 'am' && slot.segment === 'pm';
                    return <div key={`${van.id}-${slot.start}`}>
                      {isFirstAfternoon ? <div className={styles.lunchRow}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div> : null}
                      <ScheduleSlot slot={slot} jobs={slotJobs} onConfirm={confirmAppointment} onOpen={() => openBooking({ vanId: van.id, start: slot.start })} />
                    </div>;
                  })}
                  {!activeDay.isOpen ? <div className={styles.closedDay}>No operational capacity</div> : null}
                </div>
              </section>;
            })}
          </div>
        </div>
      </section>

      {drawerOpen ? <BookingDrawer day={activeDay} jobs={activeJobs} preferred={preferredSlot} onClose={() => { setDrawerOpen(false); setPreferredSlot({}); }} onReserve={addAppointment} /> : null}
    </section>
  );
}

function ScheduleSlot({ slot, jobs, onConfirm, onOpen }: { slot: DisplaySlot; jobs: CalendarDispatchJob[]; onConfirm: (appointmentId: string) => void; onOpen: () => void }) {
  if (!jobs.length) {
    return <button type="button" className={styles.openSlot} onClick={onOpen}><div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div><div><strong>Available</strong><span>Open work spot</span></div><b>+ Schedule</b></button>;
  }

  return <div className={styles.occupiedSlot}>
    <div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div>
    <div className={styles.slotJobs}>{jobs.map((job) => {
      const appointmentId = job.id.startsWith('APT-') ? job.id.replace(/-(P|S)$/, '') : undefined;
      const startsHere = job.start === slot.start;
      return <article key={job.id} className={`${styles.jobCard} ${job.status === 'temporary_hold' ? styles.holdCard : ''}`}>
        <div><div className={styles.jobTitle}><strong>{job.customer}</strong><b className={slotClass(job.readiness)}>{readinessLabel(job.readiness)}</b></div><span>{startsHere ? presetLabel(job.presetId) : `Continues · ${presetLabel(job.presetId)}`} · {job.quantity} unit{job.quantity === 1 ? '' : 's'}</span><small>{job.site} · {job.sector}{job.supportForJobId ? ' · Support' : ''}</small></div>
        {appointmentId && job.status === 'temporary_hold' && job.isPrimaryAssignment ? <button type="button" onClick={() => onConfirm(appointmentId)}>Confirm</button> : null}
      </article>;
    })}</div>
  </div>;
}

function BookingDrawer({ day, jobs, preferred, onClose, onReserve }: { day: OperationalDay; jobs: CalendarDispatchJob[]; preferred: PreferredSlot; onClose: () => void; onReserve: (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string, identity: BookingIdentity) => void }) {
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
  const request = useMemo<BookingRequest>(() => ({
    customer,
    site,
    sector,
    presetId,
    quantity,
    restriction: restriction === 'morning' ? { halfDay: 'am' } : restriction === 'afternoon' ? { halfDay: 'pm' } : restriction === 'after10' ? { notBefore: '10:00' } : restriction === 'after2' ? { notBefore: '14:00' } : undefined,
  }), [customer, site, sector, presetId, quantity, restriction]);
  const slots = useMemo(() => {
    const options = findCandidateSlotsForDay(day, request, jobs);
    return [...options].sort((a, b) => {
      const aPreferred = Number(Boolean(preferred.vanId && a.vanId === preferred.vanId && preferred.start && a.start === preferred.start));
      const bPreferred = Number(Boolean(preferred.vanId && b.vanId === preferred.vanId && preferred.start && b.start === preferred.start));
      return bPreferred - aPreferred || b.score - a.score;
    });
  }, [day, jobs, preferred.start, preferred.vanId, request]);

  useEffect(() => {
    const exact = slots.find((slot) => preferred.vanId && preferred.start && slot.vanId === preferred.vanId && slot.start === preferred.start);
    if (exact) setSelected(exact);
  }, [preferred.start, preferred.vanId, slots]);

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
    const crmSite = crmSites.find((item) => item.id === id);
    if (!crmSite) {
      setSite('Unregistered Property');
      setSector(sectorFromCrm(selectedCustomer) ?? sector);
      return;
    }
    setSite(crmSite.name);
    setSector(sectorFromCrm(selectedCustomer, crmSite) ?? sector);
  };

  return <div className={styles.drawerOverlay} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className={styles.drawer} role="dialog" aria-modal="true">
      <header className={styles.drawerHeader}><div><span>New appointment · {day.weekday} {day.shortDate}</span><h2>Find a valid work spot</h2><p>The same deterministic scheduler still controls van, sector, duration, customer restrictions and support capacity.</p></div><button type="button" onClick={onClose}>×</button></header>
      <div className={styles.drawerBody}>
        <section className={styles.formSection}><header><strong>1 · Customer & property</strong><span>Use CRM identity when available.</span></header><div className={styles.formGrid}>
          <label className={styles.wide}><span>CRM customer</span><select value={customerId} onChange={(event) => chooseCustomer(event.target.value)}><option value="">New / unregistered lead</option>{crmCustomers.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.location || item.type || item.id}</option>)}</select></label>
          {customerId ? <label className={styles.wide}><span>Registered property</span><select value={siteId} onChange={(event) => chooseSite(event.target.value)}><option value="">Unregistered property</option>{crmSites.map((item) => <option value={item.id} key={item.id}>{item.name} · {item.address}</option>)}</select></label> : <><label><span>Customer / lead name</span><input value={customer} onChange={(event) => { setCustomer(event.target.value); setSelected(null); }} /></label><label><span>Property / site</span><input value={site} onChange={(event) => { setSite(event.target.value); setSelected(null); }} /></label></>}
          <label><span>DEMAC sector</span><select value={sector} onChange={(event) => { setSector(event.target.value); setSelected(null); }}><option>Noord</option><option>Palm Beach</option><option>Oranjestad</option><option>Santa Cruz</option><option>Paradera</option><option>San Nicolas</option><option>Savaneta</option></select></label>
        </div></section>

        <section className={styles.formSection}><header><strong>2 · Work & restrictions</strong><span>Changing these values recalculates valid slots.</span></header><div className={styles.formGrid}>
          <label className={styles.wide}><span>Work type</span><select value={presetId} onChange={(event) => { setPresetId(event.target.value as WorkPresetId); setSelected(null); }}>{defaultWorkPresets.map((preset) => <option value={preset.id} key={preset.id}>{preset.label}</option>)}</select></label>
          <label><span>Number of A/C units</span><input type="number" min={1} max={12} value={quantity} onChange={(event) => { setQuantity(Math.max(1, Number(event.target.value) || 1)); setSelected(null); }} /></label>
          <label><span>Customer restriction</span><select value={restriction} onChange={(event) => { setRestriction(event.target.value); setSelected(null); }}><option value="any">No time restriction</option><option value="morning">Morning only</option><option value="afternoon">Afternoon only</option><option value="after10">After 10:00 AM</option><option value="after2">After 2:00 PM</option></select></label>
        </div><div className={styles.descriptionPreview}><span>CUSTOMER-FACING DESCRIPTION</span><strong>{customerFacingDescription(request)}</strong><small>Technician-only instructions remain separate.</small></div><label className={styles.instructions}><span>Technician instructions</span><textarea rows={3} value={technicianInstructions} onChange={(event) => setTechnicianInstructions(event.target.value)} placeholder="Internal access, preparation or technical instructions..." /></label></section>

        <section className={styles.formSection}><header><strong>3 · Valid ERP options</strong><span>{preferred.vanId && preferred.start ? `Requested visual spot: ${preferred.vanId.replace('VAN-', 'Van ')} · ${formatTime(preferred.start)}` : 'Choose one of the valid calculated options.'}</span></header><div className={styles.slotOptions}>
          {slots.length ? slots.map((slot) => <button type="button" key={`${slot.vanId}-${slot.start}-${slot.supportVanId ?? ''}`} className={`${styles.slotOption} ${selected === slot ? styles.slotOptionSelected : ''}`} onClick={() => setSelected(slot)}><div><strong>{slot.vanId.replace('VAN-', 'Van ')} · {formatTime(slot.start)}–{formatTime(slot.end)}</strong><span>{slot.sector}{slot.supportVanId ? ` · support ${slot.supportVanId.replace('VAN-', 'Van ')}` : ''}</span></div><b>{slot.score}</b><small>{slot.reasons[0] ?? 'Valid capacity'}</small></button>) : <div className={styles.noSlots}><strong>No valid capacity for this request</strong><p>Change day, sector, restriction, work type or quantity. ERP Next will not invent availability.</p></div>}
        </div></section>
      </div>
      <footer className={styles.drawerFooter}><div>{selected ? <><span>Selected</span><strong>{selected.vanId.replace('VAN-', 'Van ')} · {formatTime(selected.start)}</strong></> : <span>Select a valid work spot.</span>}</div><div><button type="button" className={styles.secondary} onClick={onClose}>Cancel</button><button type="button" className={styles.primary} disabled={!selected || !customer.trim() || !site.trim()} onClick={() => selected && onReserve(request, selected, technicianInstructions, { customerId: customerId || undefined, siteId: siteId || undefined })}>Temporary hold</button></div></footer>
    </aside>
  </div>;
}
