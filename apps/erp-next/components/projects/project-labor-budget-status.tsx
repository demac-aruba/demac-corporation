import type { BrowserProject } from '@/lib/browser-projects';
import { calculateProjectLaborBudget, type ProjectLaborBudgetSnapshot } from '@/lib/project-labor-budget';
import styles from './project-labor-budget-status.module.css';

function hours(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

export function ProjectLaborBudgetWarning({ budget, scope = 'Project' }: {
  budget: ProjectLaborBudgetSnapshot;
  scope?: string;
}) {
  if (budget.overBudgetHoursAfter <= 0) return null;
  return <aside className={styles.warning} role="status" data-project-budget-warning>
    <strong>{scope} labor budget forecast exceeded · +{hours(budget.overBudgetHoursAfter)}h</strong>
    <p>Estimate: {hours(budget.budgetHours)}h. Previously committed: {hours(budget.committedHoursBefore)}h.
      {' '}This visit: {hours(budget.requestedHours)}h. Projected total: {hours(budget.committedHoursAfter)}h.</p>
    <p>You may continue booking. Actual Van availability and booking authorization still apply.
      {' '}This is planned allocation, not additional hours already worked. The original estimate is unchanged.</p>
  </aside>;
}

export function ProjectLaborBudgetSummary({ project }: { project: BrowserProject }) {
  const budget = calculateProjectLaborBudget(project);
  const warnings = project.assignments.filter((assignment) =>
    (assignment.laborBudgetAtScheduling?.overBudgetHoursAfter ?? 0) > 0
    || (assignment.phaseLaborBudgetAtScheduling?.overBudgetHoursAfter ?? 0) > 0);
  return <section className={styles.summary} aria-label="Project labor budget tracking">
    <header><strong>Labor budget tracking</strong><span>Budget is an estimate, not a booking limit.</span></header>
    <dl>
      <div><dt>Estimate</dt><dd>{hours(budget.budgetHours)}h</dd></div>
      <div><dt>Recorded actual</dt><dd>{hours(budget.recordedActualHours)}h</dd></div>
      <div><dt>Scheduled</dt><dd>{hours(budget.scheduledHoursBefore)}h</dd></div>
      <div><dt>Actual + scheduled</dt><dd>{hours(budget.committedHoursAfter)}h</dd></div>
      <div><dt>Forecast over budget</dt><dd>+{hours(budget.overBudgetHoursAfter)}h</dd></div>
    </dl>
    {budget.actualOverBudgetHours > 0 && <p className={styles.actual}>Recorded actual labor exceeds the estimate by {hours(budget.actualOverBudgetHours)}h.</p>}
    {budget.overBudgetHoursAfter > 0 && <p className={styles.forecast}>Labor budget review required. Additional bookings remain allowed subject to real Van availability.</p>}
    <small>Based on the current Projects record. Scheduled time is separate from worked time; centralized Field reconciliation is still pending.</small>
    {warnings.length > 0 && <details>
      <summary>Recorded allocation warnings ({warnings.length})</summary>
      <ul>{warnings.map((assignment) => <li key={assignment.id}>
        <strong>{assignment.scheduledDate || 'Date pending'} · {assignment.vanId}</strong>
        <span>{assignment.scheduledHours}h scheduled · {assignment.workOrderId || assignment.id}</span>
        {assignment.laborBudgetAtScheduling && <span>Project forecast at scheduling: {hours(assignment.laborBudgetAtScheduling.committedHoursAfter)}h / {hours(assignment.laborBudgetAtScheduling.budgetHours)}h · +{hours(assignment.laborBudgetAtScheduling.overBudgetHoursAfter)}h</span>}
        {(assignment.phaseLaborBudgetAtScheduling?.overBudgetHoursAfter ?? 0) > 0 && <span>Phase forecast over budget: +{hours(assignment.phaseLaborBudgetAtScheduling!.overBudgetHoursAfter)}h</span>}
      </li>)}</ul>
      <small>Historical snapshots stored with the existing Project assignment; not an immutable server audit log.</small>
    </details>}
  </section>;
}
