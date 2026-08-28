import { listFirestoreCollection } from './firebase/firestore-rest';
import { normalizeWorkforceSkills, type WorkforceEmployee } from './workforce-readiness';

export type CanonicalStaffAvailability = 'Disponible' | 'Enfermo' | 'Vacaciones' | 'Libre' | 'Inactivo' | string;

export type CanonicalStaffProfile = {
  id: string;
  name?: string;
  phone?: string;
  email?: string;
  role?: string;
  employeeType?: string;
  canDriveVan?: boolean;
  primaryVanId?: string;
  skills?: string[];
  skillsVerified?: boolean;
  availability?: CanonicalStaffAvailability;
  unavailableFrom?: string;
  unavailableUntil?: string;
  active?: boolean;
  notes?: string;
  updatedAt?: string;
};

export type CanonicalVan = {
  id: string;
  name?: string;
  plate?: string;
  technicianIds?: string[];
  status?: string;
  responsibleStaffId?: string;
  regularHelperId?: string;
  additionalHelperId?: string;
  odometerKm?: number;
  nextServiceKm?: number;
  nextServiceDate?: string;
  insuranceExpiresAt?: string;
  registrationExpiresAt?: string;
  make?: string;
  model?: string;
  year?: number;
  imageUrl?: string;
  active?: boolean;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CanonicalDailyVanAssignment = {
  id: string;
  date?: string;
  originalDate?: string;
  vanId?: string;
  driverStaffId?: string;
  helperStaffId?: string;
  additionalHelperStaffId?: string;
  status?: string;
  reason?: string;
  notes?: string;
  createdByUserId?: string;
  createdByName?: string;
  createdAt?: string;
  cancelledAt?: string;
  cancelledByUserId?: string;
  cancelledByName?: string;
  updatedAt?: string;
};

export type CanonicalVanMaintenanceLog = {
  id: string;
  vanId?: string;
  date?: string;
  odometerKm?: number;
  type?: string;
  category?: 'maintenance' | 'repair' | string;
  description?: string;
  cost?: number;
  vendor?: string;
  nextDueKm?: number;
  nextDueDate?: string;
  notes?: string;
  createdByUserId?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type CanonicalStaffAbsence = {
  id: string;
  staffId?: string;
  fromDate?: string;
  toDate?: string;
  reason?: string;
  notes?: string;
  active?: boolean;
  updatedAt?: string;
};

export type CanonicalVanHalfDaySchedule = {
  id: string;
  vanId?: string;
  weekday?: number;
  active?: boolean;
  workdayStart?: string;
  workdayEnd?: string;
  extraMorningSlot?: string;
  notes?: string;
  updatedAt?: string;
};

export type CanonicalCalendarClosure = {
  id: string;
  date?: string;
  reason?: string;
  notes?: string;
  active?: boolean;
  updatedAt?: string;
};

export type CanonicalBusinessCalendar = {
  id: string;
  closedWeekdays?: number[];
  updatedAt?: string;
};

export type CanonicalOperationsState = {
  staffProfiles: CanonicalStaffProfile[];
  vans: CanonicalVan[];
  dailyVanAssignments: CanonicalDailyVanAssignment[];
  vanMaintenanceLogs: CanonicalVanMaintenanceLog[];
  staffAbsences: CanonicalStaffAbsence[];
  vanHalfDaySchedules: CanonicalVanHalfDaySchedule[];
  calendarClosures: CanonicalCalendarClosure[];
  businessCalendar: CanonicalBusinessCalendar;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalVanIdFromValue(value: unknown) {
  const raw = text(value);
  if (!raw) return '';
  const compact = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
  const match = compact.match(/^(?:van|v)(\d+)$/);
  return match ? `VAN-${Number(match[1])}` : raw;
}

export function canonicalVanId(value: unknown, vans: CanonicalVan[] = []) {
  const direct = canonicalVanIdFromValue(value);
  if (/^VAN-\d+$/.test(direct)) return direct;
  const raw = text(value);
  const record = vans.find((van) => van.id === raw);
  if (!record) return direct;
  return canonicalVanIdFromValue(record.name) || direct;
}

export function weekdayLabel(value: unknown) {
  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < WEEKDAYS.length ? WEEKDAYS[index] : 'Not configured';
}

export function staffDisplayName(profile: CanonicalStaffProfile | undefined) {
  return text(profile?.name) || 'Unassigned';
}

export function activeStaffAbsence(profileId: string, dateKey: string, absences: CanonicalStaffAbsence[]) {
  return absences.find((absence) => absence.active !== false
    && absence.staffId === profileId
    && Boolean(absence.fromDate)
    && Boolean(absence.toDate)
    && dateKey >= String(absence.fromDate)
    && dateKey <= String(absence.toDate));
}

function profileUnavailable(profile: CanonicalStaffProfile | undefined, dateKey: string, state: CanonicalOperationsState) {
  if (!profile || profile.active === false || profile.availability === 'Inactivo') return true;
  const availability = text(profile.availability);
  const generallyUnavailable = Boolean(availability && availability !== 'Disponible')
    && (!profile.unavailableFrom || dateKey >= profile.unavailableFrom)
    && (!profile.unavailableUntil || dateKey <= profile.unavailableUntil);
  return generallyUnavailable || Boolean(activeStaffAbsence(profile.id, dateKey, state.staffAbsences));
}

export function resolveCanonicalCrew(van: CanonicalVan, dateKey: string, state: CanonicalOperationsState) {
  const vanId = canonicalVanId(van.id, state.vans);
  const daily = state.dailyVanAssignments.find((assignment) => assignment.status !== 'Cancelled'
    && canonicalVanId(assignment.vanId, state.vans) === vanId
    && assignment.date === dateKey);
  const driverId = text(daily?.driverStaffId || van.responsibleStaffId);
  const helperId = text(daily?.helperStaffId || van.regularHelperId);
  const additionalHelperId = text(daily?.additionalHelperStaffId || van.additionalHelperId);
  const driver = state.staffProfiles.find((profile) => profile.id === driverId);
  const helper = state.staffProfiles.find((profile) => profile.id === helperId);
  const additionalHelper = state.staffProfiles.find((profile) => profile.id === additionalHelperId);
  return {
    vanId,
    daily,
    driver,
    helper,
    additionalHelper,
    driverUnavailable: profileUnavailable(driver, dateKey, state),
    helperUnavailable: profileUnavailable(helper, dateKey, state),
    additionalHelperUnavailable: additionalHelper ? profileUnavailable(additionalHelper, dateKey, state) : false,
    driverAbsence: driverId ? activeStaffAbsence(driverId, dateKey, state.staffAbsences) : undefined,
    helperAbsence: helperId ? activeStaffAbsence(helperId, dateKey, state.staffAbsences) : undefined,
    additionalHelperAbsence: additionalHelperId ? activeStaffAbsence(additionalHelperId, dateKey, state.staffAbsences) : undefined,
  };
}

function canonicalPhysicalVans(state: CanonicalOperationsState) {
  const byId = new Map<string, CanonicalVan>();
  for (const van of state.vans) {
    const id = canonicalVanId(van.id, state.vans);
    const current = byId.get(id);
    if (!current || van.id === id) byId.set(id, van);
  }
  return [...byId.values()];
}

/**
 * Build a transient, date-aware crew roster from canonical Firestore operations data.
 * This is intentionally not persisted in browser storage. Daily crew overrides and
 * staff absences are resolved before readiness evaluates the assigned vans.
 */
export function canonicalCrewReadinessRoster(state: CanonicalOperationsState, dateKey: string): WorkforceEmployee[] {
  const roster: WorkforceEmployee[] = [];
  const seen = new Set<string>();

  for (const van of canonicalPhysicalVans(state)) {
    const crew = resolveCanonicalCrew(van, dateKey, state);
    for (const entry of [
      { profile: crew.driver, unavailable: crew.driverUnavailable },
      { profile: crew.helper, unavailable: crew.helperUnavailable },
      { profile: crew.additionalHelper, unavailable: crew.additionalHelperUnavailable },
    ]) {
      const profile = entry.profile;
      if (!profile || seen.has(`${crew.vanId}|${profile.id}`)) continue;
      seen.add(`${crew.vanId}|${profile.id}`);
      roster.push({
        id: profile.id,
        name: staffDisplayName(profile),
        role: text(profile.role) || 'Field staff',
        vanId: crew.vanId,
        active: !entry.unavailable,
        skills: normalizeWorkforceSkills(profile.skills ?? []),
        skillsVerified: profile.skillsVerified === true,
        source: 'canonical_firestore',
        updatedAt: text(profile.updatedAt) || new Date(0).toISOString(),
      });
    }
  }

  return roster;
}

export async function loadCanonicalOperationsState(): Promise<CanonicalOperationsState> {
  const [staffProfiles, vans, dailyVanAssignments, vanMaintenanceLogs, staffAbsences, vanHalfDaySchedules, calendarClosures, businessSettings] = await Promise.all([
    listFirestoreCollection<CanonicalStaffProfile>('staffProfiles', 500),
    listFirestoreCollection<CanonicalVan>('vans', 250),
    listFirestoreCollection<CanonicalDailyVanAssignment>('dailyVanAssignments', 1000),
    listFirestoreCollection<CanonicalVanMaintenanceLog>('vanMaintenanceLogs', 1000),
    listFirestoreCollection<CanonicalStaffAbsence>('staffAbsences', 1000),
    listFirestoreCollection<CanonicalVanHalfDaySchedule>('vanHalfDaySchedules', 250),
    listFirestoreCollection<CanonicalCalendarClosure>('calendarClosures', 500),
    listFirestoreCollection<CanonicalBusinessCalendar>('businessSettings', 250),
  ]);

  const businessCalendar = businessSettings.find((setting) => setting.id === 'business-calendar') ?? {
    id: 'business-calendar',
    closedWeekdays: [0],
  };

  return {
    staffProfiles: [...staffProfiles].sort((a, b) => staffDisplayName(a).localeCompare(staffDisplayName(b))),
    vans: [...vans].filter((van) => van.active !== false).sort((a, b) => canonicalVanId(a.id, vans).localeCompare(canonicalVanId(b.id, vans))),
    dailyVanAssignments: [...dailyVanAssignments]
      .filter((assignment) => assignment.status !== 'Cancelled')
      .sort((a, b) => `${b.date ?? ''}-${a.vanId ?? ''}`.localeCompare(`${a.date ?? ''}-${b.vanId ?? ''}`)),
    vanMaintenanceLogs: [...vanMaintenanceLogs].sort((a, b) => `${b.date ?? ''}-${b.updatedAt ?? ''}`.localeCompare(`${a.date ?? ''}-${a.updatedAt ?? ''}`)),
    staffAbsences: [...staffAbsences].filter((absence) => absence.active !== false).sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? ''))),
    vanHalfDaySchedules: [...vanHalfDaySchedules].filter((schedule) => schedule.active !== false).sort((a, b) => canonicalVanId(a.vanId, vans).localeCompare(canonicalVanId(b.vanId, vans))),
    calendarClosures: [...calendarClosures].filter((closure) => closure.active !== false).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))),
    businessCalendar,
  };
}
