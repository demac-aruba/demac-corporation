import { WorkIntervention, WorkVisit, VisitUnit } from './contracts';

const SUBMITTED_STATUSES = new Set<WorkIntervention['status']>(['ready_for_review', 'completed']);
const LOCKED_STATUSES = new Set<WorkIntervention['status']>(['ready_for_review', 'changes_requested', 'completed']);

export function activeInterventionsForUnit(unitId: string, interventions: WorkIntervention[]) {
  return interventions.filter((item) => item.visitUnitId === unitId && item.status !== 'cancelled');
}

export function unitHasSubmittedFieldWork(unitId: string, interventions: WorkIntervention[]) {
  const active = activeInterventionsForUnit(unitId, interventions);
  return active.length > 0 && active.every((item) => SUBMITTED_STATUSES.has(item.status));
}

export function unitHasCompletedReview(unitId: string, interventions: WorkIntervention[]) {
  const active = activeInterventionsForUnit(unitId, interventions);
  return active.length > 0 && active.every((item) => item.status === 'completed');
}

export function registeredUnitsForVisit(visitId: string, units: VisitUnit[]) {
  return units.filter((unit) => unit.visitId === visitId && Boolean(unit.equipmentSystemId));
}

export function visitHasSubmittedFieldWork(visitId: string, units: VisitUnit[], interventions: WorkIntervention[]) {
  const registered = registeredUnitsForVisit(visitId, units);
  return registered.length > 0 && registered.every((unit) => unitHasSubmittedFieldWork(unit.id, interventions));
}

export function visitHasCompletedReview(visitId: string, units: VisitUnit[], interventions: WorkIntervention[]) {
  const registered = registeredUnitsForVisit(visitId, units);
  return registered.length > 0 && registered.every((unit) => unitHasCompletedReview(unit.id, interventions));
}

export function isUnitLockedForNewWork(unit: VisitUnit | undefined, visit: WorkVisit | undefined, interventions: WorkIntervention[]) {
  if (!unit || !visit) return true;
  if (unit.status === 'completed') return true;
  if (visit.status === 'ready_for_office_review' || visit.status === 'completed') return true;
  return activeInterventionsForUnit(unit.id, interventions).some((item) => LOCKED_STATUSES.has(item.status));
}
