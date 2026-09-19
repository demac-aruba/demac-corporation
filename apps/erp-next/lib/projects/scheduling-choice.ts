import type { BrowserProject, ProjectSchedulingPlan } from '../browser-projects';
import type { CentralProject, ProjectActivity } from './registry-types';
import { defaultSchedulingSettings } from '../scheduling';

/** Presentation-only subset. Never invent preview actuals to make a central plan look local. */
export type CentralSchedulingChoice = Pick<BrowserProject,
  'id' | 'projectNumber' | 'name' | 'type' | 'customerId' | 'siteId' | 'customerName' |
  'location' | 'technicianInstructions' | 'slotsPerWorkDay' | 'slotDurationMinutes'> & {
  status: string;
  phases: Array<{ id: string; name: string; status: string }>;
  centralPlan: CentralProject;
};
export type SchedulingProjectChoice = BrowserProject | CentralSchedulingChoice;
export type CentralSlotPlan = {
  scheduledSlots: number;
  scheduledHours: number;
  remainingHoursBefore: null;
  remainingHoursAfter: null;
};
export type DrawerProjectPlan = ProjectSchedulingPlan | CentralSlotPlan;
export function isCentralChoice(value: SchedulingProjectChoice): value is CentralSchedulingChoice {
  return 'centralPlan' in value;
}
export function centralChoice(plan: CentralProject): CentralSchedulingChoice {
  if (plan.schemaVersion !== 1 || !plan.id || !Number.isSafeInteger(plan.version) || plan.version < 1
      || !Array.isArray(plan.phases) || plan.budget?.unit !== 'van_minutes'
      || !Number.isSafeInteger(plan.budget.currentMinutes) || plan.budget.currentMinutes < 0) {
    throw new Error('The central Project record is invalid. Refresh before booking.');
  }
  const estimate = plan.details?.scheduleEstimate as Record<string, unknown> | undefined;
  const slotMinutes = estimate?.slotMinutes ?? 60;
  const slotsPerDay = estimate?.slotsPerDay ?? defaultSchedulingSettings.serviceStartTimes.length;
  if (!Number.isSafeInteger(slotMinutes) || (slotMinutes as number) < 1 || (slotMinutes as number) > 1440
      || !Number.isSafeInteger(slotsPerDay) || (slotsPerDay as number) < 1 || (slotsPerDay as number) > 48) {
    throw new Error('The Project planning units require reconciliation. They were not silently replaced.');
  }
  return {
    id: plan.id, projectNumber: plan.projectNumber, name: plan.name, type: plan.type,
    customerId: plan.customerId, siteId: plan.propertyId, customerName: plan.customerId,
    location: plan.propertyId, technicianInstructions: plan.technicianInstructions,
    status: plan.planningStatus, centralPlan: plan,
    // Preserve imported planning units; new plans use the existing standard input convention.
    slotsPerWorkDay: slotsPerDay as number, slotDurationMinutes: slotMinutes as number,
    phases: plan.phases.map(phase => ({ id: phase.id, name: phase.name, status: 'Planning record' })),
  };
}
export function centralSlotPlan(choice: CentralSchedulingChoice, slots: number): CentralSlotPlan {
  if (!Number.isInteger(slots) || slots < 1 || slots > choice.slotsPerWorkDay) {
    throw new Error(`Enter a whole number between 1 and ${choice.slotsPerWorkDay} Project slots.`);
  }
  return { scheduledSlots: slots, scheduledHours: slots * choice.slotDurationMinutes / 60, remainingHoursBefore: null, remainingHoursAfter: null };
}
export function centralBudgetForecast(activity: ProjectActivity | null, project: CentralProject, requestedMinutes: number) {
  if (!activity || activity.projectId !== project.id || activity.projectVersion !== project.version
      || !activity.coverage?.pageIsValid || !activity.coverage.allProjectLinksIncluded
      || !activity.projectForecast || activity.projectForecast.budgetMinutes !== project.budget.currentMinutes) return null;
  const prior = activity.projectForecast.plannedMinutes;
  if (!Number.isSafeInteger(prior) || prior < 0 || !Number.isSafeInteger(requestedMinutes) || requestedMinutes < 0) return null;
  return { budgetMinutes: project.budget.currentMinutes, priorMinutes: prior,
    totalMinutes: prior + requestedMinutes, overMinutes: Math.max(0, prior + requestedMinutes - project.budget.currentMinutes) };
}
