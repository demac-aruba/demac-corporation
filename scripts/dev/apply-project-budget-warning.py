"""One-use, exact-base source editor. Not a build hook or production migration.
Creates no remote refs. The temporary workflow removes this file from the proposed tree.
"""
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
BASE_BLOBS = {
 'apps/erp-next/lib/browser-projects.ts': '0028461cf1cd3efe21ed98fd0392ebc6cde21272',
 'apps/erp-next/lib/project-phase-planner.ts': '5ea306c43a80ab27c366cea00af6af74b11a7324',
 'apps/erp-next/components/scheduling/live-appointment-create-drawer.tsx': 'd16c612b56dd5669cbae9ad8abc3c66bcb767c3d',
 'apps/erp-next/components/projects/projects-phase-workspace-v2.tsx': '129bd90e9320904555030c5a01a8758720fc65d0',
 'apps/erp-next/components/projects/project-phase-planner-dialogs.tsx': '880a7a0e7e14ca9fba9a5196e197d9b11db34d45',
 'apps/erp-next/scripts/projects-preview-acceptance.ts': '8a85d5ceb35232f471669b5d657840301c64bd70',
}
for filename, expected in BASE_BLOBS.items():
    actual = subprocess.check_output(['git', 'hash-object', filename], cwd=ROOT, text=True).strip()
    if actual != expected:
        raise RuntimeError(f'Unexpected source version: {filename}; refusing to apply edits')
source = {p: (ROOT / p).read_text() for p in BASE_BLOBS}

def replace(path, old, new, count=1):
    if source[path].count(old) != count:
        raise RuntimeError(f'Expected {count} exact occurrences in {path}: {old[:100]}')
    source[path] = source[path].replace(old, new)

p = 'apps/erp-next/lib/browser-projects.ts'
replace(p, "import { defaultSchedulingSettings } from './scheduling';", "import { defaultSchedulingSettings } from './scheduling';\nimport { calculateProjectLaborBudget, type ProjectLaborBudgetSnapshot } from './project-labor-budget';")
replace(p, "export type ProjectAssignment = {\n", "export type ProjectAssignment = {\n  /** Advisory snapshot in existing browser storage; not an immutable server audit. */\n  laborBudgetAtScheduling?: ProjectLaborBudgetSnapshot;\n  phaseLaborBudgetAtScheduling?: ProjectLaborBudgetSnapshot;\n")
replace(p, "export type ProjectSchedulingPlan = {\n", "export type ProjectSchedulingPlan = {\n  laborBudget: ProjectLaborBudgetSnapshot;\n  phaseLaborBudget?: ProjectLaborBudgetSnapshot;\n")
replace(p, "export function projectMetrics(project: BrowserProject) {\n", "export function projectMetrics(project: BrowserProject) {\n  const laborBudget = calculateProjectLaborBudget(project);\n")
replace(p, "const remainingUnscheduledHours = Math.max(0, project.estimatedLaborHours - project.actualLaborHours - project.scheduledFutureHours);", "const remainingUnscheduledHours = laborBudget.remainingHoursBefore;")
replace(p, "laborConsumption >= 90 || materialAtRisk ? 'At Risk'", "laborBudget.overBudgetHoursAfter > 0 || laborConsumption >= 90 || materialAtRisk ? 'At Risk'")
replace(p, "return { physicalCompletion, laborConsumption, materialBudgetSet, materialConsumption, remainingUnscheduledHours, materialRemaining, health };", "return { physicalCompletion, laborConsumption, materialBudgetSet, materialConsumption, remainingUnscheduledHours, materialRemaining, health, laborBudget };")
start = source[p].index('export function planProjectScheduling(')
end = source[p].index('\nfunction stableProjectAssignmentId', start)
source[p] = source[p][:start] + '''export function planProjectScheduling(project: BrowserProject, scheduledSlots: number, phaseId?: string): ProjectSchedulingPlan {
  const scheduledHours = scheduledHoursForSlots(project, scheduledSlots);
  if (!projectIsSchedulable(project)) {
    throw new Error(`Project ${project.projectNumber} is not available for Scheduling while ${project.status}.`);
  }
  const laborBudget = calculateProjectLaborBudget(project, scheduledHours);
  const normalizedPhaseId = phaseId === undefined ? undefined : normalizedProjectPhaseId(project, phaseId);
  const phase = project.phases.find((candidate) => candidate.id === normalizedPhaseId);
  const phaseLaborBudget = phase ? calculateProjectLaborBudget({
    estimatedLaborHours: phase.estimatedLaborHours,
    actualLaborHours: phase.actualLaborHours,
    scheduledFutureHours: project.assignments
      .filter((assignment) => assignment.phaseId === phase.id && !assignment.postedAt)
      .reduce((sum, assignment) => sum + assignment.scheduledHours, 0),
  }, scheduledHours) : undefined;
  // Budget exhaustion is advisory. Only Booking Authority may decide real Van availability.
  return {
    scheduledHours,
    scheduledSlots,
    remainingHoursBefore: laborBudget.remainingHoursBefore,
    remainingHoursAfter: laborBudget.remainingHoursAfter,
    laborBudget,
    ...(phaseLaborBudget ? { phaseLaborBudget } : {}),
  };
}
''' + source[p][end:]
replace(p, "const scheduledPlan = planProjectScheduling(project, input.scheduledSlots);", "const scheduledPlan = planProjectScheduling(project, input.scheduledSlots, phaseId);")
replace(p, "    scheduledSlots: scheduledPlan.scheduledSlots,\n", "    scheduledSlots: scheduledPlan.scheduledSlots,\n    laborBudgetAtScheduling: scheduledPlan.laborBudget,\n    ...(scheduledPlan.phaseLaborBudget ? { phaseLaborBudgetAtScheduling: scheduledPlan.phaseLaborBudget } : {}),\n")

p = 'apps/erp-next/lib/project-phase-planner.ts'
replace(p, "  postProjectAssignment,\n", "  postProjectAssignment,\n  planProjectScheduling,\n")
replace(p, "  if (phase.actualLaborHours > phase.estimatedLaborHours) return 'Over Budget';\n", "  if (phase.actualLaborHours > phase.estimatedLaborHours) return 'Over Budget';\n  if (committed > phase.estimatedLaborHours) return 'At Risk';\n")
replace(p, '''  const hours = slots * project.slotDurationMinutes / 60;
  if (hours > phaseRemainingHours(project, phase)) throw new Error(`${phase.name} has only ${phaseRemainingHours(project, phase)} uncommitted hours.`);
  if (hours > projectMetrics(project).remainingUnscheduledHours) throw new Error(`The Project has only ${projectMetrics(project).remainingUnscheduledHours} uncommitted hours.`);''', '''  const budgetPlan = planProjectScheduling(project, slots, phase.id);
  const hours = budgetPlan.scheduledHours;''')
replace(p, "    scheduledEnd: end,\n    actualHours: 0,", "    scheduledEnd: end,\n    laborBudgetAtScheduling: budgetPlan.laborBudget,\n    ...(budgetPlan.phaseLaborBudget ? { phaseLaborBudgetAtScheduling: budgetPlan.phaseLaborBudget } : {}),\n    actualHours: 0,")

p = 'apps/erp-next/components/scheduling/live-appointment-create-drawer.tsx'
replace(p, "'use client';\n", "'use client';\n\nimport { ProjectLaborBudgetWarning } from '@/components/projects/project-labor-budget-status';\n")
replace(p, 'planProjectScheduling(selectedProject, Number(projectSlots))', 'planProjectScheduling(selectedProject, Number(projectSlots), selectedProjectPhase?.id)')
replace(p, '''                    {projectPlanState.error ? <div className={styles.projectPlanError} role="alert">{projectPlanState.error}</div> : null}''', '''                    {projectPlanState.error ? <div className={styles.projectPlanError} role="alert">{projectPlanState.error}</div> : null}
                    {projectPlan ? <ProjectLaborBudgetWarning budget={projectPlan.laborBudget} /> : null}
                    {projectPlan?.phaseLaborBudget ? <ProjectLaborBudgetWarning budget={projectPlan.phaseLaborBudget} scope="Phase" /> : null}''')
replace(p, '<span>PROJECT HOURS LEFT</span>', '<span>BUDGET HOURS REMAINING</span>')

p = 'apps/erp-next/components/projects/project-phase-planner-dialogs.tsx'
replace(p, "import { projectMetrics, type BrowserProject } from '@/lib/browser-projects';", "import { projectMetrics, planProjectScheduling, type BrowserProject } from '@/lib/browser-projects';\nimport { ProjectLaborBudgetWarning } from './project-labor-budget-status';")
replace(p, "  const projectRemaining = projectMetrics(project).remainingUnscheduledHours;\n", "  const projectRemaining = projectMetrics(project).remainingUnscheduledHours;\n  const budgetPlan = useMemo(() => {\n    try { return planProjectScheduling(project, slotCount, phase.id); } catch { return null; }\n  }, [project, slotCount, phase.id]);\n")
replace(p, 'disabled={busy || hours > remaining || hours > projectRemaining}', 'disabled={busy}')
replace(p, '''      <div className={hours > remaining || hours > projectRemaining ? styles.alertBox : styles.infoBox}>This visit reserves {number(hours, 1)}h. {number(Math.max(0, remaining - hours), 1)}h will remain uncommitted in this phase.</div>''', '''      {budgetPlan ? <ProjectLaborBudgetWarning budget={budgetPlan.laborBudget} /> : null}
      {budgetPlan?.phaseLaborBudget ? <ProjectLaborBudgetWarning budget={budgetPlan.phaseLaborBudget} scope="Phase" /> : null}
      <div className={styles.infoBox}>This preview plans {number(hours, 1)}h. Remaining phase budget: {number(Math.max(0, remaining - hours), 1)}h. Exceeding an estimate does not block planning or change the original budget. Live bookings still go through Canonical Scheduling.</div>''')
replace(p, 'description="Reserve this phase’s approved capacity and preview the structured handoff sent to the assigned technicians."', 'description="Plan Van time for this phase and preview the technician handoff. Budget overruns warn without blocking; this preview does not reserve the live agenda."')

p = 'apps/erp-next/components/projects/projects-phase-workspace-v2.tsx'
replace(p, "import { useAuth } from '@/components/auth/auth-provider';", "import { useAuth } from '@/components/auth/auth-provider';\nimport { ProjectLaborBudgetSummary } from './project-labor-budget-status';")
replace(p, 'note="Based on recorded project actuals"', 'note="Recorded actuals and planned overruns"')
old = '<div><strong>{number(candidate.actualLaborHours, 1)}h / {number(candidate.estimatedLaborHours)}h</strong><Progress value={candidateMetrics.laborConsumption} tone={candidateMetrics.laborConsumption > 100 ? \'red\' : \'blue\'} /></div>'
new = '''<div><strong>{number(candidate.actualLaborHours, 1)}h / {number(candidate.estimatedLaborHours)}h</strong><small>Recorded actual / estimate</small><Progress value={candidateMetrics.laborConsumption} tone={candidateMetrics.laborConsumption > 100 ? 'red' : 'blue'} /><small>{number(candidate.scheduledFutureHours, 1)}h scheduled · {number(candidateMetrics.laborBudget.committedHoursAfter, 1)}h actual + scheduled</small>{candidateMetrics.laborBudget.overBudgetHoursAfter > 0 ? <Pill label={`Forecast +${number(candidateMetrics.laborBudget.overBudgetHoursAfter, 1)}h over budget`} tone="amber" /> : null}{candidateMetrics.laborBudget.actualOverBudgetHours > 0 ? <small>Recorded actual over budget: +{number(candidateMetrics.laborBudget.actualOverBudgetHours, 1)}h</small> : null}</div>'''
replace(p, old, new)
replace(p, '    <div className={styles.tabs}>', '    <ProjectLaborBudgetSummary project={project} />\n\n    <div className={styles.tabs}>')

p = 'apps/erp-next/scripts/projects-preview-acceptance.ts'
# Extend full-structure checks rather than discard them when the plan gains budget metadata.
for requested, after, remaining in [(6, 96, 24), (3, 93, 27)]:
    old = f'{{ scheduledHours: {requested}, scheduledSlots: 6, remainingHoursBefore: 30, remainingHoursAfter: {remaining} }}'
    new = f'''{{ scheduledHours: {requested}, scheduledSlots: 6, remainingHoursBefore: 30, remainingHoursAfter: {remaining}, laborBudget: {{
    budgetHours: 120, recordedActualHours: 66, scheduledHoursBefore: 24, requestedHours: {requested},
    committedHoursBefore: 90, committedHoursAfter: {after}, remainingHoursBefore: 30, remainingHoursAfter: {remaining},
    overBudgetHoursBefore: 0, overBudgetHoursAfter: 0, additionalOverBudgetHours: 0, actualOverBudgetHours: 0,
  }} }}'''
    replace(p, old, new)
replace(p, '''assert.throws(
  () => planProjectScheduling({ ...project, actualLaborHours: 119.5, scheduledFutureHours: 0 }, 1),
  /0.5 project labor hours remain unscheduled/,
  'A Scheduling plan must not exceed remaining project labor hours.',
);''', '''const overBudgetPlan = planProjectScheduling({ ...project, actualLaborHours: 119.5, scheduledFutureHours: 0 }, 1);
assert.equal(overBudgetPlan.scheduledSlots, 1, 'Budget exhaustion must not block a valid Project booking.');
assert.equal(overBudgetPlan.laborBudget.overBudgetHoursAfter, 0.5, 'The advisory forecast must retain the precise overrun.');
assert.equal(overBudgetPlan.remainingHoursAfter, 0, 'Budget remaining is clamped to zero without hiding the separate overrun.');
assert.equal(overBudgetPlan.laborBudget.budgetHours, 120, 'Continuing over budget must preserve the original estimate.');''')

for filename, content in source.items():
    (ROOT / filename).write_text(content)
print('Applied exact, bounded edits to', len(source), 'existing files; no source records or production services were accessed.')
