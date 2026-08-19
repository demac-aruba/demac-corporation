import type { BrowserAppointmentRecord, BrowserWorkOrderRecord } from './browser-operational';
import type { BrowserFieldExecutionRecord } from './browser-field';
import { browserKeys, loadBrowserValue, saveBrowserValue } from './browser-store';
import { loadWorkOrderScopes, scopeStatus } from './browser-workorder-scope';
import { deriveWorkOrderMaterialReadiness, loadWorkOrderMaterialPlans } from './browser-workorder-materials';
import { deriveCrewSkillReadiness, type WorkforceEmployee } from './workforce-readiness';
import { loadBrowserWorkforce } from './browser-workforce';
import { deriveRequiredToolsReadiness } from './browser-tools';
import { deriveSiteAccessReadiness } from './browser-site-access';
import { deriveCommercialClearanceReadiness } from './browser-commercial-clearance';

export const BROWSER_DISPATCH_RELEASES_KEY = 'demac.erp-next.operations.dispatch-at-risk-releases.v1';

export type JobReadinessStatus = 'ready' | 'at_risk' | 'blocked';

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
  appointments?: BrowserAppointmentRecord[];
  executions?: BrowserFieldExecutionRecord[];
  crewRoster?: WorkforceEmployee[];
}): BrowserJobReadiness {
  const appointments = options?.appointments ?? loadBrowserValue<BrowserAppointmentRecord[]>(browserKeys.appointments, []);
  const scope = loadWorkOrderScopes().find((item) => item.workOrderId === order.id);
  const scopeResult = scopeStatus(order, scope);
  const materials = deriveWorkOrderMaterialReadiness(order, { plans: loadWorkOrderMaterialPlans(), executions: options?.executions });
  // Compatibility fallback remains for isolated preview callers. The active Work Orders UI
  // supplies a date-aware canonical Firestore roster explicitly.
  const crewSkill = deriveCrewSkillReadiness(order, options?.crewRoster ?? loadBrowserWorkforce());
  const requiredTools = deriveRequiredToolsReadiness(order);
  const siteAccess = deriveSiteAccessReadiness(order);
  const commercial = deriveCommercialClearanceReadiness(order);

  const dimensions: JobReadinessDimension[] = [
    appointmentDimension(order, appointments),
    assignmentDimension(order),
    scopeResult.complete
      ? { id: 'scope', label: 'Exact HVAC Scope', status: 'ready', reason: scopeResult.reason, source: scope?.workOrderId ?? order.id }
      : { id: 'scope', label: 'Exact HVAC Scope', status: 'blocked', reason: scopeResult.reason, source: order.id },
    { id: 'materials', label: 'Materials', status: materials.status, reason: materials.reason, source: `Material plan: ${materials.planState}` },
    { id: 'crew_skill', label: 'Crew & Required Skill', status: crewSkill.status, reason: crewSkill.reason, source: crewSkill.source },
    { id: 'tools', label: 'Required Tools', status: requiredTools.status, reason: requiredTools.reason, source: requiredTools.source },
    { id: 'site_access', label: 'Site Access', status: siteAccess.status, reason: siteAccess.reason, source: siteAccess.source },
    { id: 'commercial', label: 'Commercial Clearance', status: commercial.status, reason: commercial.reason, source: commercial.source },
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
