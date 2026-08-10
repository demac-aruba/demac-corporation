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
  maxStandardUnitsPerVanWhenSupport: 6,
  routeMarginMinutes: 30,
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

export const previewVans: VanResource[] = [
  { id: 'VAN-1', name: 'Van 1', team: 'Team 1', active: true, skills: ['service', 'repair', 'installation'] },
  { id: 'VAN-2', name: 'Van 2', team: 'Team 2', active: true, skills: ['service', 'repair', 'installation'] },
  { id: 'VAN-3', name: 'Van 3', team: 'Team 3', active: true, skills: ['service', 'repair', 'installation', 'commercial'] },
  { id: 'VAN-4', name: 'Van 4', team: 'Team 4', active: true, skills: ['service', 'diagnostic', 'repair'] },
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

export function getPreset(presetId: WorkPresetId) {
  return defaultWorkPresets.find((preset) => preset.id === presetId) ?? defaultWorkPresets[defaultWorkPresets.length - 1];
}

export function calculateDurationMinutes(request: Pick<BookingRequest, 'presetId' | 'quantity'>) {
  const preset = getPreset(request.presetId);
  return preset.defaultMinutes * (preset.perUnit ? Math.max(1, request.quantity) : 1);
}

export function customerFacingDescription(request: Pick<BookingRequest, 'presetId' | 'quantity'>) {
  return getPreset(request.presetId).customerDescriptionTemplate.replace('{quantity}', String(Math.max(1, request.quantity)));
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

function fitsWorkingWindow(start: number, end: number, settings: SchedulingSettings) {
  const lunchStart = timeToMinutes(settings.lunchStart);
  const lunchEnd = timeToMinutes(settings.lunchEnd);
  const dayEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  if (start < 12 * 60) return end <= lunchStart - settings.routeMarginMinutes;
  return start >= lunchEnd && end <= dayEnd;
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

function findSupportPlan(request: BookingRequest, jobs: DispatchJob[], vans: VanResource[], settings: SchedulingSettings): CandidateSlot[] {
  if (request.presetId !== 'standard_service') return [];
  const capacity = settings.maxStandardUnitsPerVanWhenSupport;
  if (request.quantity <= settings.maxStandardUnitsSameSiteSingleVan || request.quantity > capacity * 2) return [];
  if (request.restriction?.halfDay === 'pm' || request.restriction?.notBefore && timeToMinutes(request.restriction.notBefore) > timeToMinutes('08:30')) return [];

  const available = vans.filter((van) => van.active && vanFreeForFullDay(van.id, jobs));
  if (available.length < 2) return [];
  const primaryUnits = Math.min(capacity, request.quantity);
  const supportUnits = request.quantity - primaryUnits;
  const results: CandidateSlot[] = [];

  for (let i = 0; i < available.length; i += 1) {
    for (let j = i + 1; j < available.length; j += 1) {
      results.push({
        vanId: available[i].id,
        supportVanId: available[j].id,
        start: '08:30',
        end: '16:30',
        segment: 'full_day',
        sector: request.sector,
        score: 140 - i * 4 - j * 2,
        reasons: ['Large same-site job split across two linked vans', 'Single customer appointment and communication owner', 'No duplicate confirmation or reminder from support assignment'],
        requiresSupportVan: true,
        primaryUnits,
        supportUnits,
      });
    }
  }
  return results.slice(0, 3);
}

export function findCandidateSlots(request: BookingRequest, jobs: DispatchJob[], vans: VanResource[] = previewVans, settings: SchedulingSettings = defaultSchedulingSettings): CandidateSlot[] {
  const supportPlans = findSupportPlan(request, jobs, vans, settings);
  if (supportPlans.length) return supportPlans;

  const duration = calculateDurationMinutes(request);
  const candidates: CandidateSlot[] = [];

  for (const van of vans.filter((resource) => resource.active)) {
    for (const start of settings.serviceStartTimes) {
      if (!restrictionAllows(start, request.restriction)) continue;
      const startMinutes = timeToMinutes(start);
      const endMinutes = startMinutes + duration;
      if (!fitsWorkingWindow(startMinutes, endMinutes, settings)) continue;
      const segment = halfDayForTime(start);
      const vanJobs = jobs.filter((job) => job.vanId === van.id && job.status !== 'cancelled');
      if (vanJobs.some((job) => overlaps(startMinutes, endMinutes, job))) continue;

      const anchor = getHalfDayAnchor(jobs, van.id, segment);
      if (!sectorsCompatible(anchor?.sector, request.sector)) continue;

      const scored = scoreCandidate({ anchor, candidateSector: request.sector, start, existingCount: vanJobs.length, isFirstJob: !anchor });
      candidates.push({ vanId: van.id, start, end: minutesToTime(endMinutes), segment, sector: request.sector, score: scored.score, reasons: scored.reasons, requiresSupportVan: false, primaryUnits: request.quantity });
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
