'use client';

import { useEffect, useMemo, useState } from 'react';
import { loadBrowserCrmCustomers, loadBrowserCustomerMaster, sectorFromCrm, type BrowserCrmCustomerIdentity, type BrowserCrmSiteIdentity } from '../../lib/browser-crm';
import { diagnoseBookingRequest, type BookingLiveIssue } from '../../lib/scheduling-booking-diagnostics';
import { createBrowserWorkOrder, type BrowserAppointmentRecord, type BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BookingRequest, CandidateSlot, DispatchJob, WorkPresetId } from '../../lib/scheduling';
import { customerFacingDescription, defaultWorkPresets, getHalfDayAnchor, getRuntimeSchedulingSettings, minutesToTime, previewVans, timeToMinutes } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay, SupportReflowPlan } from '../../lib/scheduling-capacity';
import { buildOperationalWeek, currentArubaDateKey, findCandidateSlotsForDay, findSupportReflowPlansForDay } from '../../lib/scheduling-capacity';
import { QuickCustomerOnboarding, type QuickCustomerCreateResult } from './quick-customer-onboarding';
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

function appointmentIdForJob(job: CalendarDispatchJob) {
  return job.id.startsWith('APT-') ? job.id.replace(/-(P|S)$/, '') : undefined;
}

function jobSpanFromIndex(job: CalendarDispatchJob, slots: DisplaySlot[], startIndex: number) {
  let span = 0;
  for (let index = startIndex; index < slots.length; index += 1) {
    if (!overlapsSlot(job, slots[index])) break;
    span += 1;
  }
  return Math.max(1, span);
}

function jobCrossesLunch(job: CalendarDispatchJob) {
  return timeToMinutes(job.start) < 12 * 60 && timeToMinutes(job.end) > 13 * 60;
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
        start: slot.supportStart ?? primary.start,
        end: slot.supportEnd ?? primary.end,
        segment: slot.supportSegment ?? primary.segment,
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
    const supportText = slot.supportVanId ? ` with linked support from ${slot.supportVanId.replace('VAN-', 'Van ')}` : '';
    setNotice(`${record.customerFacingDescription} placed on temporary hold for ${slot.vanId.replace('VAN-', 'Van ')}${supportText} at ${formatTime(slot.start)}.`);
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

  const applySupportReflow = (plan: SupportReflowPlan) => {
    const appointment = appointments.find((item) => item.assignments.some((assignment) => assignment.id === plan.supportJobId));
    if (!appointment) {
      setNotice('Booking Intelligence could not find the support assignment to optimize. Refresh the schedule and try again.');
      return;
    }

    const updatedAppointment: BrowserAppointmentRecord = {
      ...appointment,
      assignments: appointment.assignments.map((assignment) => assignment.id === plan.supportJobId ? {
        ...assignment,
        start: plan.toStart,
        end: plan.toEnd,
        segment: plan.toSegment,
      } : assignment),
    };
    setAppointments((items) => items.map((item) => item.id === appointment.id ? updatedAppointment : item));

    if (appointment.workOrderId) {
      const workOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
      saveBrowserValue(browserKeys.workOrders, workOrders.map((order) => order.appointmentId === appointment.id ? {
        ...order,
        assignments: order.assignments.map((assignment) => assignment.role === 'support' && assignment.vanId === plan.vanId && assignment.start === plan.fromStart ? {
          ...assignment,
          start: plan.toStart,
          end: plan.toEnd,
          segment: plan.toSegment,
        } : assignment),
      } : order));
    }

    setPreferredSlot({});
    setNotice(`Booking Intelligence moved support for ${plan.customer} on ${plan.vanId.replace('VAN-', 'Van ')} from ${formatTime(plan.fromStart)} to ${formatTime(plan.toStart)}. The primary appointment was not changed, and ${formatTime(plan.unlockedSlot.start)}–${formatTime(plan.unlockedSlot.end)} is now available for the new request.`);
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
                <VanScheduleSlots slots={activeSlots} jobs={vanJobs} onConfirm={confirmAppointment} onOpen={(start) => openBooking({ vanId: van.id, start })} />
                {!activeDay.isOpen ? <div className={styles.closedDay}>No operational capacity</div> : null}
              </section>;
            })}
          </div>
        </div>
      </section>

      {drawerOpen ? <BookingDrawer day={activeDay} jobs={activeJobs} preferred={preferredSlot} onClose={() => { setDrawerOpen(false); setPreferredSlot({}); }} onReserve={addAppointment} onApplySupportReflow={applySupportReflow} /> : null}
    </section>
  );
}

function VanScheduleSlots({ slots, jobs, onConfirm, onOpen }: { slots: DisplaySlot[]; jobs: CalendarDispatchJob[]; onConfirm: (appointmentId: string) => void; onOpen: (start: string) => void }) {
  const rows: React.ReactNode[] = [];
  let index = 0;

  while (index < slots.length) {
    const slot = slots[index];
    const previous = slots[index - 1];
    const firstAfternoon = index > 0 && previous?.segment === 'am' && slot.segment === 'pm';
    if (firstAfternoon) rows.push(<div className={styles.lunchRow} key={`lunch-${slot.start}`}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div>);

    const startingJobs = jobs.filter((job) => job.start === slot.start).sort((a, b) => a.id.localeCompare(b.id));
    if (startingJobs.length) {
      const job = startingJobs[0];
      const span = jobSpanFromIndex(job, slots, index);
      rows.push(<AppointmentBlock key={job.id} job={job} span={span} crossesLunch={jobCrossesLunch(job)} onConfirm={onConfirm} />);
      index += span;
      continue;
    }

    const continuingJob = jobs.find((job) => overlapsSlot(job, slot) && timeToMinutes(job.start) < timeToMinutes(slot.start));
    if (continuingJob) {
      rows.push(<div className={styles.occupiedSlot} key={`${continuingJob.id}-${slot.start}`}><div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div><div className={styles.slotJobs}><article className={styles.jobCard}><div><div className={styles.jobTitle}><strong>Reserved</strong></div><span>Part of {formatTime(continuingJob.start)}–{formatTime(continuingJob.end)} appointment</span></div></article></div></div>);
      index += 1;
      continue;
    }

    rows.push(<button type="button" className={styles.openSlot} key={`open-${slot.start}`} onClick={() => onOpen(slot.start)}><div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div><div><strong>Available</strong><span>Open work spot</span></div><b>+ Schedule</b></button>);
    index += 1;
  }

  return <div className={styles.slotList}>{rows}</div>;
}

function AppointmentBlock({ job, span, crossesLunch, onConfirm }: { job: CalendarDispatchJob; span: number; crossesLunch: boolean; onConfirm: (appointmentId: string) => void }) {
  const appointmentId = appointmentIdForJob(job);
  const minHeight = span * 64 + Math.max(0, span - 1) * 6 + (crossesLunch ? 18 : 0);
  return <div className={styles.occupiedSlot} style={{ minHeight }}>
    <div className={styles.slotTime}><strong>{formatTime(job.start)}</strong><span>{formatTime(job.end)}</span>{span > 1 ? <span>{span} spots</span> : null}</div>
    <div className={styles.slotJobs}>
      <article className={`${styles.jobCard} ${job.status === 'temporary_hold' ? styles.holdCard : ''}`} style={{ minHeight: '100%', alignItems: 'center' }}>
        <div><div className={styles.jobTitle}><strong>{job.customer}</strong><b className={slotClass(job.readiness)}>{readinessLabel(job.readiness)}</b></div><span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'}</span><small>{job.site} · {job.sector}{job.supportForJobId ? ' · Support assignment' : ''}</small>{span > 1 ? <small>Reserved continuously · {formatTime(job.start)}–{formatTime(job.end)}</small> : null}{crossesLunch ? <small>12:00–1:00 PM lunch/reset remains protected</small> : null}</div>
        {appointmentId && job.status === 'temporary_hold' && job.isPrimaryAssignment ? <button type="button" onClick={() => onConfirm(appointmentId)}>Confirm</button> : null}
      </article>
    </div>
  </div>;
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

function BookingDrawer({ day, jobs, preferred, onClose, onReserve, onApplySupportReflow }: { day: OperationalDay; jobs: CalendarDispatchJob[]; preferred: PreferredSlot; onClose: () => void; onReserve: (request: BookingRequest, slot: CandidateSlot, technicianInstructions: string, identity: BookingIdentity) => void; onApplySupportReflow: (plan: SupportReflowPlan) => void }) {
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
