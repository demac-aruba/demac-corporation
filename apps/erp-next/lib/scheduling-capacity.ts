import type { BookingRequest, CandidateSlot, DispatchJob, HalfDay, SchedulingSettings, VanResource } from './scheduling';
import { calculateDurationMinutes, findCandidateSlots, getPresetDurationMinutes, getRuntimeSchedulingSettings, minutesToTime, previewVans, sectorsCompatible, timeToMinutes } from './scheduling';

export type OperationalDay = {
  dateKey: string;
  weekday: string;
  shortDate: string;
  isToday: boolean;
  isOpen: boolean;
  shiftLabel: string;
};

export type CalendarDispatchJob = DispatchJob & { dateKey: string };

export type SupportReflowPlan = {
  id: string;
  supportJobId: string;
  vanId: string;
  customer: string;
  sector: string;
  quantity: number;
  fromStart: string;
  fromEnd: string;
  toStart: string;
  toEnd: string;
  toSegment: HalfDay;
  unlockedSlot: CandidateSlot;
  score: number;
  reasons: string[];
};

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

export function jobsForDate(jobs: CalendarDispatchJob[], dateKey: string): CalendarDispatchJob[] {
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
  const minutesNeeded = quantity * getPresetDurationMinutes('standard_service', settings);
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

export function findExtendedSameSitePlan(request: BookingRequest, jobs: DispatchJob[], vans: VanResource[] = previewVans, settings: SchedulingSettings = getRuntimeSchedulingSettings()): CandidateSlot[] {
  if (request.presetId !== 'standard_service') return [];
  if (request.quantity < 4 || request.quantity > settings.maxStandardUnitsSameSiteSingleVan) return [];
  if (!restrictionAllowsMorningStart(request)) return [];

  const start = '08:30';
  const end = addSameSiteWorkingMinutes(request.quantity, settings);
  const latestEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  if (timeToMinutes(end) > latestEnd) return [];

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
        `Configured standard-service duration: ${getPresetDurationMinutes('standard_service', settings)} minutes per unit`,
        'Lunch is skipped as working time rather than counted as customer-service duration',
        'No property-to-property transit is required',
      ],
      requiresSupportVan: false,
      primaryUnits: request.quantity,
    }));
}

export function findCandidateSlotsV2(request: BookingRequest, jobs: DispatchJob[], vans: VanResource[] = previewVans, settings: SchedulingSettings = getRuntimeSchedulingSettings()) {
  const extended = findExtendedSameSitePlan(request, jobs, vans, settings);
  if (extended.length) return extended;
  return findCandidateSlots(request, jobs, vans, settings);
}

function saturdayRestrictionAllows(start: string, request: BookingRequest) {
  const restriction = request.restriction;
  if (!restriction) return true;
  if (restriction.halfDay === 'pm') return false;
  if (restriction.notBefore && timeToMinutes(start) < timeToMinutes(restriction.notBefore)) return false;
  if (restriction.notAfter && timeToMinutes(start) > timeToMinutes(restriction.notAfter)) return false;
  return true;
}

function saturdayAnchor(jobs: DispatchJob[], vanId: string) {
  return jobs.filter((job) => job.vanId === vanId && job.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start))[0];
}

export function findSaturdaySlots(request: BookingRequest, jobs: DispatchJob[], vans: VanResource[] = previewVans, settings: SchedulingSettings = getRuntimeSchedulingSettings()): CandidateSlot[] {
  const duration = calculateDurationMinutes(request, settings);
  const starts = ['09:00', '10:00', '11:00', '12:00'];
  const dayEnd = timeToMinutes('13:00') - settings.routeMarginMinutes;
  const candidates: CandidateSlot[] = [];

  for (const van of vans.filter((resource) => resource.active)) {
    const anchor = saturdayAnchor(jobs, van.id);
    if (anchor && !sectorsCompatible(anchor.sector, request.sector)) continue;
    for (const start of starts) {
      if (!saturdayRestrictionAllows(start, request)) continue;
      const startMinutes = timeToMinutes(start);
      const endMinutes = startMinutes + duration;
      if (endMinutes > dayEnd) continue;
      if (conflictsWithSpan(jobs, van.id, start, minutesToTime(endMinutes))) continue;
      candidates.push({
        vanId: van.id,
        start,
        end: minutesToTime(endMinutes),
        segment: 'am',
        sector: request.sector,
        score: (anchor?.sector === request.sector ? 120 : 108) - candidates.length,
        reasons: [anchor ? 'Saturday route-compatible with existing anchor' : 'Open Saturday short-shift capacity', `Configured duration: ${duration} minutes`, `Configured route buffer: ${settings.routeMarginMinutes} minutes`],
        requiresSupportVan: false,
        primaryUnits: request.quantity,
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 8);
}

export function findCandidateSlotsForDay(day: OperationalDay, request: BookingRequest, jobs: DispatchJob[], vans: VanResource[] = previewVans, settings: SchedulingSettings = getRuntimeSchedulingSettings()) {
  if (!day.isOpen) return [];
  if (day.weekday === 'Sat') return findSaturdaySlots(request, jobs, vans, settings);
  return findCandidateSlotsV2(request, jobs, vans, settings);
}

function weekdayWorkingWindowAllows(start: string, end: string, settings: SchedulingSettings) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  const lunchStart = timeToMinutes(settings.lunchStart);
  const lunchEnd = timeToMinutes(settings.lunchEnd);
  const dayEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  if (startMinutes < 12 * 60) return endMinutes <= lunchStart - settings.routeMarginMinutes;
  return startMinutes >= lunchEnd && endMinutes <= dayEnd;
}

function routeRemainsCompatible(jobs: DispatchJob[], movedSupport: DispatchJob) {
  const segment: HalfDay = timeToMinutes(movedSupport.start) < 12 * 60 ? 'am' : 'pm';
  const routeJobs = jobs
    .filter((job) => job.vanId === movedSupport.vanId && job.status !== 'cancelled')
    .filter((job) => job.segment === segment || job.segment === 'full_day')
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));
  const anchor = routeJobs[0];
  if (!anchor) return true;
  return routeJobs.every((job) => sectorsCompatible(anchor.sector, job.sector));
}

export function findSupportReflowPlansForDay(
  day: OperationalDay,
  request: BookingRequest,
  jobs: DispatchJob[],
  vans: VanResource[] = previewVans,
  settings: SchedulingSettings = getRuntimeSchedulingSettings(),
): SupportReflowPlan[] {
  if (!day.isOpen || day.weekday === 'Sat') return [];
  if (findCandidateSlotsForDay(day, request, jobs, vans, settings).length) return [];

  const supportJobs = jobs.filter((job) => job.status !== 'cancelled' && !job.isPrimaryAssignment && Boolean(job.supportForJobId));
  const plans: SupportReflowPlan[] = [];
  const requestDuration = calculateDurationMinutes(request, settings);

  for (const supportJob of supportJobs) {
    const primaryJob = jobs.find((job) => job.id === supportJob.supportForJobId && job.status !== 'cancelled');
    if (!primaryJob) continue;
    const supportMinutes = timeToMinutes(supportJob.end) - timeToMinutes(supportJob.start);
    if (supportMinutes <= 0) continue;

    const withoutSupport = jobs.filter((job) => job.id !== supportJob.id);
    for (const alternateStart of settings.serviceStartTimes) {
      if (alternateStart === supportJob.start) continue;
      const alternateEnd = minutesToTime(timeToMinutes(alternateStart) + supportMinutes);
      if (!weekdayWorkingWindowAllows(alternateStart, alternateEnd, settings)) continue;
      if (timeToMinutes(alternateStart) < timeToMinutes(primaryJob.start) || timeToMinutes(alternateEnd) > timeToMinutes(primaryJob.end)) continue;
      if (conflictsWithSpan(withoutSupport, supportJob.vanId, alternateStart, alternateEnd)) continue;

      const toSegment: HalfDay = timeToMinutes(alternateStart) < 12 * 60 ? 'am' : 'pm';
      const movedSupport: DispatchJob = { ...supportJob, start: alternateStart, end: alternateEnd, segment: toSegment };
      const simulatedJobs = [...withoutSupport, movedSupport];
      if (!routeRemainsCompatible(simulatedJobs, movedSupport)) continue;

      const recoveredCandidates = findCandidateSlotsForDay(day, request, simulatedJobs, vans, settings)
        .filter((slot) => slot.vanId === supportJob.vanId || slot.supportVanId === supportJob.vanId);
      if (!recoveredCandidates.length) continue;
      const unlockedSlot = recoveredCandidates.sort((a, b) => b.score - a.score || timeToMinutes(a.start) - timeToMinutes(b.start))[0];
      const moveDistance = Math.abs(timeToMinutes(alternateStart) - timeToMinutes(supportJob.start));
      const score = unlockedSlot.score + 35 - Math.round(moveDistance / 30);

      plans.push({
        id: `${supportJob.id}:${alternateStart}:${unlockedSlot.vanId}:${unlockedSlot.start}`,
        supportJobId: supportJob.id,
        vanId: supportJob.vanId,
        customer: supportJob.customer,
        sector: supportJob.sector,
        quantity: supportJob.quantity,
        fromStart: supportJob.start,
        fromEnd: supportJob.end,
        toStart: alternateStart,
        toEnd: alternateEnd,
        toSegment,
        unlockedSlot,
        score,
        reasons: [
          `Move support-only work for ${supportJob.customer} without changing its primary appointment`,
          `Recover ${requestDuration} continuous minutes for the new request on ${unlockedSlot.vanId.replace('VAN-', 'Van ')}`,
          `New request becomes valid at ${unlockedSlot.start}–${unlockedSlot.end}`,
          'Customer communication ownership remains with the primary van',
        ],
      });
    }
  }

  const unique = new Map<string, SupportReflowPlan>();
  for (const plan of plans.sort((a, b) => b.score - a.score)) {
    const key = `${plan.supportJobId}:${plan.toStart}:${plan.unlockedSlot.vanId}:${plan.unlockedSlot.start}`;
    if (!unique.has(key)) unique.set(key, plan);
  }
  return [...unique.values()].slice(0, 6);
}

export function weekCapacity(jobs: CalendarDispatchJob[], week: OperationalDay[]) {
  return week.map((day) => {
    const dayJobs = jobs.filter((job) => job.dateKey === day.dateKey && job.status !== 'cancelled');
    const occupiedVans = new Set(dayJobs.map((job) => job.vanId)).size;
    const blocked = dayJobs.filter((job) => job.readiness === 'blocked').length;
    return { dateKey: day.dateKey, jobs: dayJobs.length, occupiedVans, blocked, isOpen: day.isOpen };
  });
}
