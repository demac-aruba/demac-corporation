import type { FieldScheduleJob } from './field-authority-contract';

export function fieldRolePresentation(role?: FieldScheduleJob['responsibility']) {
  if (role === 'lead') return 'Técnico responsable';
  if (role === 'helper') return 'Ayudante';
  if (role === 'office') return 'Oficina';
  if (role === 'technician') return 'Técnico asignado';
  return 'Equipo de campo';
}

/** Read-only presentation, never a lifecycle transition or Office-approval inference. */
export function fieldJobStatusPresentation(job: Pick<FieldScheduleJob, 'status' | 'fieldVisit'>): { label: string; tone: 'blue' | 'green' | 'amber' | 'muted' } {
  if (job.fieldVisit) {
    const status = job.fieldVisit.status;
    if (status === 'ready_for_office_review') return { label: 'Enviado a oficina', tone: 'blue' };
    if (status === 'completed') return { label: 'Terminado en campo', tone: 'green' };
    if (status === 'cancelled') return { label: 'Cancelado', tone: 'muted' };
    if (status === 'no_access') return { label: 'Sin acceso', tone: 'amber' };
    if (status === 'requires_return_visit') return { label: 'Requiere retorno', tone: 'amber' };
    if (status === 'pending') return { label: 'Pendiente', tone: 'amber' };
    if (status === 'in_progress') return { label: 'En progreso', tone: 'blue' };
    if (status === 'on_site') return { label: 'En el sitio', tone: 'blue' };
    if (status === 'en_route') return { label: 'En camino', tone: 'blue' };
    return { label: 'Programado', tone: 'muted' };
  }
  if (job.status === 'Completada') return { label: 'Terminado en agenda', tone: 'green' };
  if (job.status === 'Cancelada') return { label: 'Cancelado', tone: 'muted' };
  return { label: job.status || 'Por confirmar', tone: 'muted' };
}

export function fieldWorkSummary(job: Pick<FieldScheduleJob, 'plannedWork' | 'customerFacingDescription'>) {
  return job.plannedWork.length
    ? job.plannedWork.map((line) => `${line.label} · ${line.quantity}`).join(' / ')
    : job.customerFacingDescription || 'Alcance por confirmar';
}

export function fieldDaySummary(jobs: readonly FieldScheduleJob[]) {
  const finished = jobs.filter((job) => job.fieldVisit ? job.fieldVisit.status === 'completed' : job.status === 'Completada').length;
  const sent = jobs.filter((job) => job.fieldVisit?.status === 'ready_for_office_review').length;
  const cancelled = jobs.filter((job) => job.fieldVisit ? job.fieldVisit.status === 'cancelled' : job.status === 'Cancelada').length;
  return { total: jobs.length, finished, sent, pending: jobs.length - finished - sent - cancelled };
}
