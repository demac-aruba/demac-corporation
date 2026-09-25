'use strict';

const { hashKey } = require('./bookingAuthorityCore');
const { arubaDateParts, capacitySlotsForOwnership, isHalfDay, minutesTime, timeMinutes,
  orderBlocksCapacity } = require('./bookingSchedulingPrimitives');
const { COLLECTION, authorize, fail, identifier } = require('./projectRecords');
const { conflicts, lockId } = require('./projectHistoricalBooking');
const { readProjectUsage } = require('./projectSlotUsage');
const { assertNoLinkedCommercialEvidence, assertNoFieldExecutionEvidence, assertNoProjectAssignmentExecution } = require('./projectCommercialGuard');

const text = value => String(value ?? '').trim();
const sameCrew = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

function inputValue(value) {
  const input = {
    projectId: identifier(value.projectId), appointmentId: identifier(value.appointmentId),
    requestId: identifier(value.requestId), expectedVersion: Number(value.expectedVersion),
    slots: Number(value.slots), reason: text(value.reason),
    overBudgetAcknowledged: value.overBudgetAcknowledged === true,
    noBillingAcknowledged: value.noBillingAcknowledged === true,
  };
  if (input.requestId.length < 8 || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1
    || !Number.isSafeInteger(input.slots) || input.slots < 1 || input.slots > 6
    || input.reason.length < 5 || input.reason.length > 1000) {
    fail('Project, appointment, stable request ID, version, 1–6 whole slots and a correction reason are required.');
  }
  return input;
}

async function readContext({ db, get, project, projectId, appointmentId, now }) {
  if (!project || project.id !== projectId) fail('Published Project is required.');
  const [appointmentSnap, claimSnap, halfDaySnapshot] = await Promise.all([
    get(db.collection('appointments').doc(appointmentId)),
    get(db.collection('projectBookingClaims').doc(appointmentId)),
    get(db.collection('vanHalfDaySchedules')),
  ]);
  const appointment = appointmentSnap.exists ? appointmentSnap.data() : null;
  const claim = claimSnap.exists ? claimSnap.data() : null;
  if (!appointment || !claim || claim.projectId !== projectId || claim.appointmentId !== appointmentId
    || (appointment.projectId && appointment.projectId !== projectId)) fail('Published Project booking identity is inconsistent.');
  if (appointment.status !== 'confirmed' || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date)
    || appointment.date >= arubaDateParts(now).date) fail('Choose a confirmed Project appointment before today in Aruba.');
  if (appointment.assignments?.length !== 1 || appointment.workOrderIds?.length !== 1) {
    fail('Only a single-Van Project appointment can have historical slots adjusted.');
  }
  const assignment = appointment.assignments[0];
  const workOrderId = identifier(appointment.workOrderIds[0]);
  const links = project.assignments.filter(link => link.appointmentId === appointmentId);
  if (links.length !== 1 || links[0].workOrderId !== workOrderId || links[0].projectId !== projectId
    || (claim.phaseId && claim.phaseId !== links[0].phaseId)
    || (appointment.projectPhaseId && appointment.projectPhaseId !== links[0].phaseId)) {
    fail('Project assignment and canonical booking disagree.');
  }
  assertNoProjectAssignmentExecution(links[0]);
  if (!assignment.vanId || !Array.isArray(assignment.technicianIds) || !assignment.technicianIds.length
    || !text(appointment.startTime) || text(assignment.time || appointment.startTime) !== appointment.startTime
    || appointment.primaryVanId !== assignment.vanId) {
    fail('Historical Van, crew or start is not verifiable.');
  }
  const orderSnap = await get(db.collection('workOrders').doc(workOrderId));
  const order = orderSnap.exists ? orderSnap.data() : null;
  if (!order || order.appointmentId !== appointmentId || order.clientId !== project.customerId
    || order.propertyId !== project.siteId || appointment.customerId !== project.customerId
    || appointment.propertyId !== project.siteId || order.date !== appointment.date
    || order.time !== appointment.startTime || order.vanId !== assignment.vanId
    || !sameCrew(order.technicianIds, assignment.technicianIds)
    || (order.projectId && order.projectId !== projectId)
    || (order.projectPhaseId && order.projectPhaseId !== links[0].phaseId)) {
    fail('Appointment and Work Order identities or crew disagree.');
  }
  if ((links[0].scheduledDate && links[0].scheduledDate !== appointment.date)
    || (links[0].scheduledStart && links[0].scheduledStart !== appointment.startTime)
    || (links[0].vanId && links[0].vanId !== assignment.vanId)
    || (links[0].technicianIds && !sameCrew(links[0].technicianIds, assignment.technicianIds))) {
    fail('Project planning link differs from the canonical appointment. Reconcile the reschedule before adjusting slots.');
  }
  const currentSlots = Number(assignment.slots);
  if (!Number.isSafeInteger(currentSlots) || currentSlots < 1 || currentSlots > 6
    || Number(order.scheduledSlots) !== currentSlots) fail('Current Project slots disagree with the Work Order.');
  if (!Array.isArray(halfDaySnapshot.docs)) fail('Historical Van capacity policy could not be read.');
  const halfDay = isHalfDay(assignment.vanId, appointment.date, halfDaySnapshot.docs.map(doc => doc.data()));
  const currentAnchors = capacitySlotsForOwnership(appointment.startTime, currentSlots, halfDay);
  if (currentAnchors.length !== currentSlots) fail('Current slots do not fit the canonical Van day.');
  const currentCapacityEnd = minutesTime(timeMinutes(currentAnchors.at(-1)) + 60);
  if (appointment.capacityEndTime !== currentCapacityEnd || order.appointmentCapacityEndTime !== currentCapacityEnd) {
    fail('Recorded capacity end disagrees with canonical slots.');
  }
  if (links[0].scheduledEnd && links[0].scheduledEnd !== currentCapacityEnd) {
    fail('Project planning link end differs from canonical capacity. Reconcile the reschedule before adjusting slots.');
  }
  const ownedIds = Array.isArray(appointment.capacityLockIds) ? appointment.capacityLockIds : [];
  if (ownedIds.length !== currentSlots || new Set(ownedIds).size !== currentSlots
    || currentAnchors.some(slot => !ownedIds.includes(lockId(appointment.date, assignment.vanId, slot)))) {
    fail('Canonical capacity-lock ownership is ambiguous.');
  }
  const lockSnapshots = await Promise.all(currentAnchors.map(slot => get(db.collection('bookingCapacityLocks').doc(lockId(appointment.date, assignment.vanId, slot)))));
  for (let index = 0; index < lockSnapshots.length; index += 1) {
    const lock = lockSnapshots[index].exists ? lockSnapshots[index].data() : null;
    if (!lock || lock.active !== true || lock.appointmentId !== appointmentId
      || lock.date !== appointment.date || lock.vanId !== assignment.vanId || lock.slot !== currentAnchors[index]) {
      fail('Canonical capacity locks no longer match this Project booking.');
    }
  }
  const ownedSnapshot = await get(db.collection('bookingCapacityLocks').where('appointmentId', '==', appointmentId));
  if (!Array.isArray(ownedSnapshot.docs)) fail('Owned capacity locks could not be reconciled.');
  if (ownedSnapshot.docs.some(doc => doc.data().active !== false && !ownedIds.includes(doc.id))) {
    fail('Project booking has additional active capacity locks outside its snapshot.');
  }
  await assertNoFieldExecutionEvidence({ db, get, appointment, order, workOrderId, appointmentId,
    allowSyntheticBackdatedMarker: true });
  await assertNoLinkedCommercialEvidence({ db, get, appointment, order, workOrderId, appointmentId });
  return { appointment, assignment, order, workOrderId, link: links[0], halfDay, currentSlots, currentAnchors };
}

function createProjectHistoricalCapacityAuthority({ db, clock = () => new Date() }) {
  async function sources(uid, projectId) {
    await authorize(db, uid, true);
    const id = identifier(projectId);
    const snapshot = await db.collection(COLLECTION).doc(id).get();
    if (!snapshot.exists) fail('Publish the Project before adjusting historical slots.');
    const project = snapshot.data();
    const usage = await readProjectUsage(db, ref => ref.get(), project);
    const candidates = [...new Set(project.assignments.map(link => link.appointmentId))];
    const rows = [];
    for (const appointmentId of candidates) {
      const snapshot = await db.collection('appointments').doc(identifier(appointmentId)).get();
      const appointment = snapshot.exists ? snapshot.data() : null;
      if (!appointment || appointment.status !== 'confirmed' || appointment.assignments?.length !== 1
        || !/^\d{4}-\d{2}-\d{2}$/.test(appointment.date) || appointment.date >= arubaDateParts(clock()).date) continue;
      const base = { appointmentId, workOrderId: appointment.workOrderIds?.[0] || '', date: appointment.date,
        vanId: appointment.assignments[0].vanId || '', vanName: appointment.assignments[0].vanName || appointment.assignments[0].vanId || '',
        technicianIds: appointment.assignments[0].technicianIds || [], start: appointment.startTime || '',
        currentSlots: Number(appointment.assignments[0].slots) || 0 };
      try {
        await readContext({ db, get: ref => ref.get(), project, projectId: id, appointmentId, now: clock() });
        rows.push({ ...base, eligible: true });
      } catch (error) {
        rows.push({ ...base, eligible: false, reason: error.message || 'Historical evidence requires review.' });
      }
    }
    const staffIds = [...new Set(rows.flatMap(row => row.technicianIds))];
    const staff = await Promise.all(staffIds.map(id => db.collection('staffProfiles').doc(identifier(id)).get()));
    const names = new Map(staff.map((snap, index) => [staffIds[index], snap.exists ? (snap.data().name || snap.data().fullName || staffIds[index]) : staffIds[index]]));
    return { success: true, project, budgetSlots: usage.budgetSlots, usedSlots: usage.usedSlots,
      sources: rows.map(row => ({ ...row, technicianNames: row.technicianIds.map(id => names.get(id) || id) }))
        .sort((a, b) => a.date.localeCompare(b.date) || a.appointmentId.localeCompare(b.appointmentId)) };
  }

  async function adjust(uid, rawInput) {
    const input = inputValue(rawInput);
    const fingerprint = hashKey(JSON.stringify({ ...input, uid }), 64);
    const auditRef = db.collection('projectCapacityCorrections').doc(hashKey(input.requestId, 64));
    return db.runTransaction(async transaction => {
      const actor = await authorize(db, uid, true, transaction);
      const get = ref => transaction.get(ref);
      const auditSnap = await get(auditRef);
      const projectRef = db.collection(COLLECTION).doc(input.projectId);
      const projectSnap = await get(projectRef);
      const project = projectSnap.exists ? projectSnap.data() : null;
      if (!project) fail('Published Project is required.');
      if (auditSnap.exists) {
        const replayedEntry = auditSnap.data();
        if (replayedEntry.fingerprint !== fingerprint) fail('This request ID was already used with different correction details.', 'conflict');
        const appointmentSnap = await get(db.collection('appointments').doc(input.appointmentId));
        const appointment = appointmentSnap.exists ? appointmentSnap.data() : null;
        const usageNow = await readProjectUsage(db, get, project);
        return { success: true, replayed: true, replayedEntry, project, appointmentId: input.appointmentId,
          workOrderId: replayedEntry.workOrderId, previousSlots: null,
          currentSlots: Number(appointment?.assignments?.[0]?.slots) || null,
          budgetSlots: usageNow.budgetSlots, usedBefore: replayedEntry.usedBefore,
          usedAfter: usageNow.usedSlots, usedNow: usageNow.usedSlots,
          overBudget: Math.max(0, usageNow.usedSlots - usageNow.budgetSlots) };
      }
      if (!input.noBillingAcknowledged) fail('Confirm that this booking has no invoice or payment, including outside DEMAC ERP.');
      if (project.serverVersion !== input.expectedVersion) fail('Project changed. Reload current slots and retry.', 'conflict');
      const context = await readContext({ db, get, project, projectId: input.projectId, appointmentId: input.appointmentId, now: clock() });
      const { appointment, assignment, order, workOrderId, link, halfDay, currentSlots, currentAnchors } = context;
      if (input.slots === currentSlots) fail('Choose a different whole-slot count.');
      const targetAnchors = capacitySlotsForOwnership(appointment.startTime, input.slots, halfDay);
      if (targetAnchors.length !== input.slots || currentAnchors.some((slot, index) => targetAnchors[index] !== slot && index < Math.min(input.slots, currentSlots))) {
        fail('Requested slots must be a contiguous tail of this historical Van allocation.');
      }
      const usage = await readProjectUsage(db, get, project);
      const usedAfter = usage.usedSlots + input.slots - currentSlots;
      const overBudget = Math.max(0, usedAfter - usage.budgetSlots);
      if (input.slots > currentSlots && overBudget > 0 && !input.overBudgetAcknowledged) {
        fail('This increase exceeds the approved Project slot budget. Explicit over-budget acknowledgement is required.');
      }
      const added = targetAnchors.slice(currentSlots);
      const removed = currentAnchors.slice(input.slots);
      const addedRefs = added.map(slot => db.collection('bookingCapacityLocks').doc(lockId(appointment.date, assignment.vanId, slot)));
      const addedSnaps = await Promise.all(addedRefs.map(get));
      if (addedSnaps.some(snap => snap.exists && snap.data().active !== false)) fail('Historical Van slot is already reserved or ambiguous.');
      if (added.length) {
        const sameDay = await get(db.collection('workOrders').where('date', '==', appointment.date));
        if (!Array.isArray(sameDay.docs)) fail('Historical same-day work could not be reconciled.');
        const target = { time: added[0], capacityEndTime: minutesTime(timeMinutes(added.at(-1)) + 60),
          assignments: [{ vanId: assignment.vanId, technicianIds: assignment.technicianIds }] };
        const ambiguousCrew = order => {
          if (!orderBlocksCapacity(order) || (Array.isArray(order.technicianIds)
            && order.technicianIds.every(id => typeof id === 'string' && id.trim()))) return false;
          const start = timeMinutes(order.time);
          const end = timeMinutes(order.appointmentCapacityEndTime || order.appointmentEndTime);
          return start === null || end === null || end <= start
            || (start < timeMinutes(target.capacityEndTime) && end > timeMinutes(target.time));
        };
        if (sameDay.docs.some(doc => doc.id !== workOrderId
          && (conflicts(doc.data(), target) || ambiguousCrew(doc.data())))) {
          fail('Historical Van or technician capacity is occupied or ambiguous.');
        }
      }
      const end = minutesTime(timeMinutes(targetAnchors.at(-1)) + 60);
      const elapsedMinutes = timeMinutes(end) - timeMinutes(appointment.startTime);
      if (!end || elapsedMinutes <= 0 || elapsedMinutes > 24 * 60) fail('Historical slot end is invalid.');
      const now = clock().toISOString();
      const delta = input.slots - currentSlots;
      const updatedLink = { ...link, scheduledSlots: input.slots, scheduledHours: input.slots, scheduledEnd: end };
      const updatedProject = { ...project, assignments: project.assignments.map(row => row === link ? updatedLink : row),
        // This legacy-named planning counter excludes posted assignments. Rebuild it
        // from unposted linked Work Orders instead of incrementing a stale snapshot.
        scheduledFutureHours: usage.unpostedScheduledSlots + delta, serverVersion: project.serverVersion + 1,
        updatedAtIso: now, updatedBy: actor.id };
      const historyEvent = { kind: 'project_historical_capacity_adjusted', requestId: input.requestId,
        at: now, actorId: actor.id, reason: input.reason, fromSlots: currentSlots, toSlots: input.slots,
        customerNotificationRecommended: false };
      const targetIds = targetAnchors.map(slot => lockId(appointment.date, assignment.vanId, slot));
      const appointmentPatch = { assignments: [{ ...assignment, slots: input.slots, durationMinutes: elapsedMinutes,
          endTime: end, capacityEndTime: end, fullDay: input.slots === 6 && appointment.startTime === '08:30' }],
        capacityLockIds: targetIds, endTime: end, capacityEndTime: end,
        lifecycleHistory: [...(appointment.lifecycleHistory || []), historyEvent],
        lastScheduleChangeKind: 'project_historical_capacity_adjusted', customerNotificationRecommended: false, updatedAtIso: now };
      const orderPatch = { scheduledSlots: input.slots, appointmentDurationMinutes: elapsedMinutes,
        appointmentEndTime: end, appointmentCapacityEndTime: end,
        fullDaySingleProperty: input.slots === 6 && appointment.startTime === '08:30',
        whatsappNotificationsEnabled: false, customerNotificationRecommended: false, updatedAt: now };
      const audit = { projectId: input.projectId, appointmentId: input.appointmentId, workOrderId,
        fingerprint, requestId: input.requestId, actor, reason: input.reason, recordedAtIso: now,
        previousSlots: currentSlots, currentSlots: input.slots, budgetSlots: usage.budgetSlots,
        usedBefore: usage.usedSlots, usedAfter, overBudget, overBudgetAcknowledged: input.overBudgetAcknowledged,
        noBillingAcknowledged: input.noBillingAcknowledged,
        date: appointment.date, start: appointment.startTime, vanId: assignment.vanId,
        technicianIds: assignment.technicianIds, addedSlots: added, releasedSlots: removed };
      transaction.set(projectRef, updatedProject);
      transaction.set(db.collection('appointments').doc(input.appointmentId), appointmentPatch, { merge: true });
      transaction.set(db.collection('workOrders').doc(workOrderId), orderPatch, { merge: true });
      for (const slot of removed) transaction.set(db.collection('bookingCapacityLocks').doc(lockId(appointment.date, assignment.vanId, slot)),
        { active: false, releasedAtIso: now, releaseReason: 'project_historical_capacity_adjusted', updatedAtIso: now }, { merge: true });
      for (let index = 0; index < added.length; index += 1) transaction.set(addedRefs[index],
        { date: appointment.date, vanId: assignment.vanId, slot: added[index], appointmentId: input.appointmentId,
          active: true, reservedAtIso: now, updatedAtIso: now }, { merge: true });
      transaction.set(auditRef, audit);
      return { success: true, replayed: false, project: updatedProject, appointmentId: input.appointmentId,
        workOrderId, previousSlots: currentSlots, currentSlots: input.slots,
        budgetSlots: usage.budgetSlots, usedBefore: usage.usedSlots, usedAfter, usedNow: usedAfter, overBudget };
    });
  }
  return { sources, adjust };
}

module.exports = { createProjectHistoricalCapacityAuthority };
