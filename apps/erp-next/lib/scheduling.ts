export type HalfDay = 'am' | 'pm';
export type DaySegment = HalfDay | 'full_day';
export type BookingStatus = 'available' | 'temporary_hold' | 'confirmed' | 'cancelled' | 'rescheduled';
export type ReadinessStatus = 'ready' | 'at_risk' | 'blocked' | 'not_checked';

export type WorkPresetId =
  | 'standard_service'
  | 'deep_cleaning'
  | 'diagnostic'
  | 'repair'
  | 'installation_standard'
  | 'installation_extended'
  | 'installation_rooftop'
  | 'installation_second_floor'
  | 'installation_third_floor'
  | 'anti_corrosive'
  | 'other';

export type WorkPreset = {
  id: WorkPresetId;
  label: string;
  defaultMinutes: number;
  perUnit: boolean;
  customerDescriptionTemplate: string;
};

export type BookingWorkLine = {
  id: string;
  presetId: WorkPresetId;
  quantity: number;
  customerFacingDescription?: string;
  technicianInstructions?: string;
};

export type SchedulingSettings = {
  timezone: 'America/Aruba';
  officeSector: string;
  workdayStart: string;
  workdayEnd: string;
  lunchStart: string;
  lunchEnd: string;
  serviceStartTimes: string[];
  maxStandardUnitsDifferentSitesPerVan: number;
  maxStandardUnitsSameSiteSingleVan: number;
  maxStandardUnitsPerVanWhenSupport: number;
  routeMarginMinutes: number;
  presetMinutes: Partial<Record<WorkPresetId, number>>;
};

export type SchedulingRuntimeOverrides = {
  routeMarginMinutes?: number;
  presetMinutes?: Partial<Record<WorkPresetId, number>>;
};

export type VanResource = {
  id: string;
  name: string;
  team: string;
  active: boolean;
  skills: string[];
};

export type DispatchJob = {
  id: string;
  customer: string;
  site: string;
  sector: string;
  start: string;
  end: string;
  segment: DaySegment;
  vanId: string;
  presetId: WorkPresetId;
  quantity: number;
  status: Exclude<BookingStatus, 'available'>;
  readiness: ReadinessStatus;
  isPrimaryAssignment: boolean;
  customerCommunicationOwner: boolean;
  supportForJobId?: string;
};

export type BookingRestriction = {
  halfDay?: HalfDay;
  notBefore?: string;
  notAfter?: string;
};

export type BookingRequest = {
  customer: string;
  site: string;
  sector: string;
  presetId: WorkPresetId;
  quantity: number;
  workLines?: BookingWorkLine[];
  restriction?: BookingRestriction;
};

export type CandidateSlot = {
  vanId: string;
  start: string;
  end: string;
  segment: DaySegment;
  sector: string;
  score: number;
  reasons: string[];
  requiresSupportVan: boolean;
  supportVanId?: string;
  primaryUnits?: number;
  supportUnits?: number;
  supportStart?: string;
  supportEnd?: string;
  supportSegment?: DaySegment;
};

export const defaultSchedulingSettings: SchedulingSettings = {
  timezone: 'America/Aruba',
  officeSector: 'Santa Cruz',
  workdayStart: '08:00',
  workdayEnd: '17:00',
  lunchStart: '12:00',
  lunchEnd: '13:00',
  serviceStartTimes: ['08:30', '09:30', '10:30', '13:30', '14:30', '15:30'],
  maxStandardUnitsDifferentSitesPerVan: 6,
  maxStandardUnitsSameSiteSingleVan: 7,
  maxStandardUnitsPerVanWhenSupport: 7,
  routeMarginMinutes: 30,
  presetMinutes: {},
};

export const defaultWorkPresets: WorkPreset[] = [
  { id: 'standard_service', label: 'Standard service', defaultMinutes: 60, perUnit: true, customerDescriptionTemplate: 'Standard service — {quantity} A/C unit(s)' },
  { id: 'deep_cleaning', label: 'Deep cleaning', defaultMinutes: 120, perUnit: true, customerDescriptionTemplate: 'Deep cleaning — {quantity} A/C unit(s)' },
  { id: 'diagnostic', label: 'Diagnostic / checkup', defaultMinutes: 45, perUnit: false, customerDescriptionTemplate: 'A/C diagnostic / checkup' },
  { id: 'repair', label: 'Repair', defaultMinutes: 90, perUnit: false, customerDescriptionTemplate: 'A/C repair visit' },
  { id: 'installation_standard', label: 'Standard installation', defaultMinutes: 150, perUnit: true, customerDescriptionTemplate: 'Standard A/C installation — {quantity} unit(s)' },
  { id: 'installation_extended', label: 'Extended installation', defaultMinutes: 210, perUnit: true, customerDescriptionTemplate: 'Extended A/C installation — {quantity} unit(s)' },
  { id: 'installation_rooftop', label: 'Rooftop installation', defaultMinutes: 240, perUnit: true, customerDescriptionTemplate: 'Rooftop A/C installation — {quantity} unit(s)' },
  { id: 'installation_second_floor', label: 'Second-floor installation', defaultMinutes: 180, perUnit: true, customerDescriptionTemplate: 'Second-floor A/C installation — {quantity} unit(s)' },
  { id: 'installation_third_floor', label: 'Third-floor installation', defaultMinutes: 210, perUnit: true, customerDescriptionTemplate: 'Third-floor A/C installation — {quantity} unit(s)' },
  { id: 'anti_corrosive', label: 'Anti-corrosive treatment', defaultMinutes: 60, perUnit: true, customerDescriptionTemplate: 'Anti-corrosive treatment — {quantity} unit(s)' },
  { id: 'other', label: 'Other work', defaultMinutes: 60, perUnit: false, customerDescriptionTemplate: 'A/C service visit' },
];

export const previewSectorCompatibility: Record<string, string[]> = {
  Noord: ['Noord', 'Palm Beach', 'Malmok', 'Oranjestad'],
  'Palm Beach': ['Palm Beach', 'Noord', 'Malmok', 'Oranjestad'],
  Oranjestad: ['Oranjestad', 'Noord', 'Palm Beach', 'Santa Cruz'],
  'Santa Cruz': ['Santa Cruz', 'Oranjestad', 'Paradera', 'San Nicolas'],
  Paradera: ['Paradera', 'Santa Cruz', 'Oranjestad'],
  'San Nicolas': ['San Nicolas', 'Santa Cruz', 'Savaneta'],
  Savaneta: ['Savaneta', 'San Nicolas', 'Santa Cruz'],
};

let runtimeSchedulingSettings: SchedulingSettings = {
  ...defaultSchedulingSettings,
  serviceStartTimes: [...defaultSchedulingSettings.serviceStartTimes],
  presetMinutes: { ...defaultSchedulingSettings.presetMinutes },
};

export function configureSchedulingRuntime(overrides: SchedulingRuntimeOverrides) {
  runtimeSchedulingSettings = {
    ...runtimeSchedulingSettings,
    ...(overrides.routeMarginMinutes !== undefined ? { routeMarginMinutes: Math.max(0, overrides.routeMarginMinutes) } : {}),
    presetMinutes: {
      ...runtimeSchedulingSettings.presetMinutes,
      ...(overrides.presetMinutes ?? {}),
    },
  };
  return getRuntimeSchedulingSettings();
}

export function resetSchedulingRuntime() {
  runtimeSchedulingSettings = {
    ...defaultSchedulingSettings,
    serviceStartTimes: [...defaultSchedulingSettings.serviceStartTimes],
    presetMinutes: { ...defaultSchedulingSettings.presetMinutes },
  };
  return getRuntimeSchedulingSettings();
}

export function getRuntimeSchedulingSettings(): SchedulingSettings {
  return {
    ...runtimeSchedulingSettings,
    serviceStartTimes: [...runtimeSchedulingSettings.serviceStartTimes],
    presetMinutes: { ...runtimeSchedulingSettings.presetMinutes },
  };
}

export function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function halfDayForTime(value: string): HalfDay {
  return timeToMinutes(value) < 12 * 60 ? 'am' : 'pm';
}

function segmentForSpan(start: string, end: string): DaySegment {
  return timeToMinutes(start) < 12 * 60 && timeToMinutes(end) > 13 * 60 ? 'full_day' : halfDayForTime(start);
}

export function getPreset(presetId: WorkPresetId) {
  return defaultWorkPresets.find((preset) => preset.id === presetId) ?? defaultWorkPresets[defaultWorkPresets.length - 1];
}

export function getPresetDurationMinutes(presetId: WorkPresetId, settings: SchedulingSettings = getRuntimeSchedulingSettings()) {
  const configured = settings.presetMinutes[presetId];
  if (configured !== undefined && Number.isFinite(configured) && configured > 0) return configured;
  return getPreset(presetId).defaultMinutes;
}

function singleWorkDuration(request: Pick<BookingWorkLine, 'presetId' | 'quantity'>, settings: SchedulingSettings) {
  const preset = getPreset(request.presetId);
  const baseMinutes = getPresetDurationMinutes(request.presetId, settings);
  return baseMinutes * (preset.perUnit ? Math.max(1, request.quantity) : 1);
}

export function calculateDurationMinutes(request: Pick<BookingRequest, 'presetId' | 'quantity' | 'workLines'>, settings: SchedulingSettings = getRuntimeSchedulingSettings()) {
  if (request.workLines?.length) {
    return request.workLines.reduce((total, line) => total + singleWorkDuration(line, settings), 0);
  }
  return singleWorkDuration(request, settings);
}

function singleCustomerFacingDescription(request: Pick<BookingWorkLine, 'presetId' | 'quantity'>) {
  return getPreset(request.presetId).customerDescriptionTemplate.replace('{quantity}', String(Math.max(1, request.quantity)));
}

export function customerFacingDescription(request: Pick<BookingRequest, 'presetId' | 'quantity' | 'workLines'>) {
  if (request.workLines?.length) {
    return request.workLines.map((line) => line.customerFacingDescription?.trim() || singleCustomerFacingDescription(line)).join(' + ');
  }
  return singleCustomerFacingDescription(request);
}

export function isStandardServiceOnly(request: Pick<BookingRequest, 'presetId' | 'quantity' | 'workLines'>) {
  if (!request.workLines?.length) return request.presetId === 'standard_service';
  return request.workLines.every((line) => line.presetId === 'standard_service');
}

export function standardServiceQuantity(request: Pick<BookingRequest, 'quantity' | 'workLines'>) {
  if (!request.workLines?.length) return request.quantity;
  return request.workLines.reduce((sum, line) => sum + line.quantity, 0);
}

export function sectorsCompatible(anchorSector: string | undefined, candidateSector: string) {
  if (!anchorSector) return true;
  return (previewSectorCompatibility[anchorSector] ?? [anchorSector]).includes(candidateSector);
}

export function getHalfDayAnchor(jobs: DispatchJob[], vanId: string, halfDay: HalfDay) {
  return jobs
    .filter((job) => job.vanId === vanId && (job.segment === halfDay || job.segment === 'full_day') && job.status !== 'cancelled')
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start))[0];
}

function overlaps(start: number, end: number, job: DispatchJob) {
  const jobStart = timeToMinutes(job.start);
  const jobEnd = timeToMinutes(job.end);
  return start < jobEnd && end > jobStart;
}

function restrictionAllows(start: string, restriction?: BookingRestriction) {
  if (!restriction) return true;
  if (restriction.halfDay && halfDayForTime(start) !== restriction.halfDay) return false;
  if (restriction.notBefore && timeToMinutes(start) < timeToMinutes(restriction.notBefore)) return false;
  if (restriction.notAfter && timeToMinutes(start) > timeToMinutes(restriction.notAfter)) return false;
  return true;
}

/** Lunch is protected by the absence of sellable starts during lunch, not by extending work duration. */
function fitsWorkingWindow(start: number, end: number, settings: SchedulingSettings) {
  const dayStart = timeToMinutes(settings.workdayStart);
  const dayEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  return start >= dayStart && end <= dayEnd;
}

function scoreCandidate(args: { anchor?: DispatchJob; candidateSector: string; start: string; existingCount: number; isFirstJob: boolean }) {
  let score = 100;
  const reasons: string[] = [];
  if (args.anchor) {
    if (args.anchor.sector === args.candidateSector) {
      score += 20;
      reasons.push('Same sector as half-day anchor');
    } else {
      score += 8;
      reasons.push('Adjacent / route-compatible sector');
    }
  } else if (args.isFirstJob) {
    score += 12;
    reasons.push('Establishes the half-day geographic anchor');
  }
  score -= args.existingCount * 4;
  if (args.start === '08:30' || args.start === '13:30') reasons.push('Anchor-quality start time');
  return { score, reasons };
}

function vanFreeForFullDay(vanId: string, jobs: DispatchJob[]) {
  return !jobs.some((job) => job.vanId === vanId && job.status !== 'cancelled');
}

function spanIsFree(vanId: string, start: string, end: string, jobs: DispatchJob[]) {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return !jobs.some((job) => job.vanId === vanId && job.status !== 'cancelled' && overlaps(startMinutes, endMinutes, job));
}

function workingEndAfter(start: string, workMinutes: number, _settings: SchedulingSettings) {
  return minutesToTime(timeToMinutes(start) + Math.max(0, workMinutes));
}

function findSupportPlan(request: BookingRequest, jobs: DispatchJob[], vans: readonly VanResource[], settings: SchedulingSettings): CandidateSlot[] {
  if (!isStandardServiceOnly(request)) return [];
  const requestedUnits = standardServiceQuantity(request);
  const primaryCapacity = settings.maxStandardUnitsSameSiteSingleVan;
  const supportCapacity = settings.maxStandardUnitsPerVanWhenSupport;
  if (requestedUnits <= primaryCapacity || requestedUnits > primaryCapacity + supportCapacity) return [];
  if (request.restriction?.halfDay === 'pm' || request.restriction?.notBefore && timeToMinutes(request.restriction.notBefore) > timeToMinutes('08:30')) return [];

  const serviceMinutes = getPresetDurationMinutes('standard_service', settings);
  const primaryUnits = primaryCapacity;
  const supportUnits = requestedUnits - primaryUnits;
  const primaryStart = '08:30';
  const primaryEnd = workingEndAfter(primaryStart, primaryUnits * serviceMinutes, settings);
  const latestEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  if (timeToMinutes(primaryEnd) > latestEnd) return [];

  const primaryVans = vans.filter((van) => van.active && vanFreeForFullDay(van.id, jobs));
  const results: CandidateSlot[] = [];

  for (const primaryVan of primaryVans) {
    for (const supportVan of vans.filter((van) => van.active && van.id !== primaryVan.id)) {
      if (supportUnits <= 3) {
        for (const supportStart of ['08:30', '13:30']) {
          const supportEnd = minutesToTime(timeToMinutes(supportStart) + supportUnits * serviceMinutes);
          const startMinutes = timeToMinutes(supportStart);
          const endMinutes = timeToMinutes(supportEnd);
          if (!fitsWorkingWindow(startMinutes, endMinutes, settings)) continue;
          if (!spanIsFree(supportVan.id, supportStart, supportEnd, jobs)) continue;
          const supportSegment = segmentForSpan(supportStart, supportEnd);
          const supportAnchor = getHalfDayAnchor(jobs, supportVan.id, supportSegment === 'full_day' ? halfDayForTime(supportStart) : supportSegment);
          if (!sectorsCompatible(supportAnchor?.sector, request.sector)) continue;
          const score = 150
            + (supportAnchor?.sector === request.sector ? 8 : supportAnchor ? 2 : 5)
            - results.length;
          results.push({
            vanId: primaryVan.id,
            supportVanId: supportVan.id,
            start: primaryStart,
            end: primaryEnd,
            segment: 'full_day',
            sector: request.sector,
            score,
            reasons: [
              `${primaryUnits} units assigned to the primary full-day van`,
              `${supportUnits} remaining unit${supportUnits === 1 ? '' : 's'} assigned to a compatible ${supportSegment === 'am' ? 'morning' : supportSegment === 'pm' ? 'afternoon' : 'cross-lunch'} support block`,
              'Single customer appointment and communication owner',
            ],
            requiresSupportVan: true,
            primaryUnits,
            supportUnits,
            supportStart,
            supportEnd,
            supportSegment,
          });
        }
        continue;
      }

      if (!vanFreeForFullDay(supportVan.id, jobs)) continue;
      const supportStart = '08:30';
      const supportEnd = workingEndAfter(supportStart, supportUnits * serviceMinutes, settings);
      if (timeToMinutes(supportEnd) > latestEnd) continue;
      results.push({
        vanId: primaryVan.id,
        supportVanId: supportVan.id,
        start: primaryStart,
        end: primaryEnd,
        segment: 'full_day',
        sector: request.sector,
        score: 145 - results.length,
        reasons: [
          `${primaryUnits} units assigned to the primary full-day van`,
          `${supportUnits} units require a second full-day linked van`,
          'Single customer appointment and communication owner',
        ],
        requiresSupportVan: true,
        primaryUnits,
        supportUnits,
        supportStart,
        supportEnd,
        supportSegment: 'full_day',
      });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, 6);
}

/** @deprecated Acceptance simulator only. Production must use Office Booking Authority. */
export function findCandidateSlots(request: BookingRequest, jobs: DispatchJob[], vans: readonly VanResource[], settings: SchedulingSettings = getRuntimeSchedulingSettings()): CandidateSlot[] {
  const supportPlans = findSupportPlan(request, jobs, vans, settings);
  if (supportPlans.length) return supportPlans;

  const duration = calculateDurationMinutes(request, settings);
  const candidates: CandidateSlot[] = [];

  for (const van of vans.filter((resource) => resource.active)) {
    for (const start of settings.serviceStartTimes) {
      if (!restrictionAllows(start, request.restriction)) continue;
      const startMinutes = timeToMinutes(start);
      const endMinutes = startMinutes + duration;
      if (!fitsWorkingWindow(startMinutes, endMinutes, settings)) continue;
      const end = minutesToTime(endMinutes);
      const segment = segmentForSpan(start, end);
      const vanJobs = jobs.filter((job) => job.vanId === van.id && job.status !== 'cancelled');
      if (vanJobs.some((job) => overlaps(startMinutes, endMinutes, job))) continue;

      const anchorHalfDay = segment === 'full_day' ? halfDayForTime(start) : segment;
      const anchor = getHalfDayAnchor(jobs, van.id, anchorHalfDay);
      if (!sectorsCompatible(anchor?.sector, request.sector)) continue;

      const scored = scoreCandidate({ anchor, candidateSector: request.sector, start, existingCount: vanJobs.length, isFirstJob: !anchor });
      candidates.push({ vanId: van.id, start, end, segment, sector: request.sector, score: scored.score, reasons: scored.reasons, requiresSupportVan: false, primaryUnits: request.quantity });
    }
  }

  return candidates.sort((a, b) => b.score - a.score || timeToMinutes(a.start) - timeToMinutes(b.start)).slice(0, 8);
}

export type ReadinessInput = {
  crewAssigned: boolean;
  requiredSkillAvailable: boolean;
  vanAssigned: boolean;
  routeCompatible: boolean;
  requiredToolsReady: boolean;
  requiredPartsReady: boolean;
  customerConfirmed: boolean;
  commercialClearance: boolean;
  accessConfirmed: boolean;
};

export function evaluateReadiness(input: ReadinessInput): { status: ReadinessStatus; blockers: string[]; warnings: string[] } {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!input.crewAssigned) blockers.push('Crew not assigned');
  if (!input.requiredSkillAvailable) blockers.push('Required skill not available');
  if (!input.vanAssigned) blockers.push('Van not assigned');
  if (!input.routeCompatible) blockers.push('Route / sector conflict');
  if (!input.requiredToolsReady) blockers.push('Required tools not ready');
  if (!input.requiredPartsReady) blockers.push('Required parts or equipment not ready');
  if (!input.commercialClearance) blockers.push('Deposit / PO / commercial clearance missing');
  if (!input.customerConfirmed) warnings.push('Customer confirmation pending');
  if (!input.accessConfirmed) warnings.push('Site access not confirmed');
  return { status: blockers.length ? 'blocked' : warnings.length ? 'at_risk' : 'ready', blockers, warnings };
}
