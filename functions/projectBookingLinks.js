const { COLLECTION, MAX_ASSIGNMENTS, authorize, identifier, phaseExists, fail } = require('./projectRecords');

// Decorates the existing Scheduling provider. It does not calculate availability.
function withProjectBookingLinks({ db, provider }) {
  async function readProject({ request, context, transaction }) {
    if (!request.project) return null;
    if (context.channel !== 'office' || !context.projectActorId || context.bookingMode === 'backdated') fail('Use the historical correction action for past Project work.');
    const actor = await authorize(db, context.projectActorId, true, transaction);
    const ref = db.collection(COLLECTION).doc(identifier(request.project.id));
    const snapshot = await (transaction ? transaction.get(ref) : ref.get());
    const project = snapshot.exists && snapshot.data();
    if (!project || project.customerId !== request.customerId || project.siteId !== request.propertyId || !phaseExists(project, request.project.phaseId)) fail('Shared Project, phase and CRM location must match.');
    if (project.serverVersion !== request.project.version) fail('Project changed in another session. Reload before booking.', 'conflict');
    if (['Completed', 'Cancelled', 'On Hold'].includes(project.status)) fail('This Project is not available for new bookings.');
    const phase = project.phases.find(item => item.id === request.project.phaseId);
    if (phase && (['Completed', 'Cancelled', 'On Hold', 'Blocked'].includes(phase.workflowStatus) || phase.status === 'Completed')) fail('This phase is not available for new bookings.');
    return { project, ref, actor };
  }
  return {
    ...provider, supportsProjectLinks: true,
    authorizeProjectRequest: readProject,
    async authorizeProjectReplay({ appointment, actor, transaction }) {
      if (appointment.projectId) await authorize(db, actor.id || actor.userId, true, transaction);
    },
    async checkAvailability(args) { return provider.checkAvailability(args); },
    async revalidateSelection(args) { await readProject(args); return provider.revalidateSelection(args); },
    async prepareCommit({ transaction, request, context, appointmentId, now, option }) {
      const current = await readProject({ request, context, transaction });
      if (!current) return null;
      if (current.project.assignments.length + option.assignments.length > MAX_ASSIGNMENTS) fail('Project booking-link limit reached.');
      const claim = db.collection('projectBookingClaims').doc(appointmentId);
      if ((await transaction.get(claim)).exists) fail('Appointment is already linked.', 'conflict');
      const fields = { projectId: current.project.id, projectPhaseId: request.project.phaseId, projectName: current.project.name };
      return { fields, write({ workOrders, createMode }) {
        const links = option.assignments.map((assignment, index) => ({ id: `PASG-${workOrders[index].id}`, projectId: current.project.id,
          phaseId: request.project.phaseId, appointmentId, workOrderId: workOrders[index].id, vanId: assignment.vanId,
          technicianIds: assignment.technicianIds, scheduledSlots: assignment.slots, scheduledHours: assignment.slots,
          scheduledDate: option.date, scheduledStart: assignment.time || option.time, scheduledEnd: assignment.capacityEndTime || option.capacityEndTime || assignment.endTime || option.endTime,
          actualHours: 0, unitsPlanned: 0, unitsCompleted: 0, status: 'Scheduled', bookingStatus: createMode }));
        transaction.set(current.ref, { ...current.project, assignments: [...current.project.assignments, ...links],
          scheduledFutureHours: Number(current.project.scheduledFutureHours || 0) + links.reduce((sum, link) => sum + link.scheduledHours, 0),
          assignedVans: [...new Set([...(current.project.assignedVans || []), ...links.map(link => link.vanId)])],
          status: current.project.status === 'Draft' ? 'Planned' : current.project.status,
          serverVersion: current.project.serverVersion + 1, updatedAtIso: now.toISOString(), updatedBy: current.actor.id });
        transaction.set(claim, { projectId: current.project.id, phaseId: request.project.phaseId, appointmentId, actor: current.actor, recordedAtIso: now.toISOString() });
      } };
    },
  };
}
module.exports = { withProjectBookingLinks };
