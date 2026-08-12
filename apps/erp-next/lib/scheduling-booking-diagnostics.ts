import type { BookingRequest, CandidateSlot, DispatchJob, SchedulingSettings } from './scheduling';
import {
  calculateDurationMinutes,
  getHalfDayAnchor,
  getRuntimeSchedulingSettings,
  halfDayForTime,
  isStandardServiceOnly,
  sectorsCompatible,
  standardServiceQuantity,
  timeToMinutes,
} from './scheduling';

export type BookingIssueField = 'property' | 'quantity' | 'slot' | 'support';
export type BookingIssueSeverity = 'error' | 'warning' | 'info';

export type BookingLiveIssue = {
  code: string;
  field: BookingIssueField;
  severity: BookingIssueSeverity;
  title: string;
  message: string;
};

type PreferredBookingSpot = {
  vanId?: string;
  start?: string;
};

function restrictionAllows(start: string, request: BookingRequest) {
  const restriction = request.restriction;
  if (!restriction) return true;
  if (restriction.halfDay && halfDayForTime(start) !== restriction.halfDay) return false;
  if (restriction.notBefore && timeToMinutes(start) < timeToMinutes(restriction.notBefore)) return false;
  if (restriction.notAfter && timeToMinutes(start) > timeToMinutes(restriction.notAfter)) return false;
  return true;
}

function overlaps(start: number, end: number, job: DispatchJob) {
  if (job.status === 'cancelled') return false;
  const jobStart = timeToMinutes(job.start);
  const jobEnd = timeToMinutes(job.end);
  return start < jobEnd && end > jobStart;
}

function fitsWorkingWindow(start: number, end: number, settings: SchedulingSettings) {
  const lunchStart = timeToMinutes(settings.lunchStart);
  const lunchEnd = timeToMinutes(settings.lunchEnd);
  const dayEnd = timeToMinutes(settings.workdayEnd) - settings.routeMarginMinutes;
  if (start < 12 * 60) return end <= lunchStart - settings.routeMarginMinutes;
  return start >= lunchEnd && end <= dayEnd;
}

export function diagnoseBookingRequest(args: {
  request: BookingRequest;
  jobs: DispatchJob[];
  preferred: PreferredBookingSpot;
  candidateSlots: CandidateSlot[];
  quantityValid: boolean;
  settings?: SchedulingSettings;
}): BookingLiveIssue[] {
  const settings = args.settings ?? getRuntimeSchedulingSettings();
  const issues: BookingLiveIssue[] = [];

  if (!args.quantityValid) {
    issues.push({
      code: 'quantity-invalid',
      field: 'quantity',
      severity: 'error',
      title: 'Review appointment work scope',
      message: 'Every work line needs a valid whole-number quantity before the ERP can calculate continuous capacity.',
    });
    return issues;
  }

  const requestedStandardUnits = standardServiceQuantity(args.request);
  const supportRequired = isStandardServiceOnly(args.request)
    && requestedStandardUnits > settings.maxStandardUnitsSameSiteSingleVan;

  if (supportRequired) {
    const linkedPlan = args.candidateSlots.find((slot) => slot.requiresSupportVan && slot.supportVanId);
    if (linkedPlan) {
      issues.push({
        code: 'support-auto-selected',
        field: 'support',
        severity: 'info',
        title: 'Support van required',
        message: `${requestedStandardUnits} A/C units exceed the single-van same-property capacity of ${settings.maxStandardUnitsSameSiteSingleVan}. ERP will link ${linkedPlan.vanId.replace('VAN-', 'Van ')} + ${linkedPlan.supportVanId?.replace('VAN-', 'Van ')} automatically (${linkedPlan.primaryUnits ?? 0} + ${linkedPlan.supportUnits ?? 0} units) while keeping one customer appointment and one communication owner.`,
      });
    } else {
      issues.push({
        code: 'support-unavailable',
        field: 'support',
        severity: 'error',
        title: 'Support van required but unavailable',
        message: `${requestedStandardUnits} A/C units exceed the single-van capacity of ${settings.maxStandardUnitsSameSiteSingleVan}. No valid linked support-van plan is available under the current day, capacity and customer restrictions.`,
      });
    }
  }

  const { vanId, start } = args.preferred;
  if (!vanId || !start) return issues;

  const segment = halfDayForTime(start);
  const anchor = getHalfDayAnchor(args.jobs, vanId, segment);
  if (anchor && !sectorsCompatible(anchor.sector, args.request.sector)) {
    issues.push({
      code: 'route-anchor-conflict',
      field: 'property',
      severity: 'error',
      title: 'Route conflict for this work spot',
      message: `${vanId.replace('VAN-', 'Van ')} ${segment === 'am' ? 'morning' : 'afternoon'} anchor is ${anchor.sector}. ${args.request.sector} is too far outside the compatible ${segment === 'am' ? 'morning' : 'afternoon'} route for the selected ${start} spot. Choose a route-compatible property/sector or another ERP option.`,
    });
  }

  if (!restrictionAllows(start, args.request)) {
    issues.push({
      code: 'customer-time-restriction',
      field: 'slot',
      severity: 'error',
      title: 'Customer time restriction conflict',
      message: `The selected ${start} work spot does not satisfy the customer's current time restriction.`,
    });
  }

  if (supportRequired) {
    const exactLinkedPlan = args.candidateSlots.find((slot) => slot.requiresSupportVan && slot.vanId === vanId && slot.start === start);
    if (!exactLinkedPlan && !issues.some((issue) => issue.code === 'support-unavailable')) {
      issues.push({
        code: 'preferred-spot-needs-linked-support',
        field: 'slot',
        severity: 'warning',
        title: 'Selected spot cannot carry this large job alone',
        message: `This ${requestedStandardUnits}-unit job requires linked support capacity. Use one of the calculated van combinations shown below instead of forcing the selected single-van spot.`,
      });
    }
    return issues;
  }

  const duration = calculateDurationMinutes(args.request, settings);
  const startMinutes = timeToMinutes(start);
  const endMinutes = startMinutes + duration;
  if (!fitsWorkingWindow(startMinutes, endMinutes, settings)) {
    issues.push({
      code: 'duration-window-conflict',
      field: 'slot',
      severity: 'error',
      title: 'Not enough continuous time in this work period',
      message: `The selected ${start} spot cannot fit the required ${duration} minutes while preserving lunch, route margin and the end-of-day return buffer.`,
    });
  }

  const vanJobs = args.jobs.filter((job) => job.vanId === vanId && job.status !== 'cancelled');
  if (vanJobs.some((job) => overlaps(startMinutes, endMinutes, job))) {
    issues.push({
      code: 'capacity-overlap',
      field: 'slot',
      severity: 'error',
      title: 'Van capacity conflict',
      message: `${vanId.replace('VAN-', 'Van ')} already has work overlapping the time required by this request.`,
    });
  }

  const exactCandidate = args.candidateSlots.some((slot) => slot.vanId === vanId && slot.start === start);
  if (!exactCandidate && !issues.some((issue) => issue.severity === 'error')) {
    issues.push({
      code: 'preferred-spot-not-valid',
      field: 'slot',
      severity: 'warning',
      title: 'Selected visual spot is not a valid ERP option',
      message: 'The spot you clicked cannot be used with the current route, duration, restriction or capacity state. Choose one of the valid ERP options shown below.',
    });
  }

  return issues;
}
