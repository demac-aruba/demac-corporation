import { canonicalVanId } from './canonical-operations';
import type {
  CanonicalDailyVanAssignment,
  CanonicalStaffProfile,
  CanonicalVan,
} from './canonical-operations';

const TECHNICAL_ROLES = new Set(['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor']);

export function isTechnicalStaff(profile: CanonicalStaffProfile) {
  return profile.employeeType === 'Técnico' || TECHNICAL_ROLES.has(profile.role ?? '');
}

export function regularCrewIds(van: Pick<CanonicalVan, 'responsibleStaffId' | 'regularHelperId' | 'additionalHelperId'>) {
  return [van.responsibleStaffId, van.regularHelperId, van.additionalHelperId].filter((value): value is string => Boolean(value));
}

export function nextCanonicalVanId(vans: CanonicalVan[]) {
  const highest = vans.reduce((max, van) => {
    const values = [van.id, van.name ?? ''];
    const numbers = values.flatMap((value) => {
      const match = String(value).match(/(?:VAN|Van|van|V)[\s-]*(\d+)/);
      return match ? [Number(match[1])] : [];
    });
    return Math.max(max, ...numbers, 0);
  }, 0);
  return `VAN-${highest + 1}`;
}

export function validateVanCrew(van: CanonicalVan, staffProfiles: CanonicalStaffProfile[], existingVans: CanonicalVan[] = []) {
  const ids = regularCrewIds(van);
  if (new Set(ids).size !== ids.length) throw new Error('The same employee cannot occupy more than one regular crew position on the same Van.');

  const staffById = new Map(staffProfiles.map((profile) => [profile.id, profile]));
  const driver = van.responsibleStaffId ? staffById.get(van.responsibleStaffId) : undefined;
  const helper = van.regularHelperId ? staffById.get(van.regularHelperId) : undefined;
  const additionalHelper = van.additionalHelperId ? staffById.get(van.additionalHelperId) : undefined;

  if (van.responsibleStaffId && !driver) throw new Error('The selected responsible technician does not exist in the employee master.');
  if (driver && (driver.active === false || !isTechnicalStaff(driver))) throw new Error('The responsible technician must be an active technical employee.');
  if (driver && driver.canDriveVan !== true) throw new Error('The responsible technician must be authorized to drive Vans.');
  for (const [label, profile] of [['regular helper', helper], ['third helper', additionalHelper]] as const) {
    if (!profile) continue;
    if (profile.active === false || !isTechnicalStaff(profile)) throw new Error(`The selected ${label} must be an active technical employee.`);
  }

  const targetVanId = canonicalVanId(van.id, existingVans.length ? existingVans : [van]);
  for (const crewId of ids) {
    const conflict = existingVans.find((existing) => canonicalVanId(existing.id, existingVans) !== targetVanId && regularCrewIds(existing).includes(crewId));
    if (conflict) {
      const employee = staffById.get(crewId);
      throw new Error(`${employee?.name ?? 'This employee'} is already part of the regular crew for ${conflict.name ?? canonicalVanId(conflict.id, existingVans)}. Remove that regular assignment before assigning the employee to another Van.`);
    }
  }

  if ((van.status ?? 'Disponible') === 'Disponible') {
    if (!driver) throw new Error('An available Van requires a responsible technician / driver.');
    if (!helper) throw new Error('An available Van requires a regular helper.');
  }
  return true;
}

export function buildVanSaveRecord(
  van: CanonicalVan,
  staffProfiles: CanonicalStaffProfile[],
  existingVansOrNow: CanonicalVan[] | string = [],
  explicitNow?: string,
) {
  const existingVans = Array.isArray(existingVansOrNow) ? existingVansOrNow : [];
  const now = typeof existingVansOrNow === 'string' ? existingVansOrNow : explicitNow ?? new Date().toISOString();
  validateVanCrew(van, staffProfiles, existingVans);
  const crewIds = regularCrewIds(van);
  return {
    ...van,
    // Empty strings are intentional here: Firestore update masks must be able to clear an
    // existing optional crew slot instead of silently leaving the old employee assigned.
    responsibleStaffId: van.responsibleStaffId || '',
    regularHelperId: van.regularHelperId || '',
    additionalHelperId: van.additionalHelperId || '',
    technicianIds: crewIds,
    active: van.active !== false,
    createdAt: van.createdAt ?? now,
    updatedAt: now,
  } satisfies CanonicalVan;
}

export function validateDailyVanAssignment(
  assignment: CanonicalDailyVanAssignment,
  staffProfiles: CanonicalStaffProfile[],
  vans: CanonicalVan[] = [],
  assignments: CanonicalDailyVanAssignment[] = [],
) {
  if (!assignment.date) throw new Error('Choose a date for the temporary crew override.');
  if (!assignment.vanId) throw new Error('Choose a Van for the temporary crew override.');
  const ids = [assignment.driverStaffId, assignment.helperStaffId, assignment.additionalHelperStaffId].filter((value): value is string => Boolean(value));
  if (!ids.length) throw new Error('Assign at least one crew member to the temporary override.');
  if (new Set(ids).size !== ids.length) throw new Error('The same employee cannot occupy more than one temporary crew position on the same Van.');
  const staffById = new Map(staffProfiles.map((profile) => [profile.id, profile]));
  const driver = assignment.driverStaffId ? staffById.get(assignment.driverStaffId) : undefined;
  if (assignment.driverStaffId && (!driver || driver.active === false || !isTechnicalStaff(driver) || driver.canDriveVan !== true)) {
    throw new Error('The temporary driver must be an active technical employee authorized to drive Vans.');
  }
  for (const id of [assignment.helperStaffId, assignment.additionalHelperStaffId]) {
    if (!id) continue;
    const profile = staffById.get(id);
    if (!profile || profile.active === false || !isTechnicalStaff(profile)) throw new Error('Temporary helpers must be active technical employees.');
  }

  if (vans.length) {
    const targetVanId = canonicalVanId(assignment.vanId, vans);
    for (const crewId of ids) {
      const conflict = vans.find((van) => {
        const vanId = canonicalVanId(van.id, vans);
        if (vanId === targetVanId) return false;
        const dated = assignments.find((item) => item.date === assignment.date && canonicalVanId(item.vanId, vans) === vanId);
        const effectiveIds = dated
          ? [dated.driverStaffId || van.responsibleStaffId, dated.helperStaffId || van.regularHelperId, dated.additionalHelperStaffId || van.additionalHelperId].filter(Boolean)
          : regularCrewIds(van);
        return effectiveIds.includes(crewId);
      });
      if (conflict) {
        const employee = staffById.get(crewId);
        throw new Error(`${employee?.name ?? 'This employee'} is already assigned to ${conflict.name ?? canonicalVanId(conflict.id, vans)} on ${assignment.date}. Resolve that Van's daily crew first to prevent simultaneous assignments.`);
      }
    }
  }
  return true;
}

export function workedMinutes(startTime: string, endTime: string, breakMinutes = 0) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (end <= start) throw new Error('End time must be after start time.');
  const result = end - start - Math.max(0, Math.round(Number(breakMinutes) || 0));
  if (result <= 0) throw new Error('Break duration must be shorter than the worked window.');
  return result;
}

function timeToMinutes(value: string) {
  const match = String(value).match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid time: ${value}`);
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) throw new Error(`Invalid time: ${value}`);
  return hours * 60 + minutes;
}
