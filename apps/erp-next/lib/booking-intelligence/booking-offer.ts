import type { BookingRequest, CandidateSlot, DispatchJob } from '../scheduling';

export type BookingOffer = {
  id: string;
  dayKey: string;
  candidateKey: string;
  requestFingerprint: string;
  scheduleFingerprint: string;
  offeredAt: string;
};

export type BookingOfferValidation = {
  valid: boolean;
  reason: 'valid' | 'request_changed' | 'schedule_changed' | 'slot_no_longer_available';
  replacement?: CandidateSlot;
};

function stableHash(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  return (hash >>> 0).toString(36);
}

export function candidateKey(slot: Pick<CandidateSlot, 'vanId' | 'start' | 'end' | 'supportVanId' | 'supportStart' | 'supportEnd'>) {
  return [slot.vanId, slot.start, slot.end, slot.supportVanId ?? '', slot.supportStart ?? '', slot.supportEnd ?? ''].join('|');
}

export function requestFingerprint(request: BookingRequest) {
  const workLines = request.workLines?.map((line) => `${line.presetId}:${line.quantity}`).join(',') ?? '';
  const restriction = request.restriction ? `${request.restriction.halfDay ?? ''}:${request.restriction.notBefore ?? ''}:${request.restriction.notAfter ?? ''}` : '';
  return stableHash([request.customer, request.site, request.sector, request.presetId, request.quantity, workLines, restriction].join('|'));
}

export function scheduleFingerprint(jobs: DispatchJob[]) {
  const material = jobs
    .filter((job) => job.status !== 'cancelled')
    .map((job) => [job.id, job.vanId, job.start, job.end, job.status, job.sector].join(':'))
    .sort()
    .join('|');
  return stableHash(material);
}

export function createBookingOffer(args: {
  dayKey: string;
  request: BookingRequest;
  slot: CandidateSlot;
  jobs: DispatchJob[];
}): BookingOffer {
  const offeredAt = new Date().toISOString();
  const key = candidateKey(args.slot);
  return {
    id: `BO-${stableHash(`${args.dayKey}|${key}|${offeredAt}`)}`,
    dayKey: args.dayKey,
    candidateKey: key,
    requestFingerprint: requestFingerprint(args.request),
    scheduleFingerprint: scheduleFingerprint(args.jobs),
    offeredAt,
  };
}

export function validateBookingOffer(args: {
  offer: BookingOffer;
  request: BookingRequest;
  currentJobs: DispatchJob[];
  currentCandidates: CandidateSlot[];
}): BookingOfferValidation {
  if (requestFingerprint(args.request) !== args.offer.requestFingerprint) return { valid: false, reason: 'request_changed' };
  const current = args.currentCandidates.find((slot) => candidateKey(slot) === args.offer.candidateKey);
  if (!current) return { valid: false, reason: 'slot_no_longer_available' };
  if (scheduleFingerprint(args.currentJobs) !== args.offer.scheduleFingerprint) {
    return { valid: true, reason: 'schedule_changed', replacement: current };
  }
  return { valid: true, reason: 'valid', replacement: current };
}
