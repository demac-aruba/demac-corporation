import assert from 'node:assert/strict';
import { projectLiveSchedulingAppointments } from '../lib/live-scheduling';
import { assignmentReservedSlots, hasServiceWorkEstimate, schedulingWorkSummary } from '../lib/scheduling-card-presentation';
import { schedulingProjectLabel } from '../lib/scheduling-project-labels';

const base = { id: 'SYNTHETIC-WO-1', appointmentId: 'SYNTHETIC-APT', date: '2026-09-18',
  time: '08:30', vanId: 'VAN-1', status: 'confirmed', appointmentPresetId: 'other',
  appointmentWorkLabel: 'Other', appointmentDurationMode: 'manual', appointmentDurationMinutes: 360,
  appointmentEndTime: '14:30', appointmentCapacityEndTime: '16:30', scheduledSlots: 6, fullDaySingleProperty: true,
  appointmentWorkItems: [{ id: 'synthetic', presetId: 'other', label: 'Other', quantity: 1, durationMode: 'manual' }],
};
const [manual] = projectLiveSchedulingAppointments([base, { ...base, id: 'SYNTHETIC-WO-2', vanId: 'VAN-2' }], [], []);
for (const job of manual.assignments) {
  assert.equal(assignmentReservedSlots(job), 6);
  assert.equal(job.capacityEnd, '16:30');
  assert.equal(job.end, '14:30', 'presentation never overwrites the technical duration');
  assert.equal(schedulingWorkSummary(manual, job.quantity), 'Other', 'manual capacity is not an AC unit or an invented Project relation');
}
assert.equal(hasServiceWorkEstimate(manual), false);
const [partial] = projectLiveSchedulingAppointments([{ ...base, scheduledSlots: 2, appointmentDurationMinutes: 120,
  appointmentEndTime: '10:30', appointmentCapacityEndTime: '10:30', fullDaySingleProperty: false }], [], []);
assert.equal(assignmentReservedSlots(partial.assignments[0]), 2);
assert.equal(partial.assignments[0].capacityEnd, '10:30');
assert.doesNotMatch(schedulingWorkSummary(partial), /Full day|Project/);
const [mixed] = projectLiveSchedulingAppointments([{ ...base, appointmentPresetId: 'standard_service', appointmentDurationMode: 'per_unit',
  appointmentWorkItems: [
    { id: 'line-1', presetId: 'standard_service', label: 'Standard service', quantity: 2, durationMode: 'per_unit' },
    { id: 'line-2', presetId: 'deep_cleaning', label: 'Deep cleaning', quantity: 1, durationMode: 'per_unit' },
  ] }], [], []);
assert.equal(schedulingWorkSummary(mixed), 'Standard service · 2 units + Deep cleaning · 1 unit');
assert.equal(schedulingWorkSummary(mixed, 99), 'Standard service + Deep cleaning', 'no appointment total copied onto each Van');
assert.equal(hasServiceWorkEstimate(mixed), true);
const singleService = { ...base, appointmentPresetId: 'standard_service', appointmentDurationMode: 'per_unit',
  appointmentWorkItems: [{ id: 'standard', presetId: 'standard_service', label: 'Standard service', quantity: 4, durationMode: 'per_unit' }], quantity: 4 };
const [split] = projectLiveSchedulingAppointments([singleService, { ...singleService, id: 'SYNTHETIC-SUPPORT', vanId: 'VAN-2',
  appointmentAssignmentRole: 'support', quantity: 3, appointmentWorkItems: [{ ...singleService.appointmentWorkItems[0], quantity: 3 }] }], [], []);
assert.equal(schedulingWorkSummary(split), 'Standard service · 7 units');
assert.equal(schedulingWorkSummary(split, split.assignments[0].quantity), 'Standard service · 4 units');
assert.equal(schedulingWorkSummary(split, split.assignments[1].quantity), 'Standard service · 3 units');
const [itemOnly] = projectLiveSchedulingAppointments([{ ...singleService, quantity: undefined }], [], []);
assert.equal(schedulingWorkSummary(itemOnly, itemOnly.assignments[0].quantity), 'Standard service · 4 units', 'a canonical work-item quantity must precede the legacy default of one');
const [legacy] = projectLiveSchedulingAppointments([{ id: 'unknown', appointmentId: 'unknown', date: base.date, time: base.time, vanId: 'VAN-1' }], [], []);
assert.equal(schedulingWorkSummary(legacy), 'Work details pending verification');
assert.equal(hasServiceWorkEstimate(legacy), false);
assert.equal(assignmentReservedSlots({ capacitySlotStarts: ['08:30', '08:30', '09:30'] }), 2);
console.log('PASS card projections: per-assignment six/two slots, technical/capacity separation, all service lines, manual/unknown quantities and no invented Project identity');

const linkedAppointment = { ...manual, customerId: 'SYNTHETIC-CUSTOMER', siteId: 'SYNTHETIC-PROPERTY' };
const project = {
  id: 'SYNTHETIC-PROJECT', projectNumber: 'SYNTHETIC-001', name: 'Synthetic VRF project',
  customerId: linkedAppointment.customerId, siteId: linkedAppointment.siteId,
  phases: [{ id: 'phase-1', name: 'Installation', status: 'Completed' }],
  assignments: manual.workOrderIds!.map((workOrderId) => ({
    projectId: 'SYNTHETIC-PROJECT', appointmentId: manual.id, workOrderId, phaseId: 'phase-1',
  })),
};
const state = (projects: unknown[]) => ({ version: 1, projects });
const label = schedulingProjectLabel(linkedAppointment, state([project]));
assert.deepEqual(label, { projectId: project.id, name: project.name, phaseNames: ['Installation'] });
for (const job of linkedAppointment.assignments) {
  assert.equal(schedulingWorkSummary(linkedAppointment, job.quantity, label), 'Project · Synthetic VRF project · Installation');
  assert.equal(assignmentReservedSlots(job), 6);
  assert.equal(job.end, '14:30');
  assert.equal(job.capacityEnd, '16:30');
}
assert.equal(hasServiceWorkEstimate(mixed, label), false, 'a linked Project never inherits a service-unit estimate');
assert.equal(assignmentReservedSlots(partial.assignments[0]), 2);
assert.doesNotMatch(schedulingWorkSummary(partial, 2, label), /Full day|unit|Other/);
for (const patch of [{ id: 'unrelated-appointment' }, { customerId: 'wrong-customer' }, { siteId: 'wrong-property' },
  { workOrderId: 'wrong-wo', workOrderIds: ['wrong-wo'] }, { customerId: undefined }]) {
  assert.equal(schedulingProjectLabel({ ...linkedAppointment, ...patch }, state([project])), undefined);
}
assert.equal(schedulingWorkSummary(manual, 1, schedulingProjectLabel(manual, state([project]))), 'Other');
for (const patch of [{ projectId: 'wrong-project' }, { appointmentId: 'wrong-appointment' }, { workOrderId: 'wrong-wo' }]) {
  assert.equal(schedulingProjectLabel(linkedAppointment, state([{ ...project, assignments: project.assignments.map((link) => ({ ...link, ...patch })) }])), undefined);
}
assert.equal(schedulingProjectLabel(linkedAppointment, state([project, { ...project, name: 'Duplicate identity' }])), undefined);
assert.equal(schedulingProjectLabel(linkedAppointment, state([project, { ...project, id: 'another-project', assignments: project.assignments.map(link => ({ ...link, projectId: 'another-project' })) }])), undefined);
assert.equal(schedulingProjectLabel(linkedAppointment, state([{ ...project, name: 'Renamed project' }]))?.name, 'Renamed project');
for (const invalid of [null, {}, { version: 1, projects: [null, {}, { ...project, assignments: [null, 42, {}] }] }]) {
  assert.equal(schedulingProjectLabel(linkedAppointment, invalid), undefined);
}
assert.deepEqual(schedulingProjectLabel(linkedAppointment, state([{ ...project, phases: [null, 42, {}] }]))?.phaseNames, []);
console.log('PASS Project labels: exact appointment/work-order/customer/property links, ambiguous/stale/malformed rejection, phase/name refresh and unchanged per-Van capacity');
