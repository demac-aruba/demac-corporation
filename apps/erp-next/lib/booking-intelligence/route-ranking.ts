import type { BookingRequest, CandidateSlot, DispatchJob, HalfDay } from '../scheduling';
import { halfDayForTime, previewSectorCompatibility, timeToMinutes } from '../scheduling';

const sectorGraph: Record<string, string[]> = {
  Noord: ['Palm Beach', 'Oranjestad'],
  'Palm Beach': ['Noord', 'Oranjestad'],
  Oranjestad: ['Palm Beach', 'Noord', 'Santa Cruz', 'Paradera'],
  'Santa Cruz': ['Oranjestad', 'Paradera', 'Savaneta', 'San Nicolas'],
  Paradera: ['Oranjestad', 'Santa Cruz'],
  Savaneta: ['Santa Cruz', 'San Nicolas'],
  'San Nicolas': ['Santa Cruz', 'Savaneta'],
};

function graphDistance(from: string, to: string) {
  if (!from || !to) return 3;
  if (from === to) return 0;
  const seen = new Set([from]);
  let frontier = [from];
  for (let distance = 1; distance <= 6; distance += 1) {
    const next = frontier.flatMap((sector) => sectorGraph[sector] ?? []);
    if (next.includes(to)) return distance;
    frontier = next.filter((sector) => !seen.has(sector));
    frontier.forEach((sector) => seen.add(sector));
    if (!frontier.length) break;
  }
  return 4;
}

function jobsInHalfDay(jobs: DispatchJob[], vanId: string, halfDay: HalfDay) {
  return jobs
    .filter((job) => job.vanId === vanId && job.status !== 'cancelled' && (job.segment === halfDay || job.segment === 'full_day'))
    .sort((left, right) => timeToMinutes(left.start) - timeToMinutes(right.start));
}

export function routeScoreForCandidate(args: {
  slot: CandidateSlot;
  request: BookingRequest;
  jobs: DispatchJob[];
  officeSector?: string;
}) {
  const officeSector = args.officeSector ?? 'Santa Cruz';
  const halfDay = halfDayForTime(args.slot.start);
  const routeJobs = jobsInHalfDay(args.jobs, args.slot.vanId, halfDay);
  const start = timeToMinutes(args.slot.start);
  const previous = [...routeJobs].reverse().find((job) => timeToMinutes(job.end) <= start);
  const next = routeJobs.find((job) => timeToMinutes(job.start) >= timeToMinutes(args.slot.end));
  const anchor = routeJobs[0];
  let delta = 0;
  const reasons: string[] = [];

  if (previous?.sector === args.request.sector || next?.sector === args.request.sector) {
    delta += 28;
    reasons.push('Best route: same sector as neighboring job');
  } else {
    const previousDistance = previous ? graphDistance(previous.sector, args.request.sector) : undefined;
    const nextDistance = next ? graphDistance(args.request.sector, next.sector) : undefined;
    if (previousDistance === 1 || nextDistance === 1) {
      delta += 14;
      reasons.push('Strong route: adjacent to neighboring work');
    }
  }

  if (anchor) {
    if (anchor.sector === args.request.sector) {
      delta += 16;
      reasons.push('Keeps the half-day geographic cluster together');
    } else if ((previewSectorCompatibility[anchor.sector] ?? []).includes(args.request.sector)) {
      delta += 7;
      reasons.push('Stays inside the anchor-compatible route');
    }
    const anchorOfficeDistance = graphDistance(anchor.sector, officeSector);
    const candidateOfficeDistance = graphDistance(args.request.sector, officeSector);
    if (start > timeToMinutes(anchor.start) && candidateOfficeDistance < anchorOfficeDistance) {
      delta += 8;
      reasons.push('Progresses the route toward Santa Cruz');
    }
  }

  const routeJump = previous ? graphDistance(previous.sector, args.request.sector) : 0;
  if (routeJump >= 2) {
    delta -= routeJump * 5;
    reasons.push('Longer inter-sector jump than other valid options');
  }

  const load = routeJobs.length;
  delta -= load * 2;
  return { delta, reasons };
}

export function rankRouteAwareCandidates(args: {
  slots: CandidateSlot[];
  request: BookingRequest;
  jobs: DispatchJob[];
  officeSector?: string;
}) {
  return args.slots
    .map((slot) => {
      const route = routeScoreForCandidate({ slot, request: args.request, jobs: args.jobs, officeSector: args.officeSector });
      return { ...slot, score: slot.score + route.delta, reasons: [...slot.reasons, ...route.reasons] };
    })
    .sort((left, right) => right.score - left.score || timeToMinutes(left.start) - timeToMinutes(right.start));
}

export function earliestFeasibleDay<TDay extends { dateKey: string }>(args: {
  days: TDay[];
  findSlots: (day: TDay) => CandidateSlot[];
}) {
  for (const day of args.days) {
    const slots = args.findSlots(day);
    if (slots.length) return { day, slots };
  }
  return null;
}
