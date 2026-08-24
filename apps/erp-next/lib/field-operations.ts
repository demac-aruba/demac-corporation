import type { AuditEventInput } from './persistence';
import type {
  FieldApproval,
  FieldSaleLine,
  FieldSaleLineStatus,
  PlannedWorkDisposition,
  PlannedWorkLineSnapshot,
  ScheduledScopeSnapshot,
  ScopeChange,
  VisitAsset,
  WorkIntervention,
  WorkInterventionStatus,
  WorkVisit,
  WorkVisitStatus,
} from './field-operations-domain';

export type FieldDomainActor = {
  userId: string;
  role: string;
  staffId?: string;
  correlationId?: string;
};

export type FieldStartContext = {
  workOrderAuthorized: boolean;
  assignmentAuthorized: boolean;
  customerId?: string;
  propertyId?: string;
  safetyBlockers?: string[];
};

export type GateResult = {
  allowed: boolean;
  blockers: string[];
};

export type PlannedScopeReconciliation = {
  plannedWorkLineId: string;
  plannedQuantity: number;
  linkedActualQuantity: number;
  dispositionQuantity: number;
  remainingQuantity: number;
  overLinkedQuantity: number;
};

export type FieldTransitionResult<T> = {
  next: T;
  audit: AuditEventInput;
};

const visitTransitions: Record<WorkVisitStatus, readonly WorkVisitStatus[]> = {
  scheduled: ['en_route', 'no_access', 'cancelled'],
  en_route: ['on_site', 'pending', 'no_access', 'cancelled'],
  on_site: ['in_progress', 'pending', 'requires_return_visit', 'no_access', 'cancelled'],
  in_progress: ['pending', 'requires_return_visit', 'ready_for_office_review', 'cancelled'],
  pending: ['in_progress', 'requires_return_visit', 'ready_for_office_review', 'cancelled'],
  requires_return_visit: ['in_progress', 'ready_for_office_review', 'cancelled'],
  ready_for_office_review: ['in_progress', 'completed'],
  completed: [],
  no_access: [],
  cancelled: [],
};

const interventionTransitions: Record<WorkInterventionStatus, readonly WorkInterventionStatus[]> = {
  planned: ['confirmed', 'not_performed', 'cancelled'],
  confirmed: ['in_progress', 'pending_authorization', 'declined', 'cancelled'],
  in_progress: ['completed', 'pending_part', 'not_performed', 'cancelled'],
  pending_authorization: ['confirmed', 'declined', 'cancelled'],
  pending_part: ['in_progress', 'completed', 'cancelled'],
  not_performed: [],
  declined: [],
  cancelled: [],
  completed: [],
};

const saleLineTransitions: Record<FieldSaleLineStatus, readonly FieldSaleLineStatus[]> = {
  proposed: ['customer_approved', 'declined', 'voided'],
  customer_approved: ['installed', 'delivered', 'sold', 'voided'],
  installed: ['sold', 'voided'],
  delivered: ['sold', 'voided'],
  sold: [],
  declined: [],
  voided: [],
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function transitionAudit<T extends { id: string }>(args: {
  actor: FieldDomainActor;
  action: string;
  entityType: string;
  before: T;
  after: T;
  occurredAt: string;
  reason?: string;
}): AuditEventInput {
  return {
    actorId: args.actor.userId,
    actorRole: args.actor.role,
    action: args.action,
    entityType: args.entityType,
    entityId: args.before.id,
    module: 'field_operations',
    correlationId: args.actor.correlationId,
    before: args.before,
    after: args.after,
    reason: args.reason,
    occurredAt: args.occurredAt,
  };
}

function assertAllowedTransition<T extends string>(current: T, next: T, map: Record<T, readonly T[]>, entity: string) {
  if (current === next) return;
  if (!map[current].includes(next)) {
    throw new Error(`Invalid ${entity} transition: ${current} -> ${next}.`);
  }
}

export function canStartWorkVisit(context: FieldStartContext): GateResult {
  const blockers: string[] = [];
  if (!context.workOrderAuthorized) blockers.push('Work Order is not authorized/released for field execution.');
  if (!context.assignmentAuthorized) blockers.push('Current field principal is not assigned to this Work Order.');
  if (!context.customerId) blockers.push('Work Order has no canonical Customer reference.');
  if (!context.propertyId) blockers.push('Work Order has no canonical Property reference.');
  blockers.push(...(context.safetyBlockers ?? []).filter(Boolean));
  return { allowed: blockers.length === 0, blockers: unique(blockers) };
}

export function createScheduledScopeSnapshot(args: {
  appointmentId: string;
  capturedAt: string;
  estimatedUnitCount: number;
  workLines: PlannedWorkLineSnapshot[];
  customerFacingDescription?: string;
  technicianInstructions?: string;
}): ScheduledScopeSnapshot {
  if (!args.appointmentId.trim()) throw new Error('Scheduled scope snapshot requires an Appointment id.');
  if (!Number.isInteger(args.estimatedUnitCount) || args.estimatedUnitCount < 0) throw new Error('Estimated unit count must be a non-negative integer.');
  for (const line of args.workLines) {
    if (!line.id.trim()) throw new Error('Every planned work line snapshot requires an id.');
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) throw new Error(`Planned work line ${line.id} requires a positive integer quantity.`);
  }
  return {
    appointmentId: args.appointmentId,
    capturedAt: args.capturedAt,
    estimatedUnitCount: args.estimatedUnitCount,
    workLines: args.workLines.map((line) => ({ ...line })),
    customerFacingDescription: args.customerFacingDescription,
    technicianInstructions: args.technicianInstructions,
  };
}

export function transitionWorkVisit(args: {
  visit: WorkVisit;
  to: WorkVisitStatus;
  actor: FieldDomainActor;
  at: string;
  reason?: string;
}): FieldTransitionResult<WorkVisit> {
  assertAllowedTransition(args.visit.status, args.to, visitTransitions, 'Work Visit');
  if (args.visit.status === args.to) {
    return {
      next: args.visit,
      audit: transitionAudit({ actor: args.actor, action: 'visit.status.noop', entityType: 'work_visit', before: args.visit, after: args.visit, occurredAt: args.at, reason: args.reason }),
    };
  }

  const next: WorkVisit = {
    ...args.visit,
    status: args.to,
    updatedAt: args.at,
    updatedBy: args.actor.userId,
    ...(args.to === 'en_route' && !args.visit.departedAt ? { departedAt: args.at } : {}),
    ...(args.to === 'on_site' && !args.visit.arrivedAt ? { arrivedAt: args.at } : {}),
    ...(args.to === 'in_progress' && !args.visit.startedAt ? { startedAt: args.at } : {}),
    ...(args.to === 'ready_for_office_review' ? { submittedAt: args.at } : {}),
    ...(args.to === 'completed' ? { completedAt: args.at } : {}),
    ...(args.to === 'requires_return_visit' ? { requiresSecondVisit: true } : {}),
  };
  return {
    next,
    audit: transitionAudit({ actor: args.actor, action: `visit.status.${args.to}`, entityType: 'work_visit', before: args.visit, after: next, occurredAt: args.at, reason: args.reason }),
  };
}

export function transitionWorkIntervention(args: {
  intervention: WorkIntervention;
  to: WorkInterventionStatus;
  actor: FieldDomainActor;
  at: string;
  reason?: string;
}): FieldTransitionResult<WorkIntervention> {
  assertAllowedTransition(args.intervention.status, args.to, interventionTransitions, 'Work Intervention');
  if (args.intervention.status === args.to) {
    return {
      next: args.intervention,
      audit: transitionAudit({ actor: args.actor, action: 'intervention.status.noop', entityType: 'work_intervention', before: args.intervention, after: args.intervention, occurredAt: args.at, reason: args.reason }),
    };
  }
  const next: WorkIntervention = {
    ...args.intervention,
    status: args.to,
    updatedAt: args.at,
    updatedBy: args.actor.userId,
    ...(args.to === 'in_progress' && !args.intervention.startedAt ? { startedAt: args.at } : {}),
    ...(args.to === 'completed' ? { completedAt: args.at } : {}),
  };
  return {
    next,
    audit: transitionAudit({ actor: args.actor, action: `intervention.status.${args.to}`, entityType: 'work_intervention', before: args.intervention, after: next, occurredAt: args.at, reason: args.reason }),
  };
}

export function transitionFieldSaleLine(args: {
  line: FieldSaleLine;
  to: FieldSaleLineStatus;
  actor: FieldDomainActor;
  at: string;
  reason?: string;
}): FieldTransitionResult<FieldSaleLine> {
  assertAllowedTransition(args.line.status, args.to, saleLineTransitions, 'Field Sale Line');
  if (args.line.status === args.to) {
    return {
      next: args.line,
      audit: transitionAudit({ actor: args.actor, action: 'sale_line.status.noop', entityType: 'field_sale_line', before: args.line, after: args.line, occurredAt: args.at, reason: args.reason }),
    };
  }
  const next: FieldSaleLine = {
    ...args.line,
    status: args.to,
    updatedAt: args.at,
    updatedBy: args.actor.userId,
  };
  return {
    next,
    audit: transitionAudit({ actor: args.actor, action: `sale_line.status.${args.to}`, entityType: 'field_sale_line', before: args.line, after: next, occurredAt: args.at, reason: args.reason }),
  };
}

export function reconcilePlannedScope(args: {
  snapshot: ScheduledScopeSnapshot;
  interventions: WorkIntervention[];
  dispositions: PlannedWorkDisposition[];
}): PlannedScopeReconciliation[] {
  return args.snapshot.workLines.map((line) => {
    const linkedActualQuantity = args.interventions.filter((intervention) => (
      intervention.plannedWorkLineId === line.id
      && !['cancelled', 'declined', 'not_performed'].includes(intervention.status)
    )).length;
    const dispositionQuantity = args.dispositions
      .filter((disposition) => disposition.plannedWorkLineId === line.id)
      .reduce((total, disposition) => total + disposition.quantity, 0);
    const covered = linkedActualQuantity + dispositionQuantity;
    return {
      plannedWorkLineId: line.id,
      plannedQuantity: line.quantity,
      linkedActualQuantity,
      dispositionQuantity,
      remainingQuantity: Math.max(0, line.quantity - covered),
      overLinkedQuantity: Math.max(0, covered - line.quantity),
    };
  });
}

function approvalForSaleLine(line: FieldSaleLine, approvals: FieldApproval[]) {
  if (!line.requiresCustomerApproval) return true;
  return approvals.some((approval) => (
    approval.visitId === line.visitId
    && approval.status === 'approved'
    && approval.affected.some((reference) => reference.type === 'sale_line' && reference.id === line.id)
  ));
}

function approvalForIntervention(intervention: WorkIntervention, approvals: FieldApproval[]) {
  if (intervention.status !== 'pending_authorization') return true;
  return approvals.some((approval) => (
    approval.visitId === intervention.visitId
    && approval.status === 'approved'
    && approval.affected.some((reference) => reference.type === 'intervention' && reference.id === intervention.id)
  ));
}

export function validateVisitForOfficeReview(args: {
  visit: WorkVisit;
  visitAssets: VisitAsset[];
  interventions: WorkIntervention[];
  scopeChanges: ScopeChange[];
  dispositions: PlannedWorkDisposition[];
  approvals: FieldApproval[];
  saleLines: FieldSaleLine[];
}): GateResult {
  const blockers: string[] = [];
  const activeVisitStatuses: WorkVisitStatus[] = ['in_progress', 'pending', 'requires_return_visit'];
  if (!activeVisitStatuses.includes(args.visit.status)) blockers.push(`Visit status ${args.visit.status} cannot be submitted to Office Review.`);

  const visitAssets = args.visitAssets.filter((asset) => asset.visitId === args.visit.id);
  const assetById = new Map(visitAssets.map((asset) => [asset.id, asset]));
  const interventions = args.interventions.filter((intervention) => intervention.visitId === args.visit.id);
  const scopeChanges = args.scopeChanges.filter((change) => change.visitId === args.visit.id);
  const scopeChangeIds = new Set(scopeChanges.map((change) => change.id));
  const dispositions = args.dispositions.filter((disposition) => disposition.visitId === args.visit.id);
  const approvals = args.approvals.filter((approval) => approval.visitId === args.visit.id);
  const saleLines = args.saleLines.filter((line) => line.visitId === args.visit.id);

  for (const asset of visitAssets) {
    if (!asset.assetId) blockers.push(`Visit Asset ${asset.id} is not resolved to a canonical CRM Asset.`);
    if (!asset.locationLabel.trim()) blockers.push(`Visit Asset ${asset.id} requires a location label.`);
  }

  const unfinishedStatuses: WorkInterventionStatus[] = ['planned', 'confirmed', 'in_progress', 'pending_authorization'];
  for (const intervention of interventions) {
    const visitAsset = assetById.get(intervention.visitAssetId);
    if (!visitAsset) {
      blockers.push(`Intervention ${intervention.id} references Visit Asset ${intervention.visitAssetId}, which is not part of this visit.`);
      continue;
    }
    if (!visitAsset.assetId) blockers.push(`Intervention ${intervention.id} cannot be finalized until its Visit Asset resolves to a canonical Asset.`);
    if (intervention.assetId && visitAsset.assetId && intervention.assetId !== visitAsset.assetId) blockers.push(`Intervention ${intervention.id} Asset does not match Visit Asset ${visitAsset.id}.`);
    if (!intervention.serviceCatalogItemId) blockers.push(`Intervention ${intervention.id} requires a canonical Service Catalog item.`);
    if (unfinishedStatuses.includes(intervention.status)) blockers.push(`Intervention ${intervention.id} is still ${intervention.status}.`);
    if (intervention.origin === 'planned' && !intervention.plannedWorkLineId) blockers.push(`Planned intervention ${intervention.id} must reference its planned work line.`);
    if (intervention.origin !== 'planned' && !intervention.scopeChangeId) blockers.push(`Additional intervention ${intervention.id} requires explicit Scope Change context.`);
    if (intervention.scopeChangeId && !scopeChangeIds.has(intervention.scopeChangeId)) blockers.push(`Intervention ${intervention.id} references missing Scope Change ${intervention.scopeChangeId}.`);
    if (!approvalForIntervention(intervention, approvals)) blockers.push(`Intervention ${intervention.id} still requires customer approval.`);
  }

  for (const disposition of dispositions) {
    if (!Number.isInteger(disposition.quantity) || disposition.quantity <= 0) blockers.push(`Planned Work Disposition ${disposition.id} requires a positive integer quantity.`);
  }

  const reconciliation = reconcilePlannedScope({
    snapshot: args.visit.scheduledScopeSnapshot,
    interventions,
    dispositions,
  });
  for (const item of reconciliation) {
    if (item.remainingQuantity > 0) blockers.push(`Planned Work Line ${item.plannedWorkLineId} has ${item.remainingQuantity} unreconciled unit(s).`);
    if (item.overLinkedQuantity > 0) blockers.push(`Planned Work Line ${item.plannedWorkLineId} is over-linked by ${item.overLinkedQuantity} unit(s); additional work must be recorded as added-on-site scope.`);
  }

  const validPlannedIds = new Set(args.visit.scheduledScopeSnapshot.workLines.map((line) => line.id));
  for (const intervention of interventions) {
    if (intervention.plannedWorkLineId && !validPlannedIds.has(intervention.plannedWorkLineId)) blockers.push(`Intervention ${intervention.id} references unknown planned work line ${intervention.plannedWorkLineId}.`);
  }
  for (const disposition of dispositions) {
    if (!validPlannedIds.has(disposition.plannedWorkLineId)) blockers.push(`Disposition ${disposition.id} references unknown planned work line ${disposition.plannedWorkLineId}.`);
  }

  const hasPendingPart = interventions.some((intervention) => intervention.status === 'pending_part');
  if (hasPendingPart && !args.visit.requiresSecondVisit) blockers.push('Pending-part interventions require the visit to record a second-visit requirement.');
  if (args.visit.requiresSecondVisit && !args.visit.secondVisitReason?.trim()) blockers.push('Second visit is required but no reason is recorded.');

  for (const line of saleLines) {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) blockers.push(`Field Sale Line ${line.id} requires quantity greater than zero.`);
    if (line.nonCatalog) {
      if (line.catalogItemId) blockers.push(`Non-catalog Field Sale Line ${line.id} must not create/reference a permanent catalog item.`);
      if (!line.officeReviewRequired) blockers.push(`Non-catalog Field Sale Line ${line.id} must require Office Review.`);
    } else if (!line.catalogItemId) {
      blockers.push(`Catalog Field Sale Line ${line.id} requires a canonical catalog item.`);
    }
    if (line.requiresCustomerApproval && ['customer_approved', 'installed', 'delivered', 'sold'].includes(line.status) && !approvalForSaleLine(line, approvals)) {
      blockers.push(`Field Sale Line ${line.id} has no approved customer approval covering the line.`);
    }
  }

  return { allowed: blockers.length === 0, blockers: unique(blockers) };
}

export function plannedVsActualSummary(args: {
  visit: WorkVisit;
  interventions: WorkIntervention[];
  saleLines?: FieldSaleLine[];
}) {
  const plannedQuantity = args.visit.scheduledScopeSnapshot.workLines.reduce((total, line) => total + line.quantity, 0);
  const interventions = args.interventions.filter((item) => item.visitId === args.visit.id && !['cancelled', 'declined'].includes(item.status));
  const completedInterventions = interventions.filter((item) => item.status === 'completed');
  const addedOnSiteInterventions = interventions.filter((item) => item.origin !== 'planned');
  const saleLines = (args.saleLines ?? []).filter((line) => line.visitId === args.visit.id && !['declined', 'voided'].includes(line.status));
  return {
    plannedQuantity,
    actualInterventionCount: interventions.length,
    completedInterventionCount: completedInterventions.length,
    addedOnSiteInterventionCount: addedOnSiteInterventions.length,
    activeSaleLineCount: saleLines.length,
  };
}

export type BillingCandidateLine = {
  sourceType: 'intervention' | 'sale_line';
  sourceId: string;
  catalogItemId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  lineTotal: number;
};

/**
 * Safe billing handoff projection. This never creates an Invoice. It projects only completed
 * priced interventions and sold catalog-backed field lines from actual field truth.
 */
export function buildBillingCandidateLines(args: {
  visitId: string;
  interventions: WorkIntervention[];
  saleLines: FieldSaleLine[];
}): BillingCandidateLine[] {
  const interventionLines = args.interventions
    .filter((item) => item.visitId === args.visitId && item.status === 'completed' && item.priceSnapshot)
    .map((item): BillingCandidateLine => ({
      sourceType: 'intervention',
      sourceId: item.id,
      catalogItemId: item.serviceCatalogItemId,
      description: item.interventionType,
      quantity: 1,
      unitPrice: item.priceSnapshot!.unitPrice,
      currency: item.priceSnapshot!.currency,
      lineTotal: item.priceSnapshot!.lineTotal ?? Math.max(0, item.priceSnapshot!.unitPrice - (item.priceSnapshot!.discountAmount ?? 0) + (item.priceSnapshot!.taxAmount ?? 0)),
    }));
  const saleLines = args.saleLines
    .filter((line) => line.visitId === args.visitId && line.status === 'sold' && !line.nonCatalog && line.catalogItemId && line.priceSnapshot)
    .map((line): BillingCandidateLine => ({
      sourceType: 'sale_line',
      sourceId: line.id,
      catalogItemId: line.catalogItemId!,
      description: line.descriptionSnapshot,
      quantity: line.quantity,
      unitPrice: line.priceSnapshot!.unitPrice,
      currency: line.priceSnapshot!.currency,
      lineTotal: line.priceSnapshot!.lineTotal ?? Math.max(0, line.quantity * line.priceSnapshot!.unitPrice - (line.priceSnapshot!.discountAmount ?? 0) + (line.priceSnapshot!.taxAmount ?? 0)),
    }));
  return [...interventionLines, ...saleLines];
}
