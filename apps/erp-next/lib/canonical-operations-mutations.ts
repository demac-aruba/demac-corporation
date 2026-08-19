import { getFirestoreDocument, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';
import type {
  CanonicalBusinessCalendar,
  CanonicalCalendarClosure,
  CanonicalDailyVanAssignment,
  CanonicalStaffAbsence,
  CanonicalStaffProfile,
  CanonicalVan,
  CanonicalVanHalfDaySchedule,
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

export function saveCanonicalVanProfile(van: CanonicalVan) {
  return upsertCanonicalDocument('vans', van);
}

export function saveCanonicalDailyVanAssignment(assignment: CanonicalDailyVanAssignment) {
  return upsertCanonicalDocument('dailyVanAssignments', assignment);
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
