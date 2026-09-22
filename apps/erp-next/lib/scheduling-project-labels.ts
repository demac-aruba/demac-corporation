import type { BrowserAppointmentRecord } from './browser-operational';
import { sanitizeProjectsState } from './project-record-sanitizer';

/** Display context from the existing browser Project link, never booking authority. */
export type SchedulingProjectLabel = {
  projectId: string;
  name: string;
  phaseNames: string[];
};

const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

export function schedulingProjectLabel(
  appointment: BrowserAppointmentRecord,
  projectState: unknown,
): SchedulingProjectLabel | undefined {
  if (!nonempty(appointment.id) || !nonempty(appointment.customerId) || !nonempty(appointment.siteId)) return;
  const workOrderIds = new Set([appointment.workOrderId, ...(appointment.workOrderIds ?? [])].filter(nonempty));
  // Inspect duplicate claims before sanitizing; the sanitizer keeps only the first ID.
  const raw = projectState as { projects?: Array<{ id?: unknown }> } | null;
  const rawProjects = Array.isArray(raw?.projects) ? raw.projects : [];
  const matches: SchedulingProjectLabel[] = [];
  for (const project of sanitizeProjectsState(projectState).state.projects) {
    if (!nonempty(project.name) || project.customerId !== appointment.customerId || project.siteId !== appointment.siteId) continue;
    const links = project.assignments.filter((link) => link && link.projectId === project.id
      && link.appointmentId === appointment.id && nonempty(link.workOrderId) && workOrderIds.has(link.workOrderId));
    if (!links.length) continue;
    if (rawProjects.filter((candidate) => candidate?.id === project.id).length !== 1) return;
    const phaseIds = new Set(links.map((link) => link.phaseId).filter(nonempty));
    const phaseNames = [...phaseIds].flatMap((id) => {
      const phases = project.phases.filter((phase) => phase && phase.id === id && nonempty(phase.name));
      return phases.length === 1 ? [phases[0].name.trim()] : [];
    });
    matches.push({ projectId: project.id, name: project.name.trim(), phaseNames: [...new Set(phaseNames)] });
  }
  // Never choose an arbitrary Project when local records disagree.
  return matches.length === 1 ? matches[0] : undefined;
}
