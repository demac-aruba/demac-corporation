const { hashKey, normalizeOfferOption } = require('./bookingAuthorityCore');
const { buildWorkOrders } = require('./bookingAuthorityWorkOrders');
const { arubaDateParts, REGULAR_SLOTS, EXTRA_MORNING_SLOT, minutesTime, timeMinutes, orderBlocksCapacity } = require('./bookingSchedulingPrimitives');
const { COLLECTION, MAX_ASSIGNMENTS, fail, identifier, authorize, phaseExists } = require('./projectRecords');

const ALL_SLOTS = [...REGULAR_SLOTS, EXTRA_MORNING_SLOT].sort();
const lockId = (date, vanId, slot) => `BAL-${hashKey(`${date}|${vanId}|${slot}`, 32).toUpperCase()}`;
function normalizeCorrection(input) {
  const value = { projectId: identifier(input.projectId), sourceAppointmentId: identifier(input.sourceAppointmentId),
    phaseId: identifier(input.phaseId), expectedVersion: Number(input.expectedVersion), start: String(input.start || ''),
    slots: Number(input.slots), reason: String(input.reason || '').trim() };
  if (!Number.isInteger(value.expectedVersion) || value.expectedVersion < 1 || !Number.isInteger(value.slots) || value.slots < 1 || value.slots > 6
    || !ALL_SLOTS.includes(value.start) || value.reason.length < 5 || value.reason.length > 1000) fail('Choose valid historical slots and enter a correction reason (5–1000 characters).');
  return value;
}
async function readEvidence(db, input, uid, now, transaction) {
  const get = ref => transaction ? transaction.get(ref) : ref.get();
  const actor = await authorize(db, uid, true, transaction);
  const projectRef = db.collection(COLLECTION).doc(input.projectId);
  const sourceRef = db.collection('appointments').doc(input.sourceAppointmentId);
  const claimRef = db.collection('projectHistoricalCorrections').doc(input.sourceAppointmentId);
  const [projectSnap, sourceSnap, claimSnap] = await Promise.all([get(projectRef), get(sourceRef), get(claimRef)]);
  if (!projectSnap.exists || !sourceSnap.exists) fail('Published Project and original appointment are required.');
  const project = projectSnap.data(); const source = sourceSnap.data();
  if (claimSnap.exists) fail('This cancelled booking already has a replacement. Open that replacement to correct it.', 'conflict');
  if (project.serverVersion !== input.expectedVersion) fail('Project changed. Reload and review the correction again.', 'conflict');
  if (!phaseExists(project, input.phaseId)) fail('The phase no longer exists.');
  if (source.status !== 'cancelled' || source.customerId !== project.customerId || source.propertyId !== project.siteId
    || !project.assignments.some(link => link.appointmentId === input.sourceAppointmentId && link.phaseId === input.phaseId)) fail('Choose a cancelled booking already linked to this Project phase.');
  if (source.assignments?.length !== 1 || source.workOrderIds?.length !== 1) fail('This correction requires one recorded Van assignment. Multi-Van corrections need separate review.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source.date) || source.date >= arubaDateParts(now).date) fail('This action is for a date before today in Aruba.');
  const assignment = source.assignments[0];
  if (!assignment.vanId || !Array.isArray(assignment.technicianIds) || !assignment.technicianIds.length) fail('The original booking has no verifiable historical crew.');
  const orderSnap = await get(db.collection('workOrders').doc(identifier(source.workOrderIds[0])));
  const order = orderSnap.exists && orderSnap.data();
  if (!order || order.appointmentId !== input.sourceAppointmentId || order.clientId !== project.customerId || order.propertyId !== project.siteId
    || order.status !== 'Cancelada' || order.date !== source.date || order.vanId !== assignment.vanId || order.scheduledSlots !== assignment.slots
    || JSON.stringify([...(order.technicianIds || [])].sort()) !== JSON.stringify([...assignment.technicianIds].sort())) fail('Original appointment and Work Order history disagree.');
  const owned = ALL_SLOTS.filter(slot => (source.capacityLockIds || []).includes(lockId(source.date, assignment.vanId, slot)));
  if (owned.length !== assignment.slots || !owned.length) fail('The original capacity-lock snapshot cannot verify the historical slots.');
  const startIndex = owned.indexOf(input.start);
  const slots = owned.slice(startIndex, startIndex + input.slots);
  if (startIndex < 0 || slots.length !== input.slots || input.slots > owned.length) fail('Replacement slots must be inside the original recorded capacity.');
  const end = minutesTime(timeMinutes(slots.at(-1)) + 60);
  const option = { id: `project-history-${hashKey(JSON.stringify(input), 32)}`, date: source.date, time: input.start, endTime: end, capacityEndTime: end,
    address: order.address || '', zone: order.zone || '', presetId: 'other', presetLabel: `Project · ${project.name}`, durationMode: 'manual',
    durationMinutesPerUnit: input.slots * 60, quantity: 1,
    assignments: [{ ...assignment, quantity: 1, slots: input.slots, durationMinutes: input.slots * 60, fullDay: false, time: input.start, endTime: end, capacityEndTime: end }] };
  return { actor, project, projectRef, source, order, claimRef, option, slots, originalSlots: owned.length };
}
function conflicts(order, option) {
  if (!orderBlocksCapacity(order)) return false;
  const target = option.assignments[0];
  if (order.vanId !== target.vanId && !(order.technicianIds || []).some(id => target.technicianIds.includes(id))) return false;
  const start = timeMinutes(order.time);
  const explicitEnd = timeMinutes(order.appointmentCapacityEndTime || order.appointmentEndTime);
  // Missing interval evidence blocks the write instead of guessing with today's settings.
  if (start === null || explicitEnd === null || explicitEnd <= start) return true;
  return start < timeMinutes(option.capacityEndTime) && explicitEnd > timeMinutes(option.time);
}
function createHistoricalProjectProvider({ db, input: rawInput, uid }) {
  const input = normalizeCorrection(rawInput);
  const evidence = (now, transaction) => readEvidence(db, input, uid, now, transaction);
  return {
    supportsHistoricalProjects: true,
    async checkAvailability({ now }) {
      const current = await evidence(now);
      const sameDay = await db.collection('workOrders').where('date', '==', current.option.date).get();
      if (sameDay.docs.some(doc => conflicts(doc.data(), current.option))) return { options: [], reason: 'Historical Van or technician capacity is occupied.' };
      return { options: [current.option], providerVersion: 'project-history-v1', metadata: {
        projectHistory: { ...input, actorId: uid }, bookingMode: 'backdated', backdatingAcknowledged: true, workAlreadyPerformed: true,
        originalSlots: current.originalSlots, historicalTechnicianIds: current.option.assignments[0].technicianIds,
      } };
    },
    async revalidateSelection({ option, offer, now }) {
      if (offer.metadata?.projectHistory?.actorId !== uid || JSON.stringify(normalizeCorrection(offer.metadata?.projectHistory || {})) !== JSON.stringify(input)) fail('The historical offer does not belong to this request.');
      const current = await evidence(now);
      if (JSON.stringify(normalizeOfferOption(current.option)) !== JSON.stringify(normalizeOfferOption(option))) fail('Historical evidence changed. Review again.');
      return { available: true, option: current.option };
    },
    async validateTransaction({ transaction, now, option }) {
      const current = await evidence(now, transaction);
      if (JSON.stringify(normalizeOfferOption(current.option)) !== JSON.stringify(normalizeOfferOption(option))) fail('Historical evidence changed. Review again.');
      const sameDay = await transaction.get(db.collection('workOrders').where('date', '==', current.option.date));
      if (sameDay.docs.some(doc => conflicts(doc.data(), current.option))) return { available: false, reason: 'historical-capacity-conflict' };
      return { available: true, capacityLocks: current.slots.map(slot => ({ id: lockId(option.date, option.assignments[0].vanId, slot), date: option.date, vanId: option.assignments[0].vanId, slot })) };
    },
    async prepareCommit({ transaction, now, appointmentId }) {
      const current = await evidence(now, transaction);
      if (current.project.assignments.length >= MAX_ASSIGNMENTS) fail('Project booking-link limit reached.');
      const bookingClaimRef = db.collection('projectBookingClaims').doc(appointmentId);
      const bookingClaim = await transaction.get(bookingClaimRef);
      if (bookingClaim.exists) fail('Replacement booking already linked.', 'conflict');
      const projectFields = { projectId: input.projectId, projectPhaseId: input.phaseId, projectName: current.project.name, historicalSourceAppointmentId: input.sourceAppointmentId };
      return { fields: projectFields, write({ workOrders }) {
        const order = workOrders[0]; const assignment = current.option.assignments[0];
        const link = { id: `PASG-${order.id}`, projectId: input.projectId, phaseId: input.phaseId, appointmentId, workOrderId: order.id,
          vanId: assignment.vanId, technicianIds: assignment.technicianIds, scheduledSlots: input.slots, scheduledHours: input.slots,
          scheduledDate: current.option.date, scheduledStart: input.start, scheduledEnd: current.option.capacityEndTime,
          actualHours: 0, unitsPlanned: 0, unitsCompleted: 0, status: 'Scheduled', bookingStatus: 'confirmed' };
        transaction.set(current.projectRef, { ...current.project, assignments: [...current.project.assignments, link],
          serverVersion: current.project.serverVersion + 1, updatedAtIso: now.toISOString(), updatedBy: uid });
        transaction.set(bookingClaimRef, { projectId: input.projectId, appointmentId });
        transaction.set(current.claimRef, { ...projectFields, appointmentId, workOrderIds: workOrders.map(item => item.id), reason: input.reason,
          originalSlots: current.originalSlots, replacementSlots: input.slots, date: current.option.date, vanId: assignment.vanId,
          technicianIds: assignment.technicianIds, actor: current.actor, recordedAtIso: now.toISOString() });
      } };
    },
    buildWorkOrders,
  };
}
module.exports = { normalizeCorrection, readEvidence, conflicts, createHistoricalProjectProvider, lockId };
