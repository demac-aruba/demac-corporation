import type { BrowserProject } from '@/lib/browser-projects';
import { calculateProjectLaborBudget, type ProjectLaborBudgetSnapshot } from '@/lib/project-labor-budget';
import { projectSlotLabel } from '@/lib/project-slot-label';
import styles from './project-labor-budget-status.module.css';

export function ProjectLaborBudgetWarning({ budget, slotDurationMinutes, scope = 'Project' }: {
  budget: ProjectLaborBudgetSnapshot;
  slotDurationMinutes: number;
  scope?: string;
}) {
  if (budget.overBudgetHoursAfter <= 0) return null;
  const slots = (value: number) => projectSlotLabel(value, slotDurationMinutes);
  return <aside className={styles.warning} role="status" data-project-budget-warning>
    <strong>{scope} slot budget forecast exceeded · +{slots(budget.overBudgetHoursAfter)}</strong>
    <p>Budget: {slots(budget.budgetHours)}. Previously committed: {slots(budget.committedHoursBefore)}.
      {' '}This visit: {slots(budget.requestedHours)}. Projected total: {slots(budget.committedHoursAfter)}.</p>
    <p>You may continue booking. Actual Van availability and booking authorization still apply.
      {' '}This visit adds planned slots; it does not record completed work. The original budget is unchanged.</p>
  </aside>;
}

export function ProjectLaborBudgetSummary({ project }: { project: BrowserProject }) {
  const budget = calculateProjectLaborBudget(project);
  const slots = (value: number) => projectSlotLabel(value, project.slotDurationMinutes);
  const warnings = project.assignments.filter((assignment) =>
    (assignment.laborBudgetAtScheduling?.overBudgetHoursAfter ?? 0) > 0
    || (assignment.phaseLaborBudgetAtScheduling?.overBudgetHoursAfter ?? 0) > 0);
  return <section className={styles.summary} aria-label="Project slot budget tracking">
    <header><strong>Slot budget tracking</strong><span>Budget is an estimate, not a booking limit.</span></header>
    <dl>
      <div><dt>Budget</dt><dd>{slots(budget.budgetHours)}</dd></div>
      <div><dt>Recorded consumption (slot equivalent)</dt><dd>{slots(budget.recordedActualHours)}</dd></div>
      <div><dt>Scheduled</dt><dd>{slots(budget.scheduledHoursBefore)}</dd></div>
      <div><dt>Recorded + scheduled</dt><dd>{slots(budget.committedHoursAfter)}</dd></div>
      <div><dt>Forecast over budget</dt><dd>+{slots(budget.overBudgetHoursAfter)}</dd></div>
    </dl>
    {budget.actualOverBudgetHours > 0 && <p className={styles.actual}>Recorded consumption exceeds the slot budget by {slots(budget.actualOverBudgetHours)}.</p>}
    {budget.overBudgetHoursAfter > 0 && <p className={styles.forecast}>Slot budget forecast exceeded. Additional bookings remain allowed subject to real Van availability.</p>}
    <small>Based on the current Projects record. Scheduled slots remain separate from completed work; centralized Field reconciliation is still pending.</small>
    {warnings.length > 0 && <details>
      <summary>Recorded allocation warnings ({warnings.length})</summary>
      <ul>{warnings.map((assignment) => <li key={assignment.id}>
        <strong>{assignment.scheduledDate || 'Date pending'} · {assignment.vanId}</strong>
        <span>{slots(assignment.scheduledHours)} scheduled · {assignment.workOrderId || assignment.id}</span>
        {assignment.laborBudgetAtScheduling && <span>Project forecast at scheduling: {slots(assignment.laborBudgetAtScheduling.committedHoursAfter)} / {slots(assignment.laborBudgetAtScheduling.budgetHours)} · +{slots(assignment.laborBudgetAtScheduling.overBudgetHoursAfter)}</span>}
        {(assignment.phaseLaborBudgetAtScheduling?.overBudgetHoursAfter ?? 0) > 0 && <span>Phase forecast over budget: +{slots(assignment.phaseLaborBudgetAtScheduling!.overBudgetHoursAfter)}</span>}
      </li>)}</ul>
      <small>Historical snapshots stored with the existing Project assignment; not an immutable server audit log.</small>
    </details>}
  </section>;
}
