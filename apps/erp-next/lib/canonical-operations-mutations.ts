import { saveFirestoreDocument } from './firebase/firestore-rest';
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

export function saveCanonicalStaffProfile(profile: CanonicalStaffProfile) {
  return saveFirestoreDocument('staffProfiles', updated(profile));
}

export function saveCanonicalVanProfile(van: CanonicalVan) {
  return saveFirestoreDocument('vans', updated(van));
}

export function saveCanonicalDailyVanAssignment(assignment: CanonicalDailyVanAssignment) {
  return saveFirestoreDocument('dailyVanAssignments', updated(assignment));
}

export function saveCanonicalStaffAbsence(absence: CanonicalStaffAbsence) {
  return saveFirestoreDocument('staffAbsences', updated(absence));
}

export function saveCanonicalVanHalfDaySchedule(schedule: CanonicalVanHalfDaySchedule) {
  return saveFirestoreDocument('vanHalfDaySchedules', updated(schedule));
}

export function saveCanonicalBusinessCalendar(settings: CanonicalBusinessCalendar) {
  return saveFirestoreDocument('businessSettings', updated({
    ...settings,
    id: 'business-calendar',
    closedWeekdays: [...new Set((settings.closedWeekdays ?? []).map(Number))].filter((day) => day >= 0 && day <= 6).sort(),
  }));
}

export function saveCanonicalCalendarClosure(closure: CanonicalCalendarClosure) {
  return saveFirestoreDocument('calendarClosures', updated({ ...closure, active: true }));
}

export function reopenCanonicalCalendarClosure(closure: CanonicalCalendarClosure) {
  return saveFirestoreDocument('calendarClosures', updated({ ...closure, active: false }));
}
