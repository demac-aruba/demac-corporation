import { getFirestoreDocument, listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';
import { requireFirebaseWebSession } from './firebase/session';
import { validateDailyVanAssignment, validateVanCrew, vanOperatingStatus } from './van-profile';
import { invalidateLiveOperationalCapacityState } from './live-operational-capacity';
import type {
  CanonicalBusinessCalendar,
  CanonicalCalendarClosure,
  CanonicalDailyVanAssignment,
  CanonicalStaffAbsence,
  CanonicalStaffProfile,
  CanonicalVan,
  CanonicalVanHalfDaySchedule,
  CanonicalVanMaintenanceLog,
} from './canonical-operations';

function updated<T extends { id: string }>(record: T): T {
  return { ...record, updatedAt: new Date().toISOString() } as T;
}

/**
 * Canonical operations documents may contain Legacy fields that ERP Next has not
 * modeled yet. Existing documents are updated with an explicit field mask instead
 * of being replaced wholesale. New records are created normally.
 */
async function upsertCanonicalDocument<T extends { id: string }>(collectionPath: string, record: T): Promise<T> {
  const next = updated(record);
  const existing = await getFirestoreDocument<T>(collectionPath, next.id);
  if (!existing) return saveFirestoreDocument(collectionPath, next);
  const { id, ...changes } = next;
  return updateFirestoreDocument<T>(collectionPath, id, changes as Record<string, unknown>);
}

export function saveCanonicalStaffProfile(profile: CanonicalStaffProfile) {
  return upsertCanonicalDocument('staffProfiles', profile);
}

export async function saveCanonicalVanProfile(van: CanonicalVan) {
  const [vans, staffProfiles] = await Promise.all([
    listFirestoreCollection<CanonicalVan>('vans', 250),
    listFirestoreCollection<CanonicalStaffProfile>('staffProfiles', 500),
  ]);
  const normalized: CanonicalVan = {
    ...van,
    responsibleStaffId: van.responsibleStaffId || '',
    regularHelperId: van.regularHelperId || '',
    additionalHelperId: van.additionalHelperId || '',
    technicianIds: [van.responsibleStaffId, van.regularHelperId, van.additionalHelperId].filter((value): value is string => Boolean(value)),
  };
  const existing = vans.find(item => item.id === van.id);
  if (existing) {
    // A profile/maintenance save must never replay an old crew or overwrite effective history.
    const { responsibleStaffId: _driver, regularHelperId: _helper, additionalHelperId: _third,
      technicianIds: _ids, crewHistory: _history, crewRevision: _revision, ...profile } = normalized;
    const currentCrew = { ...profile, responsibleStaffId: existing.responsibleStaffId,
      regularHelperId: existing.regularHelperId, additionalHelperId: existing.additionalHelperId };
    validateVanCrew(currentCrew, staffProfiles, vans);
    const saved = await upsertCanonicalDocument('vans', { ...profile, status: vanOperatingStatus(currentCrew) });
    invalidateLiveOperationalCapacityState();
    return saved;
  }
  validateVanCrew(normalized, staffProfiles, vans);
  if (normalized.technicianIds?.length) throw new Error('Create the Van out of service, then assign its crew using the fleet editor.');
  const saved = await upsertCanonicalDocument('vans', normalized);
  invalidateLiveOperationalCapacityState();
  return saved;
}

export async function saveCanonicalDailyVanAssignment(assignment: CanonicalDailyVanAssignment) {
  const [vans, staffProfiles, assignments] = await Promise.all([
    listFirestoreCollection<CanonicalVan>('vans', 250),
    listFirestoreCollection<CanonicalStaffProfile>('staffProfiles', 500),
    listFirestoreCollection<CanonicalDailyVanAssignment>('dailyVanAssignments', 1000),
  ]);
  const normalized: CanonicalDailyVanAssignment = {
    ...assignment,
    driverStaffId: assignment.driverStaffId || '',
    helperStaffId: assignment.helperStaffId || '',
    additionalHelperStaffId: assignment.additionalHelperStaffId || '',
    status: assignment.status === 'Cancelled' ? 'Disponible' : assignment.status,
    originalDate: assignment.originalDate || assignment.date,
    cancelledAt: undefined,
    cancelledByUserId: undefined,
    cancelledByName: undefined,
  };
  validateDailyVanAssignment(normalized, staffProfiles, vans, assignments.filter((item) => item.id !== assignment.id && item.status !== 'Cancelled'));
  return upsertCanonicalDocument('dailyVanAssignments', normalized);
}

/**
 * Operationally remove a dated override without deleting its audit evidence.
 * Clearing the date makes the record impossible to resolve as a live dated assignment,
 * while the original date and actor remain available in Firestore for audit/recovery.
 */
export async function deleteCanonicalDailyVanAssignment(id: string) {
  const existing = await getFirestoreDocument<CanonicalDailyVanAssignment>('dailyVanAssignments', id);
  if (!existing) return null;
  const session = await requireFirebaseWebSession();
  const now = new Date().toISOString();
  return updateFirestoreDocument<CanonicalDailyVanAssignment>('dailyVanAssignments', id, {
    originalDate: existing.originalDate || existing.date || '',
    date: '',
    status: 'Cancelled',
    cancelledAt: now,
    cancelledByUserId: session.uid,
    cancelledByName: session.displayName || session.email,
    updatedAt: now,
  });
}

/**
 * Maintenance/repair creation is retry-safe for an ambiguous client response: an exact
 * same-user, same-Van, same-service payload reuses the existing log instead of appending
 * a duplicate financial/service-history row.
 */
export async function saveCanonicalVanMaintenanceLog(log: CanonicalVanMaintenanceLog) {
  const existingLogs = await listFirestoreCollection<CanonicalVanMaintenanceLog>('vanMaintenanceLogs', 1000);
  const retryMatch = existingLogs.find((item) => item.id !== log.id
    && item.vanId === log.vanId
    && item.date === log.date
    && item.category === log.category
    && item.type === log.type
    && item.description === log.description
    && item.odometerKm === log.odometerKm
    && item.cost === log.cost
    && item.createdByUserId === log.createdByUserId);
  if (retryMatch) {
    return upsertCanonicalDocument('vanMaintenanceLogs', {
      ...retryMatch,
      ...log,
      id: retryMatch.id,
      createdAt: retryMatch.createdAt || log.createdAt,
    });
  }
  return upsertCanonicalDocument('vanMaintenanceLogs', log);
}

export function saveCanonicalStaffAbsence(absence: CanonicalStaffAbsence) {
  return upsertCanonicalDocument('staffAbsences', absence);
}

export async function saveCanonicalVanHalfDaySchedule(schedule: CanonicalVanHalfDaySchedule) {
  const saved = await upsertCanonicalDocument('vanHalfDaySchedules', schedule);
  invalidateLiveOperationalCapacityState();
  return saved;
}

export function saveCanonicalBusinessCalendar(settings: CanonicalBusinessCalendar) {
  return upsertCanonicalDocument('businessSettings', {
    ...settings,
    id: 'business-calendar',
    closedWeekdays: [...new Set((settings.closedWeekdays ?? []).map(Number))].filter((day) => day >= 0 && day <= 6).sort(),
  });
}

export function saveCanonicalCalendarClosure(closure: CanonicalCalendarClosure) {
  return upsertCanonicalDocument('calendarClosures', { ...closure, active: true });
}

export function reopenCanonicalCalendarClosure(closure: CanonicalCalendarClosure) {
  return updateFirestoreDocument<CanonicalCalendarClosure>('calendarClosures', closure.id, {
    active: false,
    updatedAt: new Date().toISOString(),
  });
}
