import { batchGetFirestoreDocuments, FIRESTORE_BATCH_GET_LIMIT, getFirestoreDocument } from './firebase/firestore-rest';
import { requireCapability, type AuthPrincipal } from './security';
import {
  type ProjectSlotWorkOrder, type ProjectSlotRead, type ProjectSlotRow,
  type ProjectSlotPeople, type ProjectSlotStaff, type ProjectSlotAttendance,
} from './project-slot-progress';

type DocumentReader = typeof getFirestoreDocument;
const SLOT_FIELDS = ['appointmentId', 'clientId', 'propertyId', 'date', 'time', 'vanId', 'status', 'scheduledSlots', 'technicianIds'];
/** Bounded concurrency and exact IDs: no collection scan, date cutoff or stored counter. */
async function readDocuments<T extends { id: string }>(collection: string, ids: string[], read: DocumentReader, signal?: AbortSignal) {
  const result: Record<string, ProjectSlotRead<T>> = Object.create(null);
  let cursor = 0;
  const unique = [...new Set(ids)];
  await Promise.all(Array.from({ length: Math.min(6, unique.length) }, async () => {
    while (!signal?.aborted && cursor < unique.length) {
      const id = unique[cursor++];
      try { result[id] = { value: await read<T>(collection, id) }; }
      catch { result[id] = { value: null, failed: true }; }
    }
  }));
  return result;
}
function requireProgressAccess(principal: AuthPrincipal) {
  requireCapability(principal, 'projects.view');
  requireCapability(principal, 'work_orders.view');
}
export async function loadProjectSlotSources(principal: AuthPrincipal, ids: string[], read = batchGetFirestoreDocuments, signal?: AbortSignal) {
  requireProgressAccess(principal);
  const result: Record<string, ProjectSlotRead<ProjectSlotWorkOrder>> = Object.create(null);
  const unique = [...new Set(ids)];
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(3, Math.ceil(unique.length / FIRESTORE_BATCH_GET_LIMIT)) }, async () => {
    while (!signal?.aborted && cursor < unique.length) {
      const batch = unique.slice(cursor, cursor += FIRESTORE_BATCH_GET_LIMIT);
      try {
        const values = await read<ProjectSlotWorkOrder>('workOrders', batch, { fieldPaths: SLOT_FIELDS, signal });
        for (const id of batch) result[id] = Object.hasOwn(values, id)
          ? { value: values[id] } : { value: null, failed: true };
      } catch {
        for (const id of batch) result[id] = { value: null, failed: true };
      }
    }
  }));
  return result;
}
export async function loadProjectSlotPeople(principal: AuthPrincipal, rows: ProjectSlotRow[], read: DocumentReader = getFirestoreDocument, signal?: AbortSignal): Promise<ProjectSlotPeople> {
  requireProgressAccess(principal);
  const canReadAttendance = principal.capabilities.has('payroll_sensitive.view');
  const staffIds = rows.flatMap((row) => row.technicianIds);
  const attendanceIds = rows.flatMap((row) => row.date ? row.technicianIds.map((id) => `${id}_${row.date}`) : []);
  const [staff, attendance] = await Promise.all([
    readDocuments<ProjectSlotStaff>('staffProfiles', staffIds, read, signal),
    canReadAttendance ? readDocuments<ProjectSlotAttendance>('employeeTimesheets', attendanceIds, read, signal) : Promise.resolve({}),
  ]);
  return { staff, attendance, canReadAttendance };
}
