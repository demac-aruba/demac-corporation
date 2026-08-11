import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import type { BrowserFieldExecutionRecord } from './browser-field';
import { browserKeys, loadBrowserValue, saveBrowserValue } from './browser-store';
import { loadWorkOrderScopes, scopeStatus } from './browser-workorder-scope';
import { deriveWorkOrderMaterialReadiness, loadWorkOrderMaterialPlans } from './browser-workorder-materials';
import { deriveCrewSkillReadiness } from './browser-workforce';

export const BROWSER_JOB_READINESS_CHECKS_KEY = 'demac.erp-next.operations.job-readiness-checks.v1';
export const BROWSER_DISPATCH_RELEASES_KEY = 'demac.erp-next.operations.dispatch-at-risk-releases.v1';

export type ManualReadinessState = 'not_checked' | 'ready' | 'not_required' | 'blocked';
export type JobReadinessStatus = 'ready' | 'at_risk' | 'blocked';

export type BrowserJobReadinessChecks = {
  workOrderId: string;
  crewSkill: Exclude<ManualReadinessState, 'not_required'>;
  tools: ManualReadinessState;
  siteAccess: ManualReadinessState;
  commercialClearance: ManualReadinessState;
  updatedAt: string;
  updatedBy: string;
};

export type JobReadinessDimension = {
  id: 'appointment' | 'assignment' | 'scope' | 'materials' | 'crew_skill' | 'tools' | 'site_access' | 'commercial';
  label: string;
  status: JobReadinessStatus;
  reason: string;
  source: string;
};

export type BrowserJobReadiness = {
  workOrderId: string;
  status: JobReadinessStatus;
  dimensions: JobReadinessDimension[];
  blockers: JobReadinessDimension[];
  risks: JobReadinessDimension[];
  calculatedAt: string;
};

export type BrowserDispatchAtRiskRelease = {
  id: string;
  workOrderId: string;
  riskSignature: string;
  reason: string;
  authorizedBy: string;
  authorizedAt: string;
};

export const defaultJobReadinessChecks = (workOrderId: string): BrowserJobReadinessChecks => ({
  workOrderId,
  crewSkill: 'not_checked',
  tools: 'not_checked',
  siteAccess: 'not_checked',
  commercialClearance: 'not_checked',
  updatedAt: new Date(0).toISOString(),
  updatedBy: 'Not checked',
});

export function loadJobReadinessChecks() {
  return loadBrowserValue<BrowserJobReadinessChecks[]>(BROWSER_JOB_READINESS_CHECKS_KEY, []);
}

export function saveJobReadinessChecks(record: BrowserJobReadinessChecks) {
  const current = loadJobReadinessChecks();
  const normalized = { ...record, updatedAt: new Date().toISOString() };
  const next = current.some((item) => item.workOrderId === record.workOrderId)
    ? current.map((item) => item.workOrderId === record.workOrderId ? normalized : item)
    : [...current, normalized];
  saveBrowserValue(BROWSER_JOB_READINESS_CHECKS_KEY, next);
  return normalized;
}

function manualDimension(id: JobReadinessDimension['id'], label: string, state: ManualReadinessState, source: string): JobReadinessDimension {
  if (state === 'blocked') return { id, label, status: 'blocked', reason: `${label} was explicitly marked blocked.`, source };
  if (state === 'ready') return { id, label, status: 'ready', reason: `${label} was explicitly confirmed ready.`, source };
  if (state === 'not_required') return { id, label, status: 'ready', reason: `${label} was explicitly marked not required for this Work Order.`, source };
  return { id, label, status: 'at_risk', reason: `${label} has not been explicitly checked.`, source };
}

function appointmentDimension(order: BrowserWorkOrderRecord, appointments: BrowserAppointmentRecord[]): JobReadinessDimension {
  const appointment = appointments.find((item) => item.id === order.appointmentId);
  if (!appointment) return { id: 'appointment', label: 'Customer Confirmation', status: 'at_risk', reason: 'The source appointment could not be resolved from browser persistence.', source: order.appointmentId };
  if (appointment.status === 'cancelled') return { id: 'appointment', label: 'Customer Confirmation', status: 'blocked', reason: 'The source appointment is cancelled.', source: appointment.id };
  if (appointment.status !== 'confirmed') return { id: 'appointment', label: 'Customer Confirmation', status: 'at_risk', reason: `Appointment is ${appointment.status.replaceAll('_', ' ')} rather than confirmed.`, source: appointment.id };
  return { id: 'appointment', label: 'Customer Confirmation', status: 'ready', reason: 'Source appointment is confirmed.', source: appointment.id };
}

function assignmentDimension(order: BrowserWorkOrderRecord): JobReadinessDimension {
  if (!order.primaryVanId || !order.assignments.some((assignment) => assignment.role === 'primary')) return { id: 'assignment', label: 'Van Assignment', status: 'blocked', reason: 'A primary van assignment is missing.', source: order.id };
  if (order.supportVanId && !order.assignments.some((assignment) => assignment.role === 'support' && assignment.vanId === order.supportVanId)) return { id: 'assignment', label: 'Van Assignment', status: 'at_risk', reason: 'Support van reference does not match the Work Order assignment list.', source: order.id };
  const communicationOwners = order.assignments.filter((assignment) => assignment.customerCommunicationOwner).length;
  if (communicationOwners !== 1) return { id: 'assignment', label: 'Van Assignment', status: 'blocked', reason: `Work Order has ${communicationOwners} customer communication owners; exactly one is required.`, source: order.id };
  return { id: 'assignment', label: 'Van Assignment', status: 'ready', reason: `${order.primaryVanId}${order.supportVanId ? ` + ${order.supportVanId}` : ''} assigned with one customer communication owner.`, source: order.id };
}

export function deriveBrowserJobReadiness(order: BrowserWorkOrderRecord, options?: {
  checks?: BrowserJobReadinessChecks[];
  appointments?: BrowserAppointmentRecord[];
  executions?: BrowserFieldExecutionRecord[];
}): BrowserJobReadiness {
  const checks = options?.checks ?? loadJobReadinessChecks();
  const manual = checks.find((item) => item.workOrderId === order.id) ?? defaultJobReadinessChecks(order.id);
  const appointments = options?.appointments ?? loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []);
  const scope = loadWorkOrderScopes().find((item) => item.workOrderId === order.id);
  const scopeResult = scopeStatus(order, scope);
  const materials = deriveWorkOrderMaterialReadiness(order, { plans: loadWorkOrderMaterialPlans(), executions: options?.executions });
  const crewSkill = deriveCrewSkillReadiness(order);

  const dimensions: JobReadinessDimension[] = [
    appointmentDimension(order, appointments),
    assignmentDimension(order),
    scopeResult.complete
      ? { id: 'scope', label: 'Exact HVAC Scope', status: 'ready', reason: scopeResult.reason, source: scope?.workOrderId ?? order.id }
      : { id: 'scope', label: 'Exact HVAC Scope', status: 'blocked', reason: scopeResult.reason, source: order.id },
    { id: 'materials', label: 'Materials', status: materials.status, reason: materials.reason, source: `Material plan: ${materials.planState}` },
    { id: 'crew_skill', label: 'Crew & Required Skill', status: crewSkill.status, reason: crewSkill.reason, source: crewSkill.source },
    manualDimension('tools', 'Required Tools', manual.tools, manual.updatedBy),
    manualDimension('site_access', 'Site Access', manual.siteAccess, manual.updatedBy),
    manualDimension('commercial', 'Commercial Clearance', manual.commercialClearance, manual.updatedBy),
  ];

  const blockers = dimensions.filter((dimension) => dimension.status === 'blocked');
  const risks = dimensions.filter((dimension) => dimension.status === 'at_risk');
  return {
    workOrderId: order.id,
    status: blockers.length ? 'blocked' : risks.length ? 'at_risk' : 'ready',
    dimensions,
    blockers,
    risks,
    calculatedAt: new Date().toISOString(),
  };
}

export function readinessRiskSignature(readiness: BrowserJobReadiness) {
  return readiness.risks
    .map((risk) => `${risk.id}:${risk.reason}`)
    .sort()
    .join('|');
}

export function loadDispatchAtRiskReleases() {
  return loadBrowserValue<BrowserDispatchAtRiskRelease[]>(BROWSER_DISPATCH_RELEASES_KEY, []);
}

export function createDispatchAtRiskRelease(readiness: BrowserJobReadiness, reason: string, authorizedBy = 'Operations / Preview') {
  if (readiness.status !== 'at_risk') throw new Error('Only AT RISK Work Orders can receive a dispatch release. READY needs no release and BLOCKED cannot be overridden here.');
  const trimmed = reason.trim();
  if (trimmed.length < 8) throw new Error('Enter a meaningful release reason of at least 8 characters.');
  const release: BrowserDispatchAtRiskRelease = {
    id: `REL-${readiness.workOrderId}-${Date.now().toString().slice(-8)}`,
    workOrderId: readiness.workOrderId,
    riskSignature: readinessRiskSignature(readiness),
    reason: trimmed,
    authorizedBy,
    authorizedAt: new Date().toISOString(),
  };
  const current = loadDispatchAtRiskReleases();
  saveBrowserValue(BROWSER_DISPATCH_RELEASES_KEY, [release, ...current]);
  return release;
}

export function validDispatchAtRiskRelease(readiness: BrowserJobReadiness, releases = loadDispatchAtRiskReleases()) {
  if (readiness.status !== 'at_risk') return undefined;
  const latestForWorkOrder = releases.find((release) => release.workOrderId === readiness.workOrderId);
  if (!latestForWorkOrder) return undefined;
  return latestForWorkOrder.riskSignature === readinessRiskSignature(readiness) ? latestForWorkOrder : undefined;
}

export function fieldStartDecision(readiness: BrowserJobReadiness, releases = loadDispatchAtRiskReleases()) {
  if (readiness.status === 'ready') return { allowed: true, mode: 'ready' as const, release: undefined, reason: 'All consolidated readiness dimensions are READY.' };
  if (readiness.status === 'blocked') return { allowed: false, mode: 'blocked' as const, release: undefined, reason: readiness.blockers[0]?.reason ?? 'A hard readiness blocker exists.' };
  const release = validDispatchAtRiskRelease(readiness, releases);
  if (release) return { allowed: true, mode: 'released_at_risk' as const, release, reason: `Operations authorized AT RISK start: ${release.reason}` };
  return { allowed: false, mode: 'at_risk_hold' as const, release: undefined, reason: readiness.risks[0]?.reason ?? 'AT RISK Work Order needs Operations release before Field start.' };
}
