import { getFirestoreDocument } from './firebase/firestore-rest';
import { requireCapability, type AuthPrincipal } from './security';
import {
  type ProjectSlotWorkOrder, type ProjectSlotRead, type ProjectSlotRow,
  type ProjectSlotPeople, type ProjectSlotStaff, type ProjectSlotAttendance,
} from './project-slot-progress';

type DocumentReader = typeof getFirestoreDocument;
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
export async function loadProjectSlotSources(principal: AuthPrincipal, ids: string[], read: DocumentReader = getFirestoreDocument, signal?: AbortSignal) {
  requireProgressAccess(principal);
  return readDocuments<ProjectSlotWorkOrder>('workOrders', ids, read, signal);
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
