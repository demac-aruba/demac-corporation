import assert from 'node:assert/strict';
import {
  canUseFieldAdminSimulation,
  fieldSimulationStageForWorkOrderStatus,
  fieldSimulationTransitions,
  nextFieldSimulationStage,
  projectFieldAdminSimulationData,
  resolveFieldAdminSimulationJobs,
} from '../lib/field-admin-simulator';

const today = '2026-09-02';
const data = projectFieldAdminSimulationData({
  dateKey: today,
  staffProfiles: [
    { id: 'staff-old-driver', name: 'Old Driver', role: 'Técnico', active: true },
    { id: 'staff-today-driver', name: 'Today Driver', role: 'Technician', active: true },
    { id: 'staff-regular-helper', name: 'Regular Helper', role: 'Ayudante', active: true },
    { id: 'staff-van-two', name: 'Van Two Driver', role: 'Technician', active: true },
    { id: 'staff-van-two-helper', name: 'Van Two Helper', role: 'Ayudante', active: true },
    { id: 'staff-direct', name: 'Direct Technician', role: 'Technician', active: true },
    { id: 'staff-profile-fallback', name: 'Compatibility Technician', role: 'Office', active: true },
    { id: 'staff-no-jobs', name: 'Available Technician', role: 'Office', active: true },
    { id: 'staff-roster-only', name: 'Roster Only Technician', role: 'Office', employeeType: 'Técnico', active: true },
    { id: 'staff-van-four-regular', name: 'Van Four Regular', role: 'Technician', active: true },
    { id: 'staff-van-four-cancelled', name: 'Van Four Legacy Override', role: 'Technician', active: true },
    { id: 'staff-inactive-user', name: 'Inactive Portal User', role: 'Technician', active: true },
    { id: 'staff-inactive-alias-fallback', name: 'Legacy Alias Technician', role: 'Office', active: true },
    { id: 'staff-office', name: 'Office User', role: 'Office', active: true },
  ],
  vans: [
    { id: 'legacy-van-one', name: 'Van 1', responsibleStaffId: 'staff-old-driver', regularHelperId: 'staff-regular-helper', active: true },
    { id: 'VAN-1', name: 'Van 1', active: false },
    { id: 'VAN-2', name: 'Van 2', responsibleStaffId: 'staff-van-two', regularHelperId: 'staff-van-two-helper', active: true },
    { id: 'VAN-3', name: 'Van 3', active: true },
    { id: 'VAN-4', name: 'Van 4', responsibleStaffId: 'staff-van-four-regular', active: true },
    { id: 'inactive-van-one-alias', name: 'Van 1', active: false },
  ],
  dailyAssignments: [
    {
      id: 'assignment-today-van-one',
      date: today,
      vanId: 'legacy-van-one',
      driverStaffId: 'staff-today-driver',
      helperStaffId: '',
      additionalHelperStaffId: '',
      status: 'Disponible',
    },
    {
      id: 'assignment-today-van-two',
      date: today,
      vanId: 'VAN-2',
      driverStaffId: 'staff-van-two',
      status: 'Disponible',
    },
    {
      id: 'legacy-cancelled-assignment-with-date',
      date: today,
      vanId: 'VAN-4',
      driverStaffId: 'staff-van-four-cancelled',
      status: 'Cancelled',
    },
  ],
  workOrders: [
    {
      id: 'WO-TODAY-VAN-1',
      appointmentId: 'APT-1',
      clientId: 'CLIENT-1',
      propertyId: 'PROPERTY-1',
      date: today,
      time: '08:30',
      status: 'Asignada',
      vanId: 'legacy-van-one',
      appointmentWorkItems: [{ id: 'service-1', label: 'Mantenimiento A/C', quantity: 2 }],
      airConditionerCount: 2,
    },
    {
      id: 'WO-TODAY-VAN-2',
      appointmentId: 'APT-2',
      clientId: 'CLIENT-2',
      propertyId: 'PROPERTY-2',
      date: today,
      time: '10:30',
      status: 'En proceso',
      vanId: 'VAN-2',
      technicianIds: ['uid-direct'],
      customerFacingDescription: 'Diagnóstico',
    },
    {
      id: 'WO-TODAY-VAN-3',
      appointmentId: 'APT-3',
      clientId: 'CLIENT-3',
      propertyId: 'PROPERTY-3',
      date: today,
      time: '13:30',
      status: 'Confirmada',
      vanId: 'VAN-3',
      customerFacingDescription: 'Revisión preventiva',
    },
    { id: 'WO-TODAY-VAN-4', date: today, time: '14:30', status: 'Confirmada', vanId: 'VAN-4' },
    { id: 'WO-LEGACY-VAN-FIELD', date: today, time: '15:00', status: 'Asignada', van: 'VAN-1' },
    { id: 'WO-INACTIVE-VAN-ALIAS', date: today, time: '15:30', status: 'Asignada', vanId: 'inactive-van-one-alias' },
    { id: 'WO-FUTURE', date: '2026-09-03', time: '08:30', status: 'Asignada', vanId: 'VAN-1' },
    { id: 'WO-CANCELLED', date: today, time: '12:00', status: 'Cancelada', vanId: 'VAN-1' },
  ],
  clients: [
    { id: 'CLIENT-1', name: 'Cliente Uno', phone: '+297 500 0001' },
    { id: 'CLIENT-2', company: 'Cliente Dos N.V.', whatsapp: '+297 500 0002' },
    { id: 'CLIENT-3', name: 'Cliente Tres' },
  ],
  properties: [
    { id: 'PROPERTY-1', name: 'Apto 101', address: 'Palm Beach 1' },
    { id: 'PROPERTY-2', name: 'Local 2', address: 'Oranjestad 2' },
    { id: 'PROPERTY-3', name: 'Casa 3', address: 'Noord 3' },
  ],
  appointments: [],
  users: [
    { id: 'uid-old-driver', staffId: 'staff-old-driver', role: 'technician', active: true },
    { id: 'uid-today-driver', staffId: 'staff-today-driver', role: 'technician', active: true },
    { id: 'uid-regular-helper', staffId: 'staff-regular-helper', role: 'technician', active: true },
    { id: 'uid-van-two', staffId: 'staff-van-two', role: 'technician', active: true },
    { id: 'uid-van-two-helper', staffId: 'staff-van-two-helper', role: 'technician', active: true },
    { id: 'uid-direct', staffId: 'staff-direct', role: 'technician', active: true },
    { id: 'uid-profile-fallback', staffId: 'staff-profile-fallback', vanId: 'VAN-3', role: 'technician', active: true },
    { id: 'uid-no-jobs', staffId: 'staff-no-jobs', role: 'technician', active: true },
    { id: 'uid-van-four-regular', staffId: 'staff-van-four-regular', role: 'technician', active: true },
    { id: 'uid-van-four-cancelled', staffId: 'staff-van-four-cancelled', role: 'technician', active: true },
    { id: 'uid-office', staffId: 'staff-office', role: 'operations', active: true },
    { id: 'uid-inactive', staffId: 'staff-inactive-user', role: 'technician', active: false },
    { id: 'uid-inactive-alias-fallback', staffId: 'staff-inactive-alias-fallback', vanId: 'inactive-van-one-alias', role: 'technician', active: true },
  ],
});

assert.equal(canUseFieldAdminSimulation('super_admin', true), true, 'only an enabled Super Admin preview can use the simulator');
assert.equal(canUseFieldAdminSimulation('super_admin', false), false, 'production must fail closed');
assert.equal(canUseFieldAdminSimulation('operations', true), false, 'Operations cannot open the temporary identity selector');
assert.equal(canUseFieldAdminSimulation('technician', true), false, 'technicians cannot open the temporary identity selector');

const allJobs = resolveFieldAdminSimulationJobs(data, 'all');
assert.deepEqual(
  allJobs.map((job) => job.workOrderId),
  ['WO-TODAY-VAN-1', 'WO-TODAY-VAN-2', 'WO-TODAY-VAN-3', 'WO-TODAY-VAN-4', 'WO-LEGACY-VAN-FIELD', 'WO-INACTIVE-VAN-ALIAS'],
  'only visible Work Orders for the exact current day are projected',
);
assert(allJobs.every((job) => job.allowedActions.length === 1 && job.allowedActions[0] === 'read'), 'the real-data projection exposes read only');
assert(allJobs.every((job) => !job.canPrepareVisit && !job.canCreateReturnVisit && job.fieldVisit === null), 'the simulator cannot enter canonical Field mutation paths');
assert.equal(allJobs[0].customerName, 'Cliente Uno');
assert.equal(allJobs[0].propertyName, 'Apto 101');
assert.equal(allJobs[0].plannedWork[0].label, 'Mantenimiento A/C');

const vanOneJobs = resolveFieldAdminSimulationJobs(data, 'van:VAN-1');
assert.deepEqual(vanOneJobs.map((job) => job.workOrderId), ['WO-TODAY-VAN-1']);
assert.equal(vanOneJobs[0].responsibility, 'lead');
assert.equal(vanOneJobs[0].assignmentSource, 'daily_assignment');

const replacementDriverJobs = resolveFieldAdminSimulationJobs(data, 'staff:staff-today-driver');
assert.deepEqual(replacementDriverJobs.map((job) => job.workOrderId), ['WO-TODAY-VAN-1'], 'dated crew replacement owns the Van for today');
assert.equal(replacementDriverJobs[0].responsibility, 'lead');
assert.equal(resolveFieldAdminSimulationJobs(data, 'staff:staff-old-driver').length, 0, 'regular driver loses today access after a dated override');
assert.equal(resolveFieldAdminSimulationJobs(data, 'staff:staff-regular-helper').length, 0, 'an explicitly blank dated helper slot removes the regular helper');

const directJobs = resolveFieldAdminSimulationJobs(data, 'staff:staff-direct');
assert.deepEqual(directJobs.map((job) => job.workOrderId), ['WO-TODAY-VAN-2']);
assert.equal(directJobs[0].responsibility, 'technician');
assert.equal(directJobs[0].assignmentSource, 'direct_staff');
assert.deepEqual(
  resolveFieldAdminSimulationJobs(data, 'staff:staff-van-two-helper').map((job) => job.workOrderId),
  ['WO-TODAY-VAN-2'],
  'omitted daily crew fields inherit the regular crew while explicit blanks remove a slot',
);
const fallbackJobs = resolveFieldAdminSimulationJobs(data, 'staff:staff-profile-fallback');
assert.deepEqual(fallbackJobs.map((job) => job.workOrderId), ['WO-TODAY-VAN-3'], 'the governed user-profile Van compatibility path remains visible');
assert.equal(fallbackJobs[0].assignmentSource, 'profile_van_fallback');
const vanThreeJobs = resolveFieldAdminSimulationJobs(data, 'van:VAN-3');
assert.equal(vanThreeJobs[0].responsibility, 'office', 'a Van without a canonical driver remains read-only in the simulator');
assert.deepEqual(
  resolveFieldAdminSimulationJobs(data, 'staff:staff-van-four-cancelled').map((job) => job.workOrderId),
  ['WO-TODAY-VAN-4'],
  'legacy cancelled rows that retain their date match current Field Authority resolution',
);
assert.equal(resolveFieldAdminSimulationJobs(data, 'staff:staff-van-four-regular').length, 0);
assert.deepEqual(vanOneJobs.map((job) => job.workOrderId), ['WO-TODAY-VAN-1'], 'legacy order.van and inactive aliases cannot broaden Field assignment');
const inactiveAliasFallbackJobs = resolveFieldAdminSimulationJobs(data, 'staff:staff-inactive-alias-fallback');
assert.deepEqual(inactiveAliasFallbackJobs.map((job) => job.workOrderId), ['WO-INACTIVE-VAN-ALIAS'], 'matching raw legacy Van references preserve the server read-only fallback');
assert.equal(inactiveAliasFallbackJobs[0].assignmentSource, 'profile_van_fallback');

assert(data.targets.some((target) => target.value === 'van:VAN-1'));
assert.equal(data.targets.filter((target) => target.value === 'van:VAN-1').length, 1, 'inactive canonical duplicates do not hide an active legacy record for the same physical Van');
assert(data.targets.some((target) => target.value === 'van:VAN-2'));
assert(data.targets.some((target) => target.value === 'staff:staff-today-driver'));
assert(data.targets.some((target) => target.value === 'staff:staff-profile-fallback'), 'a governed profile-Van fallback remains selectable even when legacy staff role text is not technical');
assert(data.targets.some((target) => target.value === 'staff:staff-no-jobs'), 'an active technical employee without work remains selectable');
assert(!data.targets.some((target) => target.value === 'staff:staff-roster-only'), 'a staff record without an active technician login is not presented as a portal identity');
assert(!data.targets.some((target) => target.value === 'staff:staff-inactive-user'), 'an inactive technician login is not selectable');
assert(!data.targets.some((target) => target.value === 'staff:staff-office'), 'non-field staff are not listed');

assert.equal(nextFieldSimulationStage('scheduled'), 'en_route');
assert.equal(nextFieldSimulationStage('in_progress'), 'ready_for_office_review');
assert.equal(nextFieldSimulationStage('completed'), 'completed');
assert.equal(fieldSimulationStageForWorkOrderStatus('Completada'), 'completed');
assert.equal(fieldSimulationStageForWorkOrderStatus('Pendiente'), 'pending');
assert.deepEqual(fieldSimulationTransitions('scheduled'), ['en_route', 'no_access', 'cancelled']);
assert(!fieldSimulationTransitions('scheduled').includes('pending'), 'pending is not valid before departure');
assert(!fieldSimulationTransitions('en_route').includes('requires_return_visit'), 'return is not valid before arrival');
assert.deepEqual(fieldSimulationTransitions('ready_for_office_review'), [], 'technician simulation cannot approve Office Review');
assert.deepEqual(fieldSimulationTransitions('completed'), [], 'completed real work is read-only');

console.log('Field admin simulator acceptance passed.');
