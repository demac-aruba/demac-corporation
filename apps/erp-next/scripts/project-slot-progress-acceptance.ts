import assert from 'node:assert/strict';
import { createProjectsPreviewState, type BrowserProject, type ProjectAssignment } from '../lib/browser-projects';
import {
  projectSlotProgress, linkedProjectWorkOrderIds, recordedSlotCount, projectSlotTechnician,
  type ProjectSlotSources, type ProjectSlotPeople,
} from '../lib/project-slot-progress';
import { loadProjectSlotPeople, loadProjectSlotSources } from '../lib/live-project-slot-progress';
import { roleCapabilities, type AuthPrincipal } from '../lib/security';

let passed = 0;
function check(name: string, run: () => void) { run(); passed++; console.log(`PASS: ${name}`); }
function assignment(id: string): ProjectAssignment {
  return { id: `LINK-${id}`, projectId: 'P', phaseId: 'PH', vanId: 'VAN-1', technicianIds: [], scheduledHours: 6,
    actualHours: 0, unitsPlanned: 0, unitsCompleted: 0, status: 'Scheduled', appointmentId: `APT-${id}`, workOrderId: id };
}
function project(): BrowserProject {
  return { ...createProjectsPreviewState().projects[0], id: 'P', customerId: 'C', siteId: 'S', estimatedSlots: 10,
    scheduledFutureHours: 999, actualLaborHours: 300, assignments: [assignment('A'), assignment('B')], phases: [] };
}
function sources(): ProjectSlotSources {
  return Object.fromEntries(['A', 'B'].map((id, index) => [id, { value: { id, appointmentId: `APT-${id}`, clientId: 'C', propertyId: 'S',
    scheduledSlots: 6, date: index ? '2026-01-01' : '2026-01-03', time: '08:30', vanId: 'VAN-1', status: 'Confirmada', technicianIds: ['T1', 'T2', 'T3'] } }]));
}
const fixture = project();
const calculate = (input = sources(), p = fixture, all = [p]) => projectSlotProgress(p, all, input);

check('Van slots ignore crew multiplier, old counters and actual labor; do not mutate sources', () => {
  const before = JSON.stringify(fixture);
  const result = calculate();
  assert.equal(result.total, 12); assert.equal(result.percent, 120); assert.equal(result.overBudget, 2); assert.equal(result.complete, true);
  assert.equal(JSON.stringify(fixture), before);
  assert.deepEqual(result.rows.map((row) => row.workOrderId), ['B', 'A']);
});
check('under, exact, zero and invalid budget', () => {
  assert.equal(calculate(sources(), { ...fixture, estimatedSlots: 20 }).percent, 60);
  assert.equal(calculate(sources(), { ...fixture, estimatedSlots: 12 }).overBudget, 0);
  assert.equal(calculate(sources(), { ...fixture, estimatedSlots: 0 }).overBudget, 12);
  assert.equal(calculate(sources(), { ...fixture, estimatedSlots: NaN }).complete, false);
});
check('backdated reductions, increases, cancellations, removals and moves replace current totals', () => {
  const data = sources();
  data.A.value!.scheduledSlots = 2; assert.equal(calculate(data).total, 8);
  data.A.value!.scheduledSlots = 7; assert.equal(calculate(data).total, 13);
  data.A.value!.date = '2025-12-31'; data.A.value!.vanId = 'VAN-3';
  assert.equal(calculate(data).rows[0].vanId, 'VAN-3'); assert.equal(calculate(data).total, 13);
  data.A.value!.status = 'Cancelada'; assert.equal(calculate(data).total, 6);
  data.A = { value: null }; assert.equal(calculate(data).total, 6); assert.equal(calculate(data).complete, true);
  assert.equal(calculate(data).rows.find((row) => row.workOrderId === 'A')!.status, 'Removed');
});
check('new linked backdated allocation counts once and duplicate links never multiply it', () => {
  const p = { ...fixture, assignments: [...fixture.assignments, assignment('C'), assignment('C')] };
  const data = sources(); data.C = { value: { ...data.A.value!, id: 'C', appointmentId: 'APT-C', date: '2025-12-01' } };
  assert.equal(calculate(data, p).total, 18);
  assert.deepEqual(linkedProjectWorkOrderIds([p]), ['A', 'B', 'C']);
});
check('identity mismatch or a cross-Project claim does not leak crew or invent zero', () => {
  for (const key of ['id', 'appointmentId', 'clientId', 'propertyId'] as const) {
    const data = sources(); data.A.value![key] = 'MISMATCH';
    const result = calculate(data); assert.equal(result.complete, false);
    assert.equal(result.total, 6); assert.deepEqual(result.rows.find((row) => row.workOrderId === 'A')!.technicianIds, []);
  }
  const other = { ...fixture, id: 'OTHER', assignments: [assignment('A')] };
  assert.equal(calculate(sources(), fixture, [fixture, other]).complete, false);
  const splitClaim = { ...fixture, id: 'OTHER', assignments: [{ ...assignment('C'), appointmentId: 'APT-A' }] };
  assert.equal(calculate(sources(), fixture, [fixture, splitClaim]).complete, false, 'Same appointment cannot claim different Projects via separate WOs.');
  const prototypeId = { ...fixture, assignments: [assignment('constructor')] };
  assert.equal(calculate({}, prototypeId).complete, false, 'An inherited property is not a successful missing-document read.');
});
check('failures, invalid slots and missing dates do not produce a fully verified total', () => {
  const data = sources(); data.A = { value: null, failed: true };
  assert.equal(calculate(data).complete, false); assert.equal(calculate(data).total, 6);
  for (const value of [undefined, NaN, -1, 1.5, '6', ['99:00']]) assert.equal(recordedSlotCount(value), null);
  assert.equal(recordedSlotCount(['08:30', '08:30', '09:30']), 2);
  const badDate = sources(); badDate.A.value!.date = '2026-02-31'; assert.equal(calculate(badDate).complete, false);
});
check('preview-only allocations are explicit and never treated as live slot usage', () => {
  const p = { ...fixture, assignments: [{ ...assignment('PREVIEW'), workOrderId: undefined, appointmentId: undefined }] };
  assert.equal(calculate({}, p).total, 0); assert.equal(calculate({}, p).previewCount, 1);
});
check('malformed nested storage and stale link crew do not fabricate attendance', () => {
  const p = { ...fixture, assignments: [null, 'bad', ...fixture.assignments] as unknown as ProjectAssignment[] };
  assert.equal(calculate(sources(), p).total, 12);
  const data = sources(); data.A.value!.technicianIds = ['T4', 'T4'];
  assert.deepEqual(calculate(data).rows.find((row) => row.workOrderId === 'A')!.technicianIds, ['T4']);
});
check('explicit backdated attendance changes are reflected without changing Van slots', () => {
  const people: ProjectSlotPeople = { canReadAttendance: true, staff: { T1: { value: { id: 'T1', name: 'Synthetic technician' } } }, attendance: {
    'T1_2026-01-01': { value: { id: 'T1_2026-01-01', employeeId: 'T1', date: '2026-01-01', attendanceStatus: 'Present' } },
  } };
  assert.equal(projectSlotTechnician('T1', '2026-01-01', people).attendance, 'Present');
  people.attendance['T1_2026-01-01'].value!.attendanceStatus = 'Absent';
  assert.equal(projectSlotTechnician('T1', '2026-01-01', people).attendance, 'Absent'); assert.equal(calculate().total, 12);
  people.attendance['T1_2026-01-01'] = { value: null };
  assert.match(projectSlotTechnician('T1', '2026-01-01', people).attendance, /No explicit/);
  people.attendance['T1_2026-01-01'] = { value: null, failed: true };
  assert.match(projectSlotTechnician('T1', '2026-01-01', people).attendance, /could not be verified/);
});

async function readerChecks() {
  const principal: AuthPrincipal = { userId: 'SYNTHETIC', displayName: 'Synthetic', role: 'super_admin', active: true, capabilities: roleCapabilities.super_admin };
  const reads: string[] = [];
  let concurrent = 0; let maximum = 0;
  const read = async <T extends { id: string }>(collection: string, id: string): Promise<T | null> => {
    reads.push(`${collection}/${id}`); concurrent++; maximum = Math.max(maximum, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 1)); concurrent--;
    if (id === 'DENIED') throw new Error('Permission denied');
    return { id } as T;
  };
  const batches: string[][] = [];
  const readBatch = async <T extends { id: string }>(collection: string, ids: string[]): Promise<Record<string, T | null>> => {
    batches.push(ids); concurrent++; maximum = Math.max(maximum, concurrent);
    await new Promise((resolve) => setTimeout(resolve, 1)); concurrent--;
    return Object.fromEntries(ids.filter((id) => id !== 'DENIED').map((id) => [id, { id } as T]));
  };
  await assert.rejects(loadProjectSlotSources({ ...principal, active: false }, ['A'], readBatch), /Forbidden/);
  await assert.rejects(loadProjectSlotSources({ ...principal, capabilities: roleCapabilities.finance }, ['A'], readBatch), /Forbidden/);
  assert.equal(reads.length, 0);
  assert.equal(batches.length, 0);
  const data = await loadProjectSlotSources(principal, ['A', 'A', 'DENIED', ...Array.from({ length: 20 }, (_, i) => `WO-${i}`)], readBatch);
  assert.deepEqual(batches.map((batch) => batch.length), [20, 2]); assert.ok(maximum <= 3); assert.equal(data.DENIED.failed, true);
  await loadProjectSlotSources(principal, Array.from({ length: 200 }, (_, i) => `WO-${i}`), readBatch);
  assert.equal(maximum, 3, 'Large histories must still bound concurrent batches.');
  reads.length = 0;
  await loadProjectSlotPeople({ ...principal, role: 'operations', capabilities: roleCapabilities.operations }, calculate().rows, read);
  assert.deepEqual(reads.sort(), ['staffProfiles/T1', 'staffProfiles/T2', 'staffProfiles/T3']);
  reads.length = 0;
  await loadProjectSlotPeople(principal, calculate().rows, read);
  assert.equal(reads.filter((path) => path.startsWith('employeeTimesheets/')).length, 6);
  const abort = new AbortController();
  reads.length = 0;
  const pending = loadProjectSlotPeople(principal, Array.from({ length: 30 }, (_, i) => ({ ...calculate().rows[0], technicianIds: [`TECH-${i}`], date: '' })), read, abort.signal);
  abort.abort();
  await pending;
  assert.equal(reads.length, 6, 'Abort must stop subsequent batches; already-issued reads may finish.');
  const batchAbort = new AbortController(); batches.length = 0;
  const pendingBatch = loadProjectSlotSources(principal, Array.from({ length: 100 }, (_, i) => `WO-${i}`), readBatch, batchAbort.signal);
  batchAbort.abort(); await pendingBatch;
  assert.equal(batches.length, 3, 'Abort must prevent subsequent batch requests.');
  console.log('PASS: exact reads, capability denial, bounded batches/concurrency, deduplication, abort and payroll privacy');
  console.log(`Project slot progress: ${passed + 1} acceptance groups passed.`);
}
readerChecks().catch((error) => { console.error(error); process.exitCode = 1; });
