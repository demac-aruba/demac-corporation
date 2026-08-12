'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/auth-provider';
import { createBrowserWorkOrder, type BrowserAppointmentRecord, type BrowserWorkOrderRecord } from '../../lib/browser-operational';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '../../lib/browser-store';
import type { BookingRequest, CandidateSlot, DispatchJob, WorkPresetId } from '../../lib/scheduling';
import { customerFacingDescription, defaultWorkPresets, getHalfDayAnchor, getRuntimeSchedulingSettings, minutesToTime, previewVans, timeToMinutes } from '../../lib/scheduling';
import type { CalendarDispatchJob, OperationalDay, SupportReflowPlan } from '../../lib/scheduling-capacity';
import { buildOperationalWeek, currentArubaDateKey } from '../../lib/scheduling-capacity';
import { appendLifecycleEvent, applyAppointmentScheduleChange, applySupportAssignmentMove, appointmentSnapshot, syncWorkOrderFromAppointment, validMoveCandidates, validRescheduleCandidates, validSupportMoveCandidates } from '../../lib/scheduling-appointment-lifecycle';
import { AppointmentDetailsDrawer } from './appointment-details-drawer';
import { BookingDrawer, type BookingIdentity, type PreferredSlot } from './booking-drawer';
import { DragMoveConfirmation, type PendingDragMove } from './drag-move-confirmation';
import styles from './scheduling-overview-v2.module.css';

type DisplaySlot = { start: string; end: string; segment: 'am' | 'pm' };

function appointmentAssignments(record: BrowserAppointmentRecord): CalendarDispatchJob[] {
  if (record.status === 'cancelled') return [];
  const status = record.status === 'confirmed' ? 'confirmed' : 'temporary_hold';
  return record.assignments.map((assignment) => ({ ...assignment, dateKey: record.dateKey, status }));
}

function formatTime(value: string) {
  const [hourText, minute] = value.split(':');
  const hour = Number(hourText);
  return `${hour % 12 || 12}:${minute} ${hour >= 12 ? 'PM' : 'AM'}`;
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
    return { start, end: minutesToTime(startMinutes + 60), segment: startMinutes < 12 * 60 ? 'am' : 'pm' };
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

function addDays(dateKey: string, amount: number) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function SchedulingOverviewV2() {
  const { principal } = useAuth();
  const [today] = useState(() => currentArubaDateKey());
  const [activeDate, setActiveDate] = useState(today);
  const week = useMemo(() => buildOperationalWeek(activeDate), [activeDate]);
  const [appointments, setAppointments] = useState<BrowserAppointmentRecord[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [preferredSlot, setPreferredSlot] = useState<PreferredSlot>({});
  const [selectedAppointmentId, setSelectedAppointmentId] = useState<string | null>(null);
  const [moveArmedAppointmentId, setMoveArmedAppointmentId] = useState<string | null>(null);
  const [moveArmedAssignmentId, setMoveArmedAssignmentId] = useState<string | null>(null);
  const [pendingDragMove, setPendingDragMove] = useState<PendingDragMove | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<BrowserAppointmentRecord | null>(null);
  const [undoSupportAssignmentId, setUndoSupportAssignmentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManage = principal.active && principal.capabilities.has('scheduling.manage');
  const actor = useMemo(() => ({ id: principal.userId, name: principal.displayName }), [principal.displayName, principal.userId]);

  useEffect(() => {
    setAppointments(loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []));
    setStorageReady(true);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    saveBrowserValue(browserKeys.appointments, appointments);
  }, [appointments, storageReady]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMoveArmedAppointmentId(null);
        setMoveArmedAssignmentId(null);
        setPendingDragMove(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const jobs = useMemo(() => appointments.flatMap(appointmentAssignments), [appointments]);
  const activeDay = week.find((day) => day.dateKey === activeDate) ?? week[0];
  const activeJobs = jobs.filter((job) => job.dateKey === activeDate);
  const activeSlots = displaySlotsForDay(activeDay);
  const activeOccupancy = occupancyForDay(activeDay, jobs);
  const confirmed = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'confirmed').length;
  const holds = appointments.filter((appointment) => appointment.dateKey === activeDate && appointment.status === 'temporary_hold').length;
  const attention = activeJobs.filter((job) => job.isPrimaryAssignment && (job.readiness === 'blocked' || job.readiness === 'at_risk')).length;
  const selectedAppointment = selectedAppointmentId ? appointments.find((item) => item.id === selectedAppointmentId) : undefined;
  const armedAppointment = moveArmedAppointmentId ? appointments.find((item) => item.id === moveArmedAppointmentId) : undefined;
  const armedAssignment = armedAppointment && moveArmedAssignmentId ? armedAppointment.assignments.find((item) => item.id === moveArmedAssignmentId) : undefined;
  const dragCandidates = useMemo(() => {
    if (!armedAppointment || !armedAssignment) return [];
    if (!armedAssignment.isPrimaryAssignment) {
      return validSupportMoveCandidates(activeDay, armedAppointment, armedAssignment.id, activeJobs)
        .filter((slot) => !(slot.vanId === armedAssignment.vanId && slot.start === armedAssignment.start));
    }
    const current = appointmentSnapshot(armedAppointment);
    return validMoveCandidates(activeDay, armedAppointment, activeJobs)
      .filter((slot) => !(slot.vanId === current.primaryVanId && slot.start === current.primaryStart));
  }, [activeDay, activeJobs, armedAppointment, armedAssignment]);

  const syncExistingWorkOrder = (next: BrowserAppointmentRecord) => {
    if (!next.workOrderId) return;
    const workOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    saveBrowserValue(browserKeys.workOrders, workOrders.map((order) => order.appointmentId === next.id ? syncWorkOrderFromAppointment(order, next) : order));
  };

  const persistAppointmentUpdate = (next: BrowserAppointmentRecord, message: string, previousForUndo?: BrowserAppointmentRecord, supportAssignmentForUndo?: string, openDetails = true) => {
    setAppointments((items) => items.map((item) => item.id === next.id ? next : item));
    syncExistingWorkOrder(next);
    setSelectedAppointmentId(openDetails ? next.id : null);
    setUndoSnapshot(previousForUndo ?? null);
    setUndoSupportAssignmentId(previousForUndo ? supportAssignmentForUndo ?? null : null);
    setNotice(message);
    if (next.dateKey !== activeDate && next.status !== 'cancelled') setActiveDate(next.dateKey);
  };

  const disarmMove = () => {
    setMoveArmedAppointmentId(null);
    setMoveArmedAssignmentId(null);
  };

  const openBooking = (slot?: PreferredSlot) => {
    setPreferredSlot(slot ?? {});
    setSelectedAppointmentId(null);
    setPendingDragMove(null);
    disarmMove();
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
      assignments.push({ ...primary, id: `${appointmentId}-S`, start: slot.supportStart ?? primary.start, end: slot.supportEnd ?? primary.end, segment: slot.supportSegment ?? primary.segment, vanId: slot.supportVanId, quantity: slot.supportUnits ?? Math.max(1, request.quantity - primaryQty), isPrimaryAssignment: false, customerCommunicationOwner: false, supportForJobId: primaryId });
    }
    let record: BrowserAppointmentRecord = {
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
    record = appendLifecycleEvent(record, { kind: 'created', actorId: actor.id, actorName: actor.name, to: appointmentSnapshot(record) });
    setAppointments((current) => [...current, record]);
    setDrawerOpen(false);
    setPreferredSlot({});
    const supportText = slot.supportVanId ? ` with linked support from ${slot.supportVanId.replace('VAN-', 'Van ')}` : '';
    setNotice(`${record.customerFacingDescription} placed on temporary hold for ${slot.vanId.replace('VAN-', 'Van ')}${supportText} at ${formatTime(slot.start)}.`);
  };

  const confirmAppointment = (appointmentId: string) => {
    const current = appointments.find((appointment) => appointment.id === appointmentId);
    if (!current || current.status !== 'temporary_hold' || !canManage) return;
    const workOrderId = current.workOrderId ?? `WO-${appointmentId.replace(/^APT-/, '').slice(-6)}`;
    let confirmedRecord: BrowserAppointmentRecord = { ...current, status: 'confirmed', workOrderId, confirmedAt: new Date().toISOString(), assignments: current.assignments.map((assignment) => ({ ...assignment, status: 'confirmed' })) };
    confirmedRecord = appendLifecycleEvent(confirmedRecord, { kind: 'confirmed', actorId: actor.id, actorName: actor.name, from: appointmentSnapshot(current), to: appointmentSnapshot(confirmedRecord) });
    setAppointments((items) => items.map((item) => item.id === appointmentId ? confirmedRecord : item));
    const workOrders = loadBrowserValue<BrowserWorkOrderRecord[]>(browserKeys.workOrders, []);
    if (!workOrders.some((order) => order.appointmentId === appointmentId)) saveBrowserValue(browserKeys.workOrders, [...workOrders, createBrowserWorkOrder(confirmedRecord)]);
    setNotice(`${appointmentId} confirmed and linked to ${workOrderId}.`);
  };

  const applySupportReflow = (plan: SupportReflowPlan) => {
    if (!canManage) return;
    const appointment = appointments.find((item) => item.assignments.some((assignment) => assignment.id === plan.supportJobId));
    if (!appointment) {
      setNotice('Booking Intelligence could not find the support assignment to optimize. Refresh the schedule and try again.');
      return;
    }
    const from = appointmentSnapshot(appointment);
    const base: BrowserAppointmentRecord = { ...appointment, updatedAt: new Date().toISOString(), assignments: appointment.assignments.map((assignment) => assignment.id === plan.supportJobId ? { ...assignment, start: plan.toStart, end: plan.toEnd, segment: plan.toSegment } : assignment) };
    const updated = appendLifecycleEvent(base, { kind: 'support_reflow', actorId: actor.id, actorName: actor.name, reason: 'Booking Intelligence capacity recovery', from, to: appointmentSnapshot(base) });
    setAppointments((items) => items.map((item) => item.id === updated.id ? updated : item));
    syncExistingWorkOrder(updated);
    setUndoSnapshot(null);
    setUndoSupportAssignmentId(null);
    setNotice(`Booking Intelligence moved support for ${plan.customer} from ${formatTime(plan.fromStart)} to ${formatTime(plan.toStart)}. The new customer request can now recalculate against the recovered capacity.`);
  };

  const toggleMoveArm = (appointmentId: string, assignmentId?: string) => {
    if (!canManage) return;
    const appointment = appointments.find((item) => item.id === appointmentId);
    if (!appointment) return;
    const primary = appointment.assignments.find((item) => item.isPrimaryAssignment) ?? appointment.assignments[0];
    const targetAssignmentId = assignmentId ?? primary?.id;
    if (!targetAssignmentId) return;
    const target = appointment.assignments.find((item) => item.id === targetAssignmentId);
    if (!target) return;
    const disarming = moveArmedAppointmentId === appointmentId && moveArmedAssignmentId === targetAssignmentId;
    setDrawerOpen(false);
    setSelectedAppointmentId(null);
    setPendingDragMove(null);
    setMoveArmedAppointmentId(disarming ? null : appointmentId);
    setMoveArmedAssignmentId(disarming ? null : targetAssignmentId);
    const scope = target.isPrimaryAssignment ? 'linked appointment' : `support assignment (${target.quantity} unit${target.quantity === 1 ? '' : 's'})`;
    setNotice(disarming ? 'Drag mode disarmed.' : `Move mode armed for the ${scope}. Hold and drag it to a highlighted valid slot. Press Esc to cancel.`);
  };

  const dropMove = (vanId: string, start: string) => {
    if (!armedAppointment || !armedAssignment || !canManage) return;
    const slot = dragCandidates.find((item) => item.vanId === vanId && item.start === start);
    if (!slot) {
      setNotice('That drop target is no longer valid. Booking Intelligence blocked the move.');
      return;
    }

    let customerNotificationRecommended = false;
    if (!armedAssignment.isPrimaryAssignment) {
      const preview = applySupportAssignmentMove({ record: armedAppointment, supportAssignmentId: armedAssignment.id, slot, actor, reason: 'Drag-and-drop support reassignment' });
      if (!preview.ok) {
        setNotice(preview.message);
        return;
      }
    } else {
      customerNotificationRecommended = applyAppointmentScheduleChange({ record: armedAppointment, slot, dateKey: activeDate, kind: 'operational_move', actor, reason: 'Drag-and-drop dispatch optimization' }).customerNotificationRecommended;
    }

    setPendingDragMove({
      appointmentId: armedAppointment.id,
      assignmentId: armedAssignment.id,
      customer: armedAppointment.customer,
      scope: armedAssignment.isPrimaryAssignment ? 'primary' : 'support',
      fromVanId: armedAssignment.vanId,
      fromStart: armedAssignment.start,
      fromEnd: armedAssignment.end,
      targetVanId: slot.vanId,
      targetStart: slot.start,
      targetEnd: slot.end,
      customerNotificationRecommended,
    });
    setNotice(null);
    setSelectedAppointmentId(null);
    disarmMove();
  };

  const cancelPendingDragMove = () => {
    setPendingDragMove(null);
    setSelectedAppointmentId(null);
    setNotice('Move cancelled. No scheduling changes were saved.');
  };

  const confirmPendingDragMove = () => {
    const pending = pendingDragMove;
    if (!pending || !canManage) return;
    const current = appointments.find((item) => item.id === pending.appointmentId);
    if (!current || current.status === 'cancelled') {
      setPendingDragMove(null);
      setNotice('This appointment is no longer available to move. Nothing was changed.');
      return;
    }
    const assignment = current.assignments.find((item) => item.id === pending.assignmentId);
    const day = buildOperationalWeek(current.dateKey).find((item) => item.dateKey === current.dateKey);
    const targetJobs = jobs.filter((job) => job.dateKey === current.dateKey);
    if (!assignment || !day) {
      setPendingDragMove(null);
      setNotice('Booking Intelligence could not revalidate this move. Nothing was changed.');
      return;
    }

    if (!assignment.isPrimaryAssignment) {
      const slot = validSupportMoveCandidates(day, current, assignment.id, targetJobs).find((item) => item.vanId === pending.targetVanId && item.start === pending.targetStart);
      if (!slot) {
        setPendingDragMove(null);
        setNotice('That support destination is no longer valid. The original schedule was preserved.');
        return;
      }
      const result = applySupportAssignmentMove({ record: current, supportAssignmentId: assignment.id, slot, actor, reason: 'Confirmed drag-and-drop support reassignment' });
      if (!result.ok) {
        setPendingDragMove(null);
        setNotice(result.message);
        return;
      }
      persistAppointmentUpdate(result.record, `Support reassigned to ${slot.vanId.replace('VAN-', 'Van ')} at ${formatTime(slot.start)}. The primary appointment and customer-facing schedule were not changed.`, current, assignment.id, false);
      setPendingDragMove(null);
      return;
    }

    const slot = validMoveCandidates(day, current, targetJobs).find((item) => item.vanId === pending.targetVanId && item.start === pending.targetStart);
    if (!slot) {
      setPendingDragMove(null);
      setNotice('That destination is no longer valid. The original schedule was preserved.');
      return;
    }
    const result = applyAppointmentScheduleChange({ record: current, slot, dateKey: current.dateKey, kind: 'operational_move', actor, reason: 'Confirmed drag-and-drop dispatch optimization' });
    persistAppointmentUpdate(result.record, result.customerNotificationRecommended ? 'Appointment moved. The promised time changed; customer notification is recommended.' : 'Appointment reassigned successfully. The promised customer time did not change.', current, undefined, false);
    setPendingDragMove(null);
  };

  const undoMove = () => {
    if (!undoSnapshot) return;
    const current = appointments.find((item) => item.id === undoSnapshot.id);
    if (!current) {
      setUndoSnapshot(null);
      setUndoSupportAssignmentId(null);
      return;
    }
    const targetJobs = jobs.filter((job) => job.dateKey === undoSnapshot.dateKey);

    if (undoSupportAssignmentId) {
      const oldSupport = undoSnapshot.assignments.find((item) => item.id === undoSupportAssignmentId && !item.isPrimaryAssignment);
      const day = buildOperationalWeek(undoSnapshot.dateKey).find((item) => item.dateKey === undoSnapshot.dateKey);
      const candidates = day ? validSupportMoveCandidates(day, current, undoSupportAssignmentId, targetJobs) : [];
      const slot = oldSupport ? candidates.find((item) => item.vanId === oldSupport.vanId && item.start === oldSupport.start) : undefined;
      if (!slot) {
        setNotice('Undo is no longer safe because the original support work spot is no longer available.');
        setUndoSnapshot(null);
        setUndoSupportAssignmentId(null);
        return;
      }
      const result = applySupportAssignmentMove({ record: current, supportAssignmentId: undoSupportAssignmentId, slot, actor, reason: 'Undo previous support reassignment', kind: 'undo_move' });
      if (!result.ok) {
        setNotice(result.message);
        setUndoSnapshot(null);
        setUndoSupportAssignmentId(null);
        return;
      }
      persistAppointmentUpdate(result.record, 'Support reassignment undone. The original support work spot was revalidated before restoring it.');
      disarmMove();
      return;
    }

    const candidates = validRescheduleCandidates(undoSnapshot.dateKey, current, targetJobs).slots;
    const old = appointmentSnapshot(undoSnapshot);
    const slot = candidates.find((item) => item.vanId === old.primaryVanId && item.start === old.primaryStart);
    if (!slot) {
      setNotice('Undo is no longer safe because the original work spot is no longer available.');
      setUndoSnapshot(null);
      return;
    }
    const result = applyAppointmentScheduleChange({ record: current, slot, dateKey: undoSnapshot.dateKey, kind: 'undo_move', actor, reason: 'Undo previous operational move' });
    persistAppointmentUpdate(result.record, 'Operational move undone. The original work spot was revalidated before restoring it.');
    disarmMove();
  };

  const moveDay = (direction: -1 | 1) => setActiveDate((current) => addDays(current, direction));

  return <section className={styles.page}>
    <header className={styles.pageHeader}><div><span className={styles.eyebrow}>Operations · Aruba</span><h1>Scheduling & Dispatch</h1><p>See the operational week, all four vans and every available work spot from one primary agenda view.</p></div><div className={styles.pageActions}><button type="button" className={styles.secondary}>Capacity settings</button><button type="button" className={styles.primary} disabled={!activeDay.isOpen || !canManage} onClick={() => openBooking()}>+ New appointment</button></div></header>

    {notice ? <div className={styles.notice}><span>{notice}</span><div style={{ display: 'flex', gap: 7 }}>{undoSnapshot ? <button type="button" onClick={undoMove} style={{ fontSize: 7, fontWeight: 900 }}>Undo Move</button> : null}<button type="button" onClick={() => setNotice(null)}>×</button></div></div> : null}

    <section className={styles.weekStrip} aria-label="Operational week">{week.map((day) => { const summary = occupancyForDay(day, jobs); return <button type="button" key={day.dateKey} disabled={!day.isOpen} className={`${styles.dayCard} ${day.dateKey === activeDate ? styles.dayActive : ''} ${day.dateKey === today ? styles.today : ''}`} onClick={() => setActiveDate(day.dateKey)}><div><span>{day.weekday}</span><strong>{day.shortDate}</strong>{day.dateKey === today ? <b>TODAY</b> : null}</div><small>{day.shiftLabel}</small>{day.isOpen ? <><i><em style={{ width: `${summary.percent}%` }} /></i><p>{summary.occupied}/{summary.total} spots filled · {summary.open} open</p></> : <p>Operationally closed</p>}</button>; })}</section>

    <div className={styles.metrics}><article><span>Confirmed</span><strong>{confirmed}</strong><small>{activeDay.weekday} {activeDay.shortDate}</small><i style={{ width: `${Math.min(100, activeOccupancy.percent)}%` }} /></article><article><span>Temporary Holds</span><strong>{holds}</strong><small>Awaiting confirmation</small><i style={{ width: `${Math.min(100, holds * 14)}%` }} /></article><article><span>Need Attention</span><strong className={attention ? styles.metricWarning : ''}>{attention}</strong><small>At risk or blocked assignments</small><i style={{ width: `${Math.min(100, attention * 16)}%` }} /></article><article><span>Open Spots</span><strong className={activeOccupancy.open ? styles.metricGood : ''}>{activeOccupancy.open}</strong><small>{activeOccupancy.occupied}/{activeOccupancy.total} occupied today</small><i style={{ width: `${activeOccupancy.total ? Math.round((activeOccupancy.open / activeOccupancy.total) * 100) : 0}%` }} /></article></div>

    <div className={styles.toolbar}><div className={styles.dayNav}><button type="button" onClick={() => moveDay(-1)}>‹</button><div><strong>{activeDate === today ? 'Today' : `${activeDay.weekday} · ${activeDay.shortDate}`}</strong><span>{activeDay.shiftLabel} · Aruba time</span></div><button type="button" onClick={() => moveDay(1)}>›</button></div><div className={styles.legend}><span><i className={styles.readyDot} /> Ready</span><span><i className={styles.riskDot} /> At risk</span><span><i className={styles.blockedDot} /> Blocked</span><span><i className={styles.holdDot} /> Hold</span><span><i className={styles.openDot} /> Open spot</span></div></div>

    {moveArmedAppointmentId && armedAssignment ? <div className={styles.notice}><span><strong>{armedAssignment.isPrimaryAssignment ? 'MOVE MODE' : 'SUPPORT MOVE MODE'}:</strong> {armedAssignment.isPrimaryAssignment ? 'The linked appointment is armed.' : `Only this ${armedAssignment.quantity}-unit support assignment is armed; the primary appointment stays fixed.`} Valid drop targets are highlighted.</span><button type="button" onClick={disarmMove}>Disarm</button></div> : null}

    <section className={styles.bookingIntelligence}><div className={styles.aiBadge}>AI</div><div className={styles.intelligenceTitle}><strong>Booking Intelligence</strong><span>Deterministic booking engine</span></div><div className={styles.intelligenceInsight}><span>Date-aware capacity</span><p>{activeOccupancy.open} open spot{activeOccupancy.open === 1 ? '' : 's'} across four vans on the selected day.</p></div><div className={styles.intelligenceInsight}><span>Lifecycle-aware</span><p>Moves, cancellations and reschedules preserve appointment and Work Order history instead of creating silent duplicates.</p></div><div className={styles.intelligenceInsight}><span>Route-aware offers</span><p>The booking engine enforces sector anchors, duration, restrictions, support-van rules and protected drop targets.</p></div><button type="button" disabled={!activeDay.isOpen || !canManage} onClick={() => openBooking()}>Find valid appointment</button></section>

    <section className={styles.board}><header className={styles.boardHeader}><div><strong>Four-Van Schedule</strong><span>{activeDay.weekday} {activeDay.shortDate} · single click opens details; double click arms safe drag.</span></div><b>{activeOccupancy.open} OPEN SPOTS</b></header><div className={styles.boardScroll}><div className={styles.vanGrid}>{previewVans.map((van) => { const vanJobs = activeJobs.filter((job) => job.vanId === van.id); const amAnchor = getHalfDayAnchor(activeJobs, van.id, 'am'); const pmAnchor = getHalfDayAnchor(activeJobs, van.id, 'pm'); const validDropStarts = new Set(dragCandidates.filter((slot) => slot.vanId === van.id).map((slot) => slot.start)); return <section className={styles.vanLane} key={van.id}><header><div className={styles.vanIdentity}><span>{van.id.replace('VAN-', 'V')}</span><div><strong>{van.name}</strong><small>{van.team}</small></div></div><b>ACTIVE</b></header><div className={styles.anchorBar}><div><span>AM anchor</span><strong>{amAnchor?.sector ?? 'Open'}</strong></div><div><span>PM anchor</span><strong>{pmAnchor?.sector ?? 'Open'}</strong></div></div><VanScheduleSlots vanId={van.id} slots={activeSlots} jobs={vanJobs} onConfirm={confirmAppointment} onOpen={(start) => openBooking({ vanId: van.id, start })} onSelect={(appointmentId) => { setDrawerOpen(false); setSelectedAppointmentId(appointmentId); }} onToggleArm={toggleMoveArm} armedAppointmentId={moveArmedAppointmentId} armedAssignmentId={moveArmedAssignmentId} selectedAppointmentId={selectedAppointmentId} validDropStarts={validDropStarts} canManage={canManage} onDropMove={dropMove} />{!activeDay.isOpen ? <div className={styles.closedDay}>No operational capacity</div> : null}</section>; })}</div></div></section>

    {drawerOpen ? <BookingDrawer day={activeDay} jobs={activeJobs} preferred={preferredSlot} onClose={() => { setDrawerOpen(false); setPreferredSlot({}); }} onReserve={addAppointment} onApplySupportReflow={applySupportReflow} /> : null}
    {selectedAppointment ? <AppointmentDetailsDrawer appointment={selectedAppointment} allJobs={jobs} canManage={canManage} actor={actor} moveArmed={moveArmedAppointmentId === selectedAppointment.id} onArmMove={() => toggleMoveArm(selectedAppointment.id, selectedAppointment.assignments.find((item) => item.isPrimaryAssignment)?.id)} onClose={() => setSelectedAppointmentId(null)} onUpdate={persistAppointmentUpdate} /> : null}
    {pendingDragMove ? <DragMoveConfirmation move={pendingDragMove} onCancel={cancelPendingDragMove} onConfirm={confirmPendingDragMove} /> : null}
  </section>;
}

function VanScheduleSlots({ vanId, slots, jobs, onConfirm, onOpen, onSelect, onToggleArm, armedAppointmentId, armedAssignmentId, selectedAppointmentId, validDropStarts, canManage, onDropMove }: { vanId: string; slots: DisplaySlot[]; jobs: CalendarDispatchJob[]; onConfirm: (appointmentId: string) => void; onOpen: (start: string) => void; onSelect: (appointmentId: string) => void; onToggleArm: (appointmentId: string, assignmentId: string) => void; armedAppointmentId: string | null; armedAssignmentId: string | null; selectedAppointmentId: string | null; validDropStarts: Set<string>; canManage: boolean; onDropMove: (vanId: string, start: string) => void }) {
  const rows: React.ReactNode[] = [];
  let index = 0;
  while (index < slots.length) {
    const slot = slots[index];
    const previous = slots[index - 1];
    if (index > 0 && previous?.segment === 'am' && slot.segment === 'pm') rows.push(<div className={styles.lunchRow} key={`lunch-${slot.start}`}><span>12:00</span><div>Lunch / reset</div><span>1:00</span></div>);
    const startingJobs = jobs.filter((job) => job.start === slot.start).sort((a, b) => a.id.localeCompare(b.id));
    if (startingJobs.length) {
      const job = startingJobs[0];
      const span = jobSpanFromIndex(job, slots, index);
      const appointmentId = appointmentIdForJob(job);
      rows.push(<AppointmentBlock key={job.id} job={job} span={span} crossesLunch={jobCrossesLunch(job)} onConfirm={onConfirm} onSelect={onSelect} onToggleArm={onToggleArm} armed={Boolean(appointmentId && armedAppointmentId === appointmentId && armedAssignmentId === job.id)} selected={Boolean(appointmentId && selectedAppointmentId === appointmentId)} canManage={canManage} />);
      index += span;
      continue;
    }
    const continuingJob = jobs.find((job) => overlapsSlot(job, slot) && timeToMinutes(job.start) < timeToMinutes(slot.start));
    if (continuingJob) {
      rows.push(<div className={styles.occupiedSlot} key={`${continuingJob.id}-${slot.start}`}><div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div><div className={styles.slotJobs}><article className={styles.jobCard}><div><div className={styles.jobTitle}><strong>Reserved</strong></div><span>Part of {formatTime(continuingJob.start)}–{formatTime(continuingJob.end)} appointment</span></div></article></div></div>);
      index += 1;
      continue;
    }
    const dropAllowed = Boolean(armedAssignmentId && validDropStarts.has(slot.start));
    rows.push(<button type="button" className={styles.openSlot} style={dropAllowed ? { borderColor: 'var(--brand)', background: 'var(--brand-soft)', boxShadow: '0 0 0 2px color-mix(in srgb,var(--brand) 16%,transparent)' } : armedAssignmentId ? { opacity: .58 } : undefined} key={`open-${slot.start}`} onClick={() => { if (!armedAssignmentId) onOpen(slot.start); }} onDragOver={(event) => { if (dropAllowed) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={(event) => { if (!dropAllowed) return; event.preventDefault(); onDropMove(vanId, slot.start); }}><div className={styles.slotTime}><strong>{formatTime(slot.start)}</strong><span>{formatTime(slot.end)}</span></div><div><strong>{dropAllowed ? 'Valid move target' : 'Available'}</strong><span>{dropAllowed ? 'Release assignment here' : armedAssignmentId ? 'Not valid for armed assignment' : 'Open work spot'}</span></div><b>{dropAllowed ? 'DROP HERE' : armedAssignmentId ? 'LOCKED' : '+ Schedule'}</b></button>);
    index += 1;
  }
  return <div className={styles.slotList}>{rows}</div>;
}

function AppointmentBlock({ job, span, crossesLunch, onConfirm, onSelect, onToggleArm, armed, selected, canManage }: { job: CalendarDispatchJob; span: number; crossesLunch: boolean; onConfirm: (appointmentId: string) => void; onSelect: (appointmentId: string) => void; onToggleArm: (appointmentId: string, assignmentId: string) => void; armed: boolean; selected: boolean; canManage: boolean }) {
  const appointmentId = appointmentIdForJob(job);
  const minHeight = span * 64 + Math.max(0, span - 1) * 6 + (crossesLunch ? 18 : 0);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleClick = () => { if (!appointmentId) return; if (clickTimer.current) clearTimeout(clickTimer.current); clickTimer.current = setTimeout(() => onSelect(appointmentId), 220); };
  const handleDoubleClick = () => { if (!appointmentId || !canManage) return; if (clickTimer.current) clearTimeout(clickTimer.current); onToggleArm(appointmentId, job.id); };
  const interactionStyle: React.CSSProperties = { minHeight: '100%', alignItems: 'center', ...(armed ? { outline: '2px solid var(--brand)', boxShadow: '0 0 0 4px var(--brand-soft)', cursor: 'grab' } : selected ? { outline: '1px solid color-mix(in srgb,var(--brand) 50%,var(--border))' } : { cursor: 'pointer' }) };
  return <div className={styles.occupiedSlot} style={{ minHeight }}><div className={styles.slotTime}><strong>{formatTime(job.start)}</strong><span>{formatTime(job.end)}</span>{span > 1 ? <span>{span} spots</span> : null}</div><div className={styles.slotJobs}><article className={`${styles.jobCard} ${job.status === 'temporary_hold' ? styles.holdCard : ''}`} style={interactionStyle} title={canManage ? `Single click: details · Double click: arm ${job.isPrimaryAssignment ? 'linked appointment' : 'support-only'} drag` : 'Single click: details'} onClick={handleClick} onDoubleClick={handleDoubleClick} draggable={Boolean(armed && canManage)} onDragStart={(event) => { if (!armed || !appointmentId) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', job.id); }}><div><div className={styles.jobTitle}><strong>{job.customer}</strong><b className={slotClass(job.readiness)}>{readinessLabel(job.readiness)}</b></div><span>{presetLabel(job.presetId)} · {job.quantity} unit{job.quantity === 1 ? '' : 's'}</span><small>{job.site} · {job.sector}{job.supportForJobId ? ' · Support assignment' : ''}</small>{span > 1 ? <small>Reserved continuously · {formatTime(job.start)}–{formatTime(job.end)}</small> : null}{crossesLunch ? <small>12:00–1:00 PM lunch/reset remains protected</small> : null}{armed ? <small><strong>{job.isPrimaryAssignment ? 'MOVE ARMED' : 'SUPPORT MOVE ARMED'} · hold and drag</strong></small> : null}</div>{appointmentId && job.status === 'temporary_hold' && job.isPrimaryAssignment && canManage ? <button type="button" onClick={(event) => { event.stopPropagation(); onConfirm(appointmentId); }}>Confirm</button> : null}</article></div></div>;
}
