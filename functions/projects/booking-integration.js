'use strict';

// Projects validates planning identity; Booking Authority still owns availability and commit.
// This adapter has no independent booking writer, SDK initialization or deployment export.
const d = require('./registry-domain');
const { BookingAuthorityError, BOOKING_ERROR_CODES } = require('../bookingAuthorityCore');
// Preserve the existing Scheduling eligibility of a draft/open Project plan.
const ACTIVE_PLAN_STATES = new Set(['Draft', 'Planned']);
const ACTIVE_LEGACY_STATES = new Set(['Draft', 'Planned', 'Active', 'Near Completion']);
const snapshot = (value) => value.exists ? { ...value.data(), id: value.id } : null;

function projectError(code, message, reason) {
  return new BookingAuthorityError(code, message, { reason });
}
function normalizeSelection(value) {
  d.allowedKeys(value, ['projectId', 'phaseId', 'expectedVersion']);
  return {
    projectId: d.id(value.projectId, 'projectId'),
    phaseId: value.phaseId === null ? null : d.id(value.phaseId, 'phaseId'),
    expectedVersion: d.integer(value.expectedVersion, 'project version', 1, Number.MAX_SAFE_INTEGER - 1),
  };
}
function officeUser(actor, context) {
  if (context?.channel !== 'office' || actor?.source !== 'office-scheduling') {
    throw projectError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'Project bookings require the authenticated office workflow.', 'project_office_identity_required');
  }
  return d.id(actor.id, 'authenticated office user');
}
function validateBoundContext(bound, actor, context) {
  d.allowedKeys(bound, ['schemaVersion', 'projectId', 'phaseId', 'expectedVersion', 'actorId']);
  if (bound.schemaVersion !== 1 || bound.actorId !== officeUser(actor, context)) {
    throw projectError(BOOKING_ERROR_CODES.INVALID_REQUEST, 'The selected Project offer belongs to another operator or contract.', 'project_offer_identity_conflict');
  }
  return normalizeSelection({ projectId: bound.projectId, phaseId: bound.phaseId, expectedVersion: bound.expectedVersion });
}
function checkPlan(project, selection, request) {
  d.requireVersion(project, selection.expectedVersion);
  if (!ACTIVE_PLAN_STATES.has(project.planningStatus)) {
    throw d.fault('project_not_schedulable', 'This project is not open for new bookings.', 409);
  }
  if (project.customerId !== request.customerId || project.propertyId !== request.propertyId) {
    throw d.fault('project_booking_identity_conflict', 'The project must match the selected customer and property.', 409);
  }
  const phase = project.phases.find(item => item.id === selection.phaseId);
  if (selection.phaseId !== null && !phase) {
    throw d.fault('unknown_project_phase', 'The selected phase no longer belongs to this project.', 409);
  }
  // No preview report or local percentage may satisfy phase execution prerequisites.
  // The canonical completion projection is a required activation prerequisite, not fabricated here.
  if (phase && (phase.dependencies.length || project.migration?.status === 'pending_reconciliation')) {
    throw d.fault('project_phase_reconciliation_required', 'Phase completion and prerequisites must be reconciled before booking this phase.', 409);
  }
  // A captured legacy terminal status must not be silently reopened by importing its plan.
  if (project.migration?.status === 'pending_reconciliation'
      && !ACTIVE_LEGACY_STATES.has(project.migration.sourceDeclaredStatus)) {
    throw d.fault('project_reconciliation_required', 'Review the imported project status before booking new work.', 409);
  }
}
function mapFailure(error) {
  if (error instanceof BookingAuthorityError) return error;
  if (error?.status && error?.code) {
    return projectError(BOOKING_ERROR_CODES.INVALID_REQUEST,
      ['forbidden', 'unauthenticated'].includes(error.code)
        ? 'Your current account is not authorized to book this project.'
        : error.message,
      error.code);
  }
  return error;
}

function createProjectBookingIntegration({ db, enabled = false } = {}) {
  if (!db || typeof db.runTransaction !== 'function') throw new Error('Trusted Firestore is required.');
  function ref(collection, id) { return db.collection(collection).doc(id); }
  async function readScope(transaction, actor, context, selection, request, replay = false) {
    const uid = officeUser(actor, context);
    const [profile, settings, plan] = await transaction.getAll(
      ref('users', uid), ref('businessSettings', 'projects-registry'), ref('projectRecords', selection.projectId),
    );
    const principal = d.actor(uid, snapshot(profile), true);
    // Turning new booking integration off must not turn a completed retry into a new booking.
    // Replay below is read-only and remains subject to current provisioned authorization.
    if (!replay && (enabled !== true || !settings.exists
        || settings.data().backendEnabled !== true || settings.data().bookingEnabled !== true)) {
      throw d.fault('project_booking_not_active', 'Central project booking is not activated.', 503);
    }
    const project = d.requireRecord(snapshot(plan));
    if (!replay) checkPlan(project, selection, request);
    else if (project.customerId !== request.customerId || project.propertyId !== request.propertyId) {
      throw d.fault('project_booking_identity_conflict', 'Project booking identity requires reconciliation.', 409);
    }
    return { project, principal };
  }

  async function prepareOffer({ request, actor, context }) {
    if (context.projectSelection === undefined) return null;
    try {
      const selection = normalizeSelection(context.projectSelection);
      const uid = officeUser(actor, context);
      await db.runTransaction(transaction => readScope(transaction, actor, context, selection, request), { readOnly: true });
      return { schemaVersion: 1, ...selection, actorId: uid };
    } catch (error) { throw mapFailure(error); }
  }

  async function prepareCommit({ transaction, appointment, workOrders, boundContext, actor, context, now }) {
    try {
      const selection = validateBoundContext(boundContext, actor, context);
      const { project, principal } = await readScope(transaction, actor, context, selection, appointment);
      const appointmentId = d.id(appointment.appointmentId, 'appointment');
      const linkRef = ref('projectAppointmentLinks', appointmentId);
      const eventRef = ref('projectEvents', `PB-${d.digest(appointmentId).slice(0, 40)}`);
      const [link, event] = await transaction.getAll(linkRef, eventRef);
      if (link.exists || event.exists) throw d.fault('project_booking_link_conflict', 'An existing Project link requires reconciliation; it will not be overwritten.', 409);
      if (!Array.isArray(workOrders) || !workOrders.length || workOrders.length > 60) throw d.fault('work_order_scope', 'Project booking Work Orders exceed the supported transaction scope.', 409);
      const ids = new Set();
      let plannedVanMinutes = 0;
      for (const work of workOrders) {
        d.id(work.id, 'work order');
        if (ids.has(work.id) || work.appointmentId !== appointmentId || work.clientId !== project.customerId
            || work.propertyId !== project.propertyId || (work.customerId !== undefined && work.customerId !== project.customerId)) {
          throw d.fault('work_order_identity_conflict', 'A Project Work Order has inconsistent identity.', 409);
        }
        ids.add(work.id);
        plannedVanMinutes += d.integer(work.appointmentDurationMinutes, 'planned Van minutes', 1, 1440);
      }
      d.integer(plannedVanMinutes, 'total planned Van minutes', 1);
      const createdAt = d.stamp(now.toISOString());
      const linkData = {
        schemaVersion: 1, appointmentId, projectId: project.id, phaseId: selection.phaseId,
        customerId: project.customerId, propertyId: project.propertyId,
        source: 'booking_authority', workOrderIdsAtLink: [...ids].sort(),
        planVersionAtBooking: project.version, budgetAtBooking: { ...project.budget },
        plannedVanMinutesAtBooking: plannedVanMinutes, createdAt, createdBy: principal.uid,
      };
      const eventData = {
        schemaVersion: 1, action: 'appointment_linked_at_booking', actorId: principal.uid,
        actorRole: principal.role, projectId: project.id, appointmentId, phaseId: selection.phaseId,
        occurredAt: createdAt, beforeVersion: project.version, afterVersion: project.version,
        workOrderIds: [...ids].sort(), plannedVanMinutes, budgetAtBooking: { ...project.budget },
        source: 'booking_authority',
      };
      // Return prepared writes. Only Booking Authority applies them in its existing transaction.
      // Never add scheduled time to actual labor or mutate the approved planning estimate.
      return { linkRef, linkData, eventRef, eventData };
    } catch (error) { throw mapFailure(error); }
  }

  async function validateReplay({ transaction, appointment, actor, context }) {
    if (!appointment.projectContext) return;
    const read = async (tx) => {
      const selection = validateBoundContext(appointment.projectContext, actor, context);
      await readScope(tx, actor, context, selection, appointment, true);
      const link = snapshot(await tx.get(ref('projectAppointmentLinks', d.id(appointment.appointmentId))));
      if (!link || link.schemaVersion !== 1 || link.appointmentId !== appointment.appointmentId
          || link.projectId !== selection.projectId || link.phaseId !== selection.phaseId
          || link.customerId !== appointment.customerId || link.propertyId !== appointment.propertyId) {
        throw d.fault('project_booking_link_conflict', 'This existing booking requires Project reconciliation. Do not create a replacement.', 409);
      }
    };
    try { return transaction ? await read(transaction) : await db.runTransaction(read, { readOnly: true }); }
    catch (error) { throw mapFailure(error); }
  }
  return { prepareOffer, prepareCommit, validateReplay };
}
module.exports = { createProjectBookingIntegration, normalizeSelection, checkPlan };
