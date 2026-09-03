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
  return job.fieldVisit?.status === 'completed' || job.status === 'Completada';
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

/** Selects the active job first, then the next scheduled job, without mutating input order. */
export function selectNextFieldJob<T extends FieldScheduleJob>(jobs: readonly T[], nowTime: string): T | null {
  const open = jobs.filter((job) => !isFieldJobClosed(job));
  const active = open.find(isFieldJobInProgress);
  if (active) return active;
  return open.find((job) => Boolean(job.time) && job.time >= nowTime) ?? open[0] ?? null;
}

/** Keeps the highlighted next job from being rendered a second time in the route list. */
export function fieldRouteWithoutNextJob<T extends Pick<FieldScheduleJob, 'id' | 'workOrderId'>>(
  jobs: readonly T[],
  nextJob: Pick<FieldScheduleJob, 'id' | 'workOrderId'> | null,
): T[] {
  if (!nextJob) return [...jobs];
  return jobs.filter((job) => job.id !== nextJob.id && job.workOrderId !== nextJob.workOrderId);
}
