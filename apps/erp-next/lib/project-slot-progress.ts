import type { BrowserProject, ProjectAssignment } from './browser-projects';

/** Read projections only. A booked Van slot is not technician attendance or physical completion. */
export type ProjectSlotWorkOrder = {
  id: string; appointmentId?: string; clientId?: string; propertyId?: string;
  date?: string; time?: string; vanId?: string; status?: string;
  scheduledSlots?: number | string[]; technicianIds?: string[];
};
export type ProjectSlotRead<T> = { value: T | null; failed?: false } | { value: null; failed: true };
export type ProjectSlotSources = Record<string, ProjectSlotRead<ProjectSlotWorkOrder>>;
export type ProjectSlotRow = {
  workOrderId: string; date: string; time: string; vanId: string; phase: string;
  slots: number | null; status: string; technicianIds: string[]; issue?: string;
};
export type ProjectSlotProgress = {
  rows: ProjectSlotRow[]; budget: number | null; total: number; overBudget: number;
  percent: number; complete: boolean; previewCount: number;
};

export function slotText(value: unknown) { return typeof value === 'string' ? value.trim() : ''; }
export function projectSlotAssignments(project: BrowserProject): ProjectAssignment[] {
  return (Array.isArray(project.assignments) ? project.assignments : [])
    .filter((item): item is ProjectAssignment => Boolean(item && typeof item === 'object'));
}
export function linkedProjectWorkOrderIds(projects: BrowserProject[]) {
  return [...new Set(projects.flatMap((project) => projectSlotAssignments(project)
    .map((assignment) => slotText(assignment.workOrderId))).filter(Boolean))].sort();
}
export function recordedSlotCount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (!Array.isArray(value) || value.some((slot) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(slotText(slot)))) return null;
  return new Set(value.map(slotText)).size;
}
function validDate(value: unknown) {
  const date = slotText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

/** Always replace totals from current linked Work Orders; never increment a stored counter. */
export function projectSlotProgress(project: BrowserProject, projects: BrowserProject[], sources: ProjectSlotSources): ProjectSlotProgress {
  const assignments = projectSlotAssignments(project);
  const rows: ProjectSlotRow[] = [];
  const ownIds = linkedProjectWorkOrderIds([project]);
  for (const workOrderId of ownIds) {
    const links = assignments.filter((assignment) => slotText(assignment.workOrderId) === workOrderId);
    const link = links[0];
    const row: ProjectSlotRow = {
      workOrderId, date: '', time: '', vanId: '', phase: '', slots: null,
      status: 'Unverified', technicianIds: [],
    };
    const claims = projects.flatMap((candidate) => projectSlotAssignments(candidate)
      .filter((assignment) => slotText(assignment.workOrderId) === workOrderId)
      .map((assignment) => JSON.stringify([candidate.id, assignment.projectId, assignment.appointmentId, assignment.phaseId].map(slotText))));
    const appointmentProjects = projects.filter((candidate) => projectSlotAssignments(candidate)
      .some((assignment) => slotText(assignment.appointmentId) === slotText(link.appointmentId))).map((candidate) => candidate.id);
    if (new Set(claims).size !== 1 || new Set(appointmentProjects).size > 1 || link.projectId !== project.id || !slotText(link.appointmentId)) {
      row.issue = 'Conflicting Project links. Verify this Work Order.';
    } else {
      const read = Object.hasOwn(sources, workOrderId) ? sources[workOrderId] : undefined;
      const order = read?.value;
      if (!read || read.failed) row.issue = 'Schedule could not be verified. Retry refresh.';
      else if (!order) { row.slots = 0; row.status = 'Removed'; }
      else if (order.id !== workOrderId || order.appointmentId !== link.appointmentId
        || !slotText(project.customerId) || order.clientId !== project.customerId
        || !slotText(project.siteId) || order.propertyId !== project.siteId) {
        row.issue = 'Work Order identity no longer matches this Project.';
      } else {
        row.date = validDate(order.date);
        row.time = slotText(order.time);
        row.vanId = slotText(order.vanId);
        row.phase = project.phases.find((phase) => phase && phase.id === link.phaseId)?.name || 'Project work';
        row.status = slotText(order.status) || 'Status unverified';
        row.technicianIds = [...new Set((Array.isArray(order.technicianIds) ? order.technicianIds : []).map(slotText).filter(Boolean))];
        const cancelled = ['cancelada', 'cancelled', 'canceled'].includes(row.status.toLowerCase());
        row.slots = cancelled ? 0 : recordedSlotCount(order.scheduledSlots);
        if (row.slots === null) row.issue = 'Slot count is missing or invalid in Scheduling.';
        else if (!cancelled && (!row.date || !row.vanId || !slotText(order.status))) {
          row.slots = null;
          row.issue = 'Date, Van or status is missing. Verify this Work Order.';
        }
      }
    }
    rows.push(row);
  }
  rows.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.time.localeCompare(b.time) || a.workOrderId.localeCompare(b.workOrderId));
  const budget = typeof project.estimatedSlots === 'number' ? recordedSlotCount(project.estimatedSlots) : null;
  const total = rows.reduce((sum, row) => sum + (row.slots ?? 0), 0);
  const overBudget = budget === null ? 0 : Math.max(0, total - budget);
  return {
    rows, budget, total, overBudget, percent: budget ? total / budget * 100 : total > 0 ? 100 : 0,
    complete: budget !== null && rows.every((row) => row.slots !== null),
    previewCount: assignments.filter((assignment) => !slotText(assignment.workOrderId)).length,
  };
}

export type ProjectSlotStaff = { id: string; name?: string };
export type ProjectSlotAttendance = {
  id: string; employeeId?: string; date?: string; attendanceStatus?: string;
  clockInTime?: string; clockOutTime?: string; updatedAt?: string;
};
export type ProjectSlotPeople = {
  staff: Record<string, ProjectSlotRead<ProjectSlotStaff>>;
  attendance: Record<string, ProjectSlotRead<ProjectSlotAttendance>>;
  canReadAttendance: boolean;
};
export function projectSlotTechnician(id: string, date: string, people?: ProjectSlotPeople) {
  const profile = people && Object.hasOwn(people.staff, id) ? people.staff[id]?.value : undefined;
  const name = profile?.id === id && slotText(profile.name) ? slotText(profile.name) : 'Technician not identified';
  if (!people) return { name, attendance: 'Loading attendance…' };
  if (!people.canReadAttendance) return { name, attendance: 'Attendance access required' };
  const key = `${id}_${date}`;
  const read = Object.hasOwn(people.attendance, key) ? people.attendance[key] : undefined;
  if (!read || read.failed) return { name, attendance: 'Attendance could not be verified' };
  const entry = read.value;
  if (!entry) return { name, attendance: 'No explicit attendance record' };
  if (entry.employeeId !== id || entry.date !== date) return { name, attendance: 'Attendance identity mismatch' };
  const workedStatus = ['Present', 'Late'].includes(slotText(entry.attendanceStatus));
  return { name, attendance: `${slotText(entry.attendanceStatus) || 'Attendance recorded'}${workedStatus && entry.clockInTime && entry.clockOutTime ? ` · ${entry.clockInTime}–${entry.clockOutTime}` : ''}` };
}
