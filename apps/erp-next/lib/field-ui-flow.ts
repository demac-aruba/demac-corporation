import type { FieldScheduleJob, FieldVisitStatus } from './field-authority-contract';

export const FIELD_EXPERIENCE_STAGES = [
  { id: 'arrival', label: 'Llegada' },
  { id: 'service', label: 'Servicio' },
  { id: 'close', label: 'Cierre' },
] as const;

export type FieldExperienceStage = (typeof FIELD_EXPERIENCE_STAGES)[number]['id'];
export type FieldExperienceStepState = 'complete' | 'current' | 'upcoming';

const ACTIVE_VISIT_STATUSES = new Set<FieldVisitStatus>(['en_route', 'on_site', 'in_progress']);
const CLOSED_VISIT_STATUSES = new Set<FieldVisitStatus>(['completed', 'no_access', 'cancelled']);

/**
 * Presentation-only grouping. The server's canonical visit state machine remains unchanged.
 */
export function fieldExperienceStageForStatus(status?: FieldVisitStatus | null): FieldExperienceStage {
  if (status === 'in_progress' || status === 'pending' || status === 'requires_return_visit') return 'service';
  if (status === 'ready_for_office_review' || status === 'completed' || status === 'no_access' || status === 'cancelled') return 'close';
  return 'arrival';
}

export function fieldExperienceStageForJob(job: Pick<FieldScheduleJob, 'status' | 'fieldVisit'>): FieldExperienceStage {
  if (job.fieldVisit) return fieldExperienceStageForStatus(job.fieldVisit.status);
  if (job.status === 'En proceso' || job.status === 'Pendiente') return 'service';
  if (job.status === 'Completada' || job.status === 'Cancelada') return 'close';
  return 'arrival';
}

export function fieldExperienceStepState(
  step: FieldExperienceStage,
  current: FieldExperienceStage,
): FieldExperienceStepState {
  const stepIndex = FIELD_EXPERIENCE_STAGES.findIndex((item) => item.id === step);
  const currentIndex = FIELD_EXPERIENCE_STAGES.findIndex((item) => item.id === current);
  if (stepIndex < currentIndex) return 'complete';
  if (stepIndex === currentIndex) return 'current';
  return 'upcoming';
}

export function isFieldJobCompleted(job: Pick<FieldScheduleJob, 'status' | 'fieldVisit'>) {
  // Once a Field visit exists, its canonical status takes precedence over legacy labels.
  // This is field execution completion only; it does not imply Office approval.
  return job.fieldVisit
    ? job.fieldVisit.status === 'completed'
    : job.status === 'Completada';
}

export function isFieldJobInProgress(job: Pick<FieldScheduleJob, 'status' | 'fieldVisit'>) {
  return job.fieldVisit
    ? ACTIVE_VISIT_STATUSES.has(job.fieldVisit.status)
    : ['En camino', 'En el sitio', 'En proceso'].includes(job.status);
}

function isFieldJobClosed(job: Pick<FieldScheduleJob, 'status' | 'fieldVisit'>) {
  return job.fieldVisit
    ? CLOSED_VISIT_STATUSES.has(job.fieldVisit.status)
    : ['Completada', 'Cancelada'].includes(job.status);
}

/** Parse only supported 24-hour clock values; never guess dates or localized times. */
function fieldClockMinutes(value: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

/** Selects the active job first, then the next scheduled job, without mutating input order. */
export function selectNextFieldJob<T extends FieldScheduleJob>(jobs: readonly T[], nowTime: string): T | null {
  const open = jobs.filter((job) => !isFieldJobClosed(job));
  const active = open.find(isFieldJobInProgress);
  if (active) return active;

  // Sort a projection, not the server response or the agenda itself. Equal/unknown times
  // retain response priority. Missing times remain unknown rather than becoming midnight.
  const ordered = open.map((job, index) => ({ job, index, minutes: fieldClockMinutes(job.time) }))
    .sort((left, right) => ((left.minutes ?? 1440) - (right.minutes ?? 1440)) || left.index - right.index);
  const now = fieldClockMinutes(nowTime);
  const upcoming = now === null ? undefined : ordered.find((entry) => entry.minutes !== null && entry.minutes >= now);
  return upcoming?.job ?? ordered[0]?.job ?? null;
}

/** Keeps the highlighted next job from being rendered a second time in the route list. */
export function fieldRouteWithoutNextJob<T extends Pick<FieldScheduleJob, 'id' | 'workOrderId'>>(
  jobs: readonly T[],
  nextJob: Pick<FieldScheduleJob, 'id' | 'workOrderId'> | null,
): T[] {
  if (!nextJob) return [...jobs];
  return jobs.filter((job) => job.id !== nextJob.id && job.workOrderId !== nextJob.workOrderId);
}
