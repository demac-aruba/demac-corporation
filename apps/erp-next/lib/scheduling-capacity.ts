import type { BookingRequest, CandidateSlot, DispatchJob, SchedulingSettings, VanResource } from './scheduling';
import { defaultSchedulingSettings, findCandidateSlots, minutesToTime, previewVans, timeToMinutes } from './scheduling';

export type OperationalDay = {
  dateKey: string;
  weekday: string;
  shortDate: string;
  isToday: boolean;
  isOpen: boolean;
  shiftLabel: string;
};

export type CalendarDispatchJob = DispatchJob & { dateKey: string };

function arubaDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Aruba', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

function dateFromKey(dateKey: string) {
  return new Date(`${dateKey}T12:00:00Z`);
}

function addDays(dateKey: string, amount: number) {
  const date = dateFromKey(dateKey);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function mondayOf(dateKey: string) {
  const date = dateFromKey(dateKey);
  const day = date.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addDays(dateKey, delta);
}

export function currentArubaDateKey() {
  return arubaDateKey(new Date());
}

export function buildOperationalWeek(referenceDateKey = currentArubaDateKey()): OperationalDay[] {
  const monday = mondayOf(referenceDateKey);
  return Array.from({ length: 7 }, (_, index) => {
    const dateKey = addDays(monday, index);
    const date = dateFromKey(dateKey);
    const weekdayIndex = date.getUTCDay();
    const isSaturday = weekdayIndex === 6;
    const isSunday = weekdayIndex === 0;
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date);
    const shortDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
    return {
      dateKey,
      weekday,
      shortDate,
      isToday: dateKey === referenceDateKey,
      isOpen: !isSunday,
      shiftLabel: isSunday ? 'Closed' : isSaturday ? '9:00 AM–1:00 PM' : '8:00 AM–5:00 PM',
    };
  });
}

export function jobsForDate(jobs: CalendarDispatchJob[], dateKey: string): DispatchJob[] {
  return jobs.filter((job) => job.dateKey === dateKey);
}

function restrictionAllowsMorningStart(request: BookingRequest) {
  const restriction = request.restriction;
  if (!restriction) return true;
  if (restriction.halfDay === 'pm') return false;
  if (restriction.notBefore && timeToMinutes(restriction.notBefore) > timeToMinutes('08:30')) return false;
  if (restriction.notAfter && timeToMinutes(restriction.notAfter) < timeToMinutes('08:30')) return false;
  return true;
}

function addSameSiteWorkingMinutes(quantity: number, settings: SchedulingSettings) {
  const start = timeToMinutes('08:30');
  const lunchStart = timeToMinutes(settings.lunchStart);
  const lunchEnd = timeToMinutes(settings.lunchEnd);
  const minutesNeeded = quantity * 60;
  const beforeLunch = lunchStart - start;
  if (minutesNeeded <= beforeLunch) return minutesToTime(start + minutesNeeded);
  return minutesToTime(lunchEnd + (minutesNeeded - beforeLunch));
}

function conflictsWithSpan(jobs: DispatchJob[], vanId: string, start: string, end: string) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return jobs.some((job) => {
    if (job.vanId !== vanId || job.status === 'cancelled') return false;
    const jobStart = timeToMinutes(job.start);
    const jobEnd = timeToMinutes(job.end);
    return startMinutes < jobEnd && endMinutes > jobStart;
  });
}

export function findExtendedSameSitePlan(request: BookingRequest, jobs: DispatchJob[], vans: VanResource[] = previewVans, settings: SchedulingSettings = defaultSchedulingSettings): CandidateSlot[] {
  if (request.presetId !== 'standard_service') return [];
  if (request.quantity < 4 || request.quantity > settings.maxStandardUnitsSameSiteSingleVan) return [];
  if (!restrictionAllowsMorningStart(request)) return [];

  const start = '08:30';
  const end = addSameSiteWorkingMinutes(request.quantity, settings);
  if (timeToMinutes(end) > timeToMinutes('16:30')) return [];

  return vans
    .filter((van) => van.active && !conflictsWithSpan(jobs, van.id, start, end))
    .map((van, index) => ({
      vanId: van.id,
      start,
      end,
      segment: 'full_day' as const,
      sector: request.sector,
      score: 132 - index * 4,
      reasons: [
        `${request.quantity} same-site services planned continuously across the operational day`,
        'Lunch is skipped as working time rather than counted as customer-service duration',
        'No property-to-property transit is required',
      ],
      requiresSupportVan: false,
      primaryUnits: request.quantity,
    }));
}

export function findCandidateSlotsV2(request: BookingRequest, jobs: DispatchJob[], vans: VanResource[] = previewVans, settings: SchedulingSettings = defaultSchedulingSettings) {
  const extended = findExtendedSameSitePlan(request, jobs, vans, settings);
  if (extended.length) return extended;
  return findCandidateSlots(request, jobs, vans, settings);
}

export function weekCapacity(jobs: CalendarDispatchJob[], week: OperationalDay[]) {
  return week.map((day) => {
    const dayJobs = jobs.filter((job) => job.dateKey === day.dateKey && job.status !== 'cancelled');
    const occupiedVans = new Set(dayJobs.map((job) => job.vanId)).size;
    const blocked = dayJobs.filter((job) => job.readiness === 'blocked').length;
    return { dateKey: day.dateKey, jobs: dayJobs.length, occupiedVans, blocked, isOpen: day.isOpen };
  });
}
