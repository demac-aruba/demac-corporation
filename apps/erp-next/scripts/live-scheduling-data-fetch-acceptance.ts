import {
  buildFirestoreOverlapDateRangeQuery,
  type FirestoreOverlapDateRangeArgs,
} from '../lib/firebase/firestore-rest';
import {
  createLiveOperationalCapacityLoader,
  loadLiveStaffAbsencesForRange,
  type LiveOperationalCapacityState,
} from '../lib/live-operational-capacity';
import {
  createLiveSchedulingAppointmentsFastLoader,
  createLiveSchedulingAttributionResolver,
} from '../lib/live-scheduling-fast';

function requireCondition(condition: unknown, message: string) {
  if (!condition) throw new Error(`Live scheduling data-fetch acceptance failed: ${message}`);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function capacityState(id: string): LiveOperationalCapacityState {
  return {
    vans: new Map(),
    staffProfiles: [],
    staffAbsences: [],
    dailyAssignments: [],
    halfDaySchedules: [],
    calendarClosures: [{ id, date: '2026-09-01', active: true }],
    closedWeekdays: [0],
  };
}

async function verifyCapacityFlightIdentity() {
  const reads: Array<ReturnType<typeof deferred<LiveOperationalCapacityState>>> = [];
  const loader = createLiveOperationalCapacityLoader(async () => {
    const read = deferred<LiveOperationalCapacityState>();
    reads.push(read);
    return read.promise;
  }, () => 10_000);
  const firstRange = { startDate: '2026-09-01', endDate: '2026-09-07' };

  const first = loader({ ...firstRange, force: true });
  const duplicateForce = loader({ ...firstRange, force: true });
  requireCondition(first === duplicateForce, 'Concurrent forced reads for the same range must share one pending promise identity.');
  await Promise.resolve();
  requireCondition(reads.length === 1, 'A forced refresh must start exactly one capacity read.');
  const initialState = capacityState('initial');
  reads[0].resolve(initialState);
  requireCondition(await first === initialState, 'The shared capacity flight must resolve its canonical state.');
  requireCondition(await loader(firstRange) === initialState && reads.length === 1, 'A fresh range cache must not re-read capacity.');

  const older = loader({ ...firstRange, force: true });
  await Promise.resolve();
  const secondRange = { startDate: '2026-09-08', endDate: '2026-09-14' };
  const newer = loader({ ...secondRange, force: true });
  await Promise.resolve();
  requireCondition(reads.length === 3, 'Different ranges must retain distinct refresh identities.');
  const newerState = capacityState('newer');
  reads[2].resolve(newerState);
  await newer;
  reads[1].resolve(capacityState('superseded'));
  await older;
  requireCondition(await loader(secondRange) === newerState && reads.length === 3, 'A slower superseded read must not clear or overwrite the newer range cache.');
}

async function verifyScopedAbsenceRead() {
  let overlapRequest: FirestoreOverlapDateRangeArgs | undefined;
  let globalReads = 0;
  const absences = await loadLiveStaffAbsencesForRange('2026-09-01', '2026-09-07', {
    queryOverlap: async (request) => {
      overlapRequest = request;
      return [{ id: 'ABS-SPANS-WEEK', staffId: 'STAFF-1', fromDate: '2026-08-20', toDate: '2026-09-20' }];
    },
    listAll: async () => {
      globalReads += 1;
      return [];
    },
  });
  requireCondition(globalReads === 0, 'A requested week must never fall back to the global staffAbsences list.');
  requireCondition(absences[0]?.id === 'ABS-SPANS-WEEK', 'An absence spanning the complete requested week must be retained.');
  requireCondition(overlapRequest?.startFieldPath === 'fromDate' && overlapRequest.endFieldPath === 'toDate', 'Absence intersection must constrain both range boundaries.');
  requireCondition(overlapRequest?.startInclusive === '2026-09-01' && overlapRequest.endInclusive === '2026-09-07', 'Absence intersection must use the exact requested week.');

  const structured = buildFirestoreOverlapDateRangeQuery(overlapRequest!);
  const filters = structured.where.compositeFilter.filters;
  requireCondition(filters[0].fieldFilter.op === 'LESS_THAN_OR_EQUAL' && filters[0].fieldFilter.value.stringValue === '2026-09-07', 'The absence start must be on/before the requested week end.');
  requireCondition(filters[1].fieldFilter.op === 'GREATER_THAN_OR_EQUAL' && filters[1].fieldFilter.value.stringValue === '2026-09-01', 'The absence end must be on/after the requested week start.');
  requireCondition(!('limit' in structured), 'The scoped overlap query must not silently truncate relevant absences with a global limit.');
}

async function verifyAttributionPendingDeduplication() {
  const read = deferred<Array<{ appointmentId: string; createdByName: string }>>();
  const requests: string[][] = [];
  const resolveAttribution = createLiveSchedulingAttributionResolver(async (appointmentIds) => {
    requests.push([...appointmentIds]);
    return read.promise;
  }, () => 20_000);

  const first = resolveAttribution(['APT-1', 'APT-2']);
  const overlapping = resolveAttribution(['APT-1']);
  await Promise.resolve();
  requireCondition(requests.length === 1 && requests[0].join(',') === 'APT-1,APT-2', 'Overlapping refresh enrichment must join pending attribution instead of duplicating APT-1.');
  read.resolve([
    { appointmentId: 'APT-1', createdByName: 'Operator One' },
    { appointmentId: 'APT-2', createdByName: 'Operator Two' },
  ]);
  const [firstResult, overlappingResult] = await Promise.all([first, overlapping]);
  requireCondition(firstResult.get('APT-1')?.createdByName === 'Operator One', 'The original attribution flight must resolve its records.');
  requireCondition(overlappingResult.get('APT-1')?.createdByName === 'Operator One', 'The overlapping refresh must receive the shared pending attribution.');
  await resolveAttribution(['APT-1']);
  requireCondition(requests.length === 1, 'Resolved attribution must be served from the short-lived cache.');
}

async function verifyCapacityInjectionIntoProjection() {
  let fallbackCapacityReads = 0;
  let projectedState: LiveOperationalCapacityState | null = null;
  const injectedState = capacityState('injected');
  const fallbackState = capacityState('fallback');
  const loadAppointments = createLiveSchedulingAppointmentsFastLoader({
    loadWorkOrders: async () => [],
    loadReferences: async () => ({ clients: [], properties: [], vans: [] }),
    loadOperationalState: async () => {
      fallbackCapacityReads += 1;
      return fallbackState;
    },
    projectAppointments: (_workOrders, _clients, _properties, _vans, _attribution, operationalState) => {
      projectedState = operationalState;
      return [];
    },
  });
  const range = { startDate: '2026-09-01', endDate: '2026-09-07' };

  await loadAppointments(range, { operationalState: Promise.resolve(injectedState) });
  requireCondition(fallbackCapacityReads === 0 && projectedState === injectedState, 'A refresh-provided capacity flight must be injected into projection without a second read.');
  await loadAppointments(range);
  requireCondition(fallbackCapacityReads === 1 && projectedState === fallbackState, 'Standalone callers must retain the safe capacity-loading fallback.');
}

async function main() {
  await verifyCapacityFlightIdentity();
  await verifyScopedAbsenceRead();
  await verifyAttributionPendingDeduplication();
  await verifyCapacityInjectionIntoProjection();
  console.log('Live scheduling data-fetch acceptance passed: one identity-safe capacity flight feeds each projection, attribution joins pending work, and staff absences are week-scoped without truncation.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
