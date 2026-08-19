import { listFirestoreCollection } from './firebase/firestore-rest';

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
  odometerKm?: number;
  nextServiceKm?: number;
  nextServiceDate?: string;
  insuranceExpiresAt?: string;
  registrationExpiresAt?: string;
  active?: boolean;
  notes?: string;
  updatedAt?: string;
};

export type CanonicalDailyVanAssignment = {
  id: string;
  date?: string;
  vanId?: string;
  driverStaffId?: string;
  helperStaffId?: string;
  status?: string;
  notes?: string;
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
  const match = compact.match(/^(?:van|v)([1-4])$/);
  return match ? `VAN-${match[1]}` : raw;
}

export function canonicalVanId(value: unknown, vans: CanonicalVan[] = []) {
  const direct = canonicalVanIdFromValue(value);
  if (/^VAN-[1-4]$/.test(direct)) return direct;
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

export function resolveCanonicalCrew(van: CanonicalVan, dateKey: string, state: CanonicalOperationsState) {
  const vanId = canonicalVanId(van.id, state.vans);
  const daily = state.dailyVanAssignments.find((assignment) => canonicalVanId(assignment.vanId, state.vans) === vanId && assignment.date === dateKey);
  const driverId = text(daily?.driverStaffId || van.responsibleStaffId);
  const helperId = text(daily?.helperStaffId || van.regularHelperId);
  const driver = state.staffProfiles.find((profile) => profile.id === driverId);
  const helper = state.staffProfiles.find((profile) => profile.id === helperId);
  return {
    vanId,
    daily,
    driver,
    helper,
    driverAbsence: driverId ? activeStaffAbsence(driverId, dateKey, state.staffAbsences) : undefined,
    helperAbsence: helperId ? activeStaffAbsence(helperId, dateKey, state.staffAbsences) : undefined,
  };
}

export async function loadCanonicalOperationsState(): Promise<CanonicalOperationsState> {
  const [staffProfiles, vans, dailyVanAssignments, staffAbsences, vanHalfDaySchedules, calendarClosures, businessSettings] = await Promise.all([
    listFirestoreCollection<CanonicalStaffProfile>('staffProfiles', 500),
    listFirestoreCollection<CanonicalVan>('vans', 250),
    listFirestoreCollection<CanonicalDailyVanAssignment>('dailyVanAssignments', 1000),
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
    dailyVanAssignments: [...dailyVanAssignments].sort((a, b) => `${b.date ?? ''}-${a.vanId ?? ''}`.localeCompare(`${a.date ?? ''}-${b.vanId ?? ''}`)),
    staffAbsences: [...staffAbsences].filter((absence) => absence.active !== false).sort((a, b) => String(b.fromDate ?? '').localeCompare(String(a.fromDate ?? ''))),
    vanHalfDaySchedules: [...vanHalfDaySchedules].filter((schedule) => schedule.active !== false).sort((a, b) => canonicalVanId(a.vanId, vans).localeCompare(canonicalVanId(b.vanId, vans))),
    calendarClosures: [...calendarClosures].filter((closure) => closure.active !== false).sort((a, b) => String(a.date ?? '').localeCompare(String(b.date ?? ''))),
    businessCalendar,
  };
}
