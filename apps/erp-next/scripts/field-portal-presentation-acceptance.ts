import assert from 'node:assert/strict';
import { parseFieldScheduleResponse, type FieldScheduleJob, type FieldVisitStatus } from '../lib/field-authority-contract';
import { fieldDaySummary, fieldJobStatusPresentation, fieldRolePresentation } from '../lib/field-portal-presentation';
const base: FieldScheduleJob = { id: 'demo', workOrderId: 'demo', appointmentId: 'demo', date: '2026-09-23', time: '08:30', status: 'Confirmada', customerId: 'DEMO-C1', customerName: 'DEMO', propertyId: 'DEMO-P1', address: 'DEMO', plannedWork: [], estimatedQuantity: 1, vanId: 'DEMO-V1', responsibility: 'lead', assignmentSource: 'regular_crew', allowedActions: ['read'], fieldVisit: null, canPrepareVisit: true, canCreateReturnVisit: false };
const envelope = (job: unknown) => ({ success: true, version: 1, jobs: [job] });
assert.equal(parseFieldScheduleResponse(envelope(base)).jobs.length, 1, 'old server without crew stays compatible');
const crew = { vanId: 'DEMO-V1', vanName: 'DEMO Van', members: [{ staffId: 'DEMO-T1', name: 'DEMO Tech', responsibility: 'lead' }, { staffId: 'DEMO-H1', name: 'DEMO Helper', responsibility: 'helper' }] };
assert.equal(parseFieldScheduleResponse(envelope({ ...base, crew })).jobs[0].crew?.members.length, 2);
for (const invalid of [null, { ...crew, vanId: 'OTHER' }, { ...crew, members: [...crew.members, crew.members[0]] }, { ...crew, members: [{ ...crew.members[0], name: ' ' }] }, { ...crew, members: [{ ...crew.members[0], responsibility: 'admin' }] }, { ...crew, members: Array.from({ length: 4 }, (_, i) => ({ ...crew.members[0], staffId: `DEMO-${i}` })) }]) assert.throws(() => parseFieldScheduleResponse(envelope({ ...base, crew: invalid })), /malformed/);
assert.equal(fieldRolePresentation('lead'), 'Técnico responsable');
assert.equal(fieldRolePresentation('helper'), 'Ayudante');
function withStatus(status: FieldVisitStatus): FieldScheduleJob {
  return { ...base, status: 'Completada', fieldVisit: { id: 'DEMO-VISIT', appointmentId: base.appointmentId, workOrderId: base.workOrderId, customerId: base.customerId, propertyId: base.propertyId, scheduledScopeSnapshot: { appointmentId: base.appointmentId, capturedAt: '2026-09-23T12:00:00Z', estimatedUnitCount: 1, workLines: [] }, status, participatingStaffIds: ['DEMO-T1'], requiresSecondVisit: false, createdAt: '2026-09-23T12:00:00Z', createdBy: 'DEMO-T1', updatedAt: '2026-09-23T12:00:00Z', updatedBy: 'DEMO-T1', version: 1, availableTransitions: [] } };
}
assert.equal(fieldJobStatusPresentation(withStatus('in_progress')).label, 'En progreso');
assert.equal(fieldJobStatusPresentation(withStatus('completed')).label, 'Terminado en campo');
assert.equal(fieldJobStatusPresentation(withStatus('ready_for_office_review')).label, 'Enviado a oficina');
assert.deepEqual(fieldDaySummary([withStatus('completed'), withStatus('ready_for_office_review'), withStatus('in_progress'), withStatus('no_access'), withStatus('cancelled')]), { total: 5, finished: 1, sent: 1, pending: 2 });
assert.deepEqual(fieldDaySummary([]), { total: 0, finished: 0, sent: 0, pending: 0 });
console.log('Field portal presentation and additive crew contract acceptance passed.');
