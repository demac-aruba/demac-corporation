import { deleteFirestoreDocument, getFirestoreDocument, listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';
import { validateDailyVanAssignment, validateVanCrew } from './van-profile';
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
  validateVanCrew(normalized, staffProfiles, vans);
  return upsertCanonicalDocument('vans', normalized);
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
  };
  validateDailyVanAssignment(normalized, staffProfiles, vans, assignments.filter((item) => item.id !== assignment.id));
  return upsertCanonicalDocument('dailyVanAssignments', normalized);
}

export function deleteCanonicalDailyVanAssignment(id: string) {
  return deleteFirestoreDocument('dailyVanAssignments', id);
}

export function saveCanonicalVanMaintenanceLog(log: CanonicalVanMaintenanceLog) {
  return upsertCanonicalDocument('vanMaintenanceLogs', log);
}

export function saveCanonicalStaffAbsence(absence: CanonicalStaffAbsence) {
  return upsertCanonicalDocument('staffAbsences', absence);
}

export function saveCanonicalVanHalfDaySchedule(schedule: CanonicalVanHalfDaySchedule) {
  return upsertCanonicalDocument('vanHalfDaySchedules', schedule);
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
