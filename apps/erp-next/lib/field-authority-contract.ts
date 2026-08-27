export const FIELD_AUTHORITY_API_VERSION = 1 as const;

/**
 * Versioned transport vocabulary mirrored by the Field Operations server.
 * This is not an authorization decision table: the server remains the sole authority that
 * chooses which actions and transitions appear for a principal/assignment. Incompatible wire
 * changes must bump the API version so older clients fail closed instead of guessing.
 */
export const FIELD_ALLOWED_ACTIONS = [
  'read',
  'execute',
  'report.edit',
  'evidence.add',
  'measurement.add',
  'finding.add',
  'asset.add',
  'intervention.add',
  'sale.propose',
  'intervention.complete',
  'visit.complete',
  'office.review',
  'price.override',
] as const;
export type FieldAllowedAction = (typeof FIELD_ALLOWED_ACTIONS)[number];

const FIELD_RESPONSIBILITIES = ['lead', 'technician', 'helper', 'office'] as const;
export type FieldResponsibility = (typeof FIELD_RESPONSIBILITIES)[number];

const FIELD_ASSIGNMENT_SOURCES = ['office', 'daily_assignment', 'regular_crew', 'direct_staff', 'profile_van_fallback'] as const;
export type FieldAssignmentSource = (typeof FIELD_ASSIGNMENT_SOURCES)[number];

const FIELD_VISIT_STATUSES = [
  'scheduled',
  'en_route',
  'on_site',
  'in_progress',
  'pending',
  'requires_return_visit',
  'ready_for_office_review',
  'completed',
  'no_access',
  'cancelled',
] as const;
export type FieldVisitStatus = (typeof FIELD_VISIT_STATUSES)[number];

const FIELD_ACTIVE_VISIT_TRANSITIONS = ['en_route', 'on_site', 'in_progress', 'pending', 'no_access'] as const;
export type FieldActiveVisitTransition = (typeof FIELD_ACTIVE_VISIT_TRANSITIONS)[number];

const FIELD_PREPARE_SOURCES = ['field_authority', 'legacy_existing'] as const;
export type FieldPrepareSource = (typeof FIELD_PREPARE_SOURCES)[number];

const FIELD_VISIT_ASSET_SOURCES = ['scheduled', 'existing_asset', 'qr_scan', 'registered_on_site'] as const;
export type FieldVisitAssetSource = (typeof FIELD_VISIT_ASSET_SOURCES)[number];

const FIELD_VISIT_ASSET_STATUSES = ['identified', 'in_progress', 'completed', 'pending', 'not_performed'] as const;
export type FieldVisitAssetStatus = (typeof FIELD_VISIT_ASSET_STATUSES)[number];

export type FieldPlannedWork = {
  id: string;
  serviceId?: string;
  presetId?: string;
  label: string;
  quantity: number;
  durationMinutes?: number;
};

export type FieldKnownEquipment = {
  id: string;
  qrCode?: string;
  locationLabel?: string;
  systemType?: string;
  brand?: string;
  model?: string;
  serial?: string;
  btu?: number | string | null;
  refrigerant?: string;
  voltage?: string;
  condition?: string;
  active: boolean;
};

export type FieldVisitAsset = {
  id: string;
  visitId: string;
  assetId: string;
  sequence: number;
  locationLabel: string;
  source: FieldVisitAssetSource;
  status: FieldVisitAssetStatus;
  addedOnSite: boolean;
  addedReason?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldScheduledScopeSnapshot = {
  appointmentId: string;
  capturedAt: string;
  estimatedUnitCount: number;
  workLines: FieldPlannedWork[];
  customerFacingDescription?: string;
  technicianInstructions?: string;
};

export type FieldPreparedVisit = {
  id: string;
  appointmentId: string;
  workOrderId: string;
  customerId: string;
  propertyId: string;
  scheduledScopeSnapshot: FieldScheduledScopeSnapshot;
  status: FieldVisitStatus;
  leadTechnicianStaffId?: string;
  participatingStaffIds: string[];
  departedAt?: string;
  arrivedAt?: string;
  startedAt?: string;
  pendingAt?: string;
  pendingReason?: string;
  pendingAction?: string;
  resumedAt?: string;
  noAccessAt?: string;
  noAccessReason?: string;
  submittedAt?: string;
  completedAt?: string;
  requiresSecondVisit: boolean;
  secondVisitReason?: string;
  previousVisitId?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
};

export type FieldVisitState = FieldPreparedVisit & {
  availableTransitions: FieldActiveVisitTransition[];
};

export type FieldScheduleJob = {
  id: string;
  workOrderId: string;
  appointmentId: string;
  date: string;
  time: string;
  endTime?: string;
  status: string;
  customerId: string;
  customerName: string;
  propertyId: string;
  propertyName?: string;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  arrivalPhone?: string;
  arrivalWhatsapp?: string;
  accessInstructions?: string;
  customerFacingDescription?: string;
  technicianInstructions?: string;
  plannedWork: FieldPlannedWork[];
  estimatedQuantity: number;
  vanId: string;
  responsibility: FieldResponsibility;
  assignmentSource: FieldAssignmentSource;
  allowedActions: FieldAllowedAction[];
  assignmentRole?: string;
  fieldVisit: FieldVisitState | null;
  canPrepareVisit: boolean;
};

export type FieldJobDetail = FieldScheduleJob & {
  knownEquipment: FieldKnownEquipment[];
  visitAssets: FieldVisitAsset[];
  canAddExistingAsset: boolean;
};
export type FieldScheduleResponse = { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; jobs: FieldScheduleJob[] };
export type FieldJobResponse = { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; job: FieldJobDetail };
export type FieldPrepareVisitResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  source: FieldPrepareSource;
  visit: FieldVisitState;
  allowedActions: FieldAllowedAction[];
  auditEventId?: string;
};
export type FieldTransitionVisitResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  visit: FieldVisitState;
  allowedActions: FieldAllowedAction[];
  auditEventId?: string;
};
export type FieldAttachVisitAssetResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  visitAsset: FieldVisitAsset;
  allowedActions: FieldAllowedAction[];
  auditEventId?: string;
};

const RESPONSIBILITIES = new Set<string>(FIELD_RESPONSIBILITIES);
const ASSIGNMENT_SOURCES = new Set<string>(FIELD_ASSIGNMENT_SOURCES);
const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);
const VISIT_STATUSES = new Set<string>(FIELD_VISIT_STATUSES);
const ACTIVE_VISIT_TRANSITIONS = new Set<string>(FIELD_ACTIVE_VISIT_TRANSITIONS);
const PREPARE_SOURCES = new Set<string>(FIELD_PREPARE_SOURCES);
const VISIT_ASSET_SOURCES = new Set<string>(FIELD_VISIT_ASSET_SOURCES);
const VISIT_ASSET_STATUSES = new Set<string>(FIELD_VISIT_ASSET_STATUSES);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function string(value: unknown) {
  return typeof value === 'string';
}

function optionalString(value: unknown) {
  return value === undefined || typeof value === 'string';
}

function optionalFiniteNumber(value: unknown) {
  return value === undefined || value === null || (typeof value === 'number' && Number.isFinite(value));
}

function positiveSafeInteger(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value) && value.every((action) => string(action) && ALLOWED_ACTIONS.has(action));
}

function activeVisitTransitionsValid(value: unknown): value is FieldActiveVisitTransition[] {
  return Array.isArray(value) && value.every((transition) => string(transition) && ACTIVE_VISIT_TRANSITIONS.has(transition));
}

function plannedWorkValid(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.every((candidate) => {
    const item = record(candidate);
    return Boolean(item)
      && string(item!.id)
      && string(item!.label)
      && typeof item!.quantity === 'number'
      && Number.isFinite(item!.quantity)
      && item!.quantity >= 0
      && optionalString(item!.serviceId)
      && optionalString(item!.presetId)
      && (item!.durationMinutes === undefined || (typeof item!.durationMinutes === 'number' && Number.isFinite(item!.durationMinutes) && item!.durationMinutes >= 0));
  });
}

function preparedVisitValid(value: unknown): value is FieldPreparedVisit {
  const visit = record(value);
  if (!visit) return false;
  const snapshot = record(visit.scheduledScopeSnapshot);
  return string(visit.id)
    && string(visit.appointmentId)
    && string(visit.workOrderId)
    && string(visit.customerId)
    && string(visit.propertyId)
    && Boolean(snapshot)
    && string(snapshot!.appointmentId)
    && string(snapshot!.capturedAt)
    && typeof snapshot!.estimatedUnitCount === 'number'
    && Number.isFinite(snapshot!.estimatedUnitCount)
    && snapshot!.estimatedUnitCount >= 0
    && plannedWorkValid(snapshot!.workLines)
    && optionalString(snapshot!.customerFacingDescription)
    && optionalString(snapshot!.technicianInstructions)
    && string(visit.status)
    && VISIT_STATUSES.has(visit.status)
    && optionalString(visit.leadTechnicianStaffId)
    && Array.isArray(visit.participatingStaffIds)
    && visit.participatingStaffIds.every(string)
    && optionalString(visit.departedAt)
    && optionalString(visit.arrivedAt)
    && optionalString(visit.startedAt)
    && optionalString(visit.pendingAt)
    && optionalString(visit.pendingReason)
    && optionalString(visit.pendingAction)
    && optionalString(visit.resumedAt)
    && optionalString(visit.noAccessAt)
    && optionalString(visit.noAccessReason)
    && optionalString(visit.submittedAt)
    && optionalString(visit.completedAt)
    && typeof visit.requiresSecondVisit === 'boolean'
    && optionalString(visit.secondVisitReason)
    && optionalString(visit.previousVisitId)
    && string(visit.createdAt)
    && string(visit.createdBy)
    && string(visit.updatedAt)
    && string(visit.updatedBy)
    && positiveSafeInteger(visit.version);
}

function visitStateValid(value: unknown): value is FieldVisitState {
  const visit = record(value);
  return preparedVisitValid(value) && Boolean(visit) && activeVisitTransitionsValid(visit!.availableTransitions);
}

function scheduleJobValid(value: unknown): value is FieldScheduleJob {
  const job = record(value);
  if (!job) return false;
  return string(job.id)
    && string(job.workOrderId)
    && string(job.appointmentId)
    && string(job.date)
    && string(job.time)
    && optionalString(job.endTime)
    && string(job.status)
    && string(job.customerId)
    && string(job.customerName)
    && string(job.propertyId)
    && optionalString(job.propertyName)
    && string(job.address)
    && optionalFiniteNumber(job.latitude)
    && optionalFiniteNumber(job.longitude)
    && optionalString(job.arrivalPhone)
    && optionalString(job.arrivalWhatsapp)
    && optionalString(job.accessInstructions)
    && optionalString(job.customerFacingDescription)
    && optionalString(job.technicianInstructions)
    && plannedWorkValid(job.plannedWork)
    && typeof job.estimatedQuantity === 'number'
    && Number.isFinite(job.estimatedQuantity)
    && job.estimatedQuantity >= 0
    && string(job.vanId)
    && string(job.responsibility)
    && RESPONSIBILITIES.has(job.responsibility)
    && string(job.assignmentSource)
    && ASSIGNMENT_SOURCES.has(job.assignmentSource)
    && allowedActionsValid(job.allowedActions)
    && optionalString(job.assignmentRole)
    && (job.fieldVisit === null || visitStateValid(job.fieldVisit))
    && typeof job.canPrepareVisit === 'boolean';
}

function knownEquipmentValid(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.every((candidate) => {
    const equipment = record(candidate);
    return Boolean(equipment)
      && string(equipment!.id)
      && optionalString(equipment!.qrCode)
      && optionalString(equipment!.locationLabel)
      && optionalString(equipment!.systemType)
      && optionalString(equipment!.brand)
      && optionalString(equipment!.model)
      && optionalString(equipment!.serial)
      && (equipment!.btu === undefined || equipment!.btu === null || typeof equipment!.btu === 'string' || (typeof equipment!.btu === 'number' && Number.isFinite(equipment!.btu)))
      && optionalString(equipment!.refrigerant)
      && optionalString(equipment!.voltage)
      && optionalString(equipment!.condition)
      && typeof equipment!.active === 'boolean';
  });
}

function visitAssetValid(value: unknown): value is FieldVisitAsset {
  const asset = record(value);
  return Boolean(asset)
    && string(asset!.id)
    && string(asset!.visitId)
    && string(asset!.assetId)
    && positiveSafeInteger(asset!.sequence)
    && string(asset!.locationLabel)
    && string(asset!.source)
    && VISIT_ASSET_SOURCES.has(asset!.source as string)
    && string(asset!.status)
    && VISIT_ASSET_STATUSES.has(asset!.status as string)
    && typeof asset!.addedOnSite === 'boolean'
    && optionalString(asset!.addedReason)
    && string(asset!.createdAt)
    && string(asset!.createdBy)
    && string(asset!.updatedAt)
    && string(asset!.updatedBy)
    && positiveSafeInteger(asset!.version);
}

function visitAssetsValid(value: unknown): value is FieldVisitAsset[] {
  return Array.isArray(value) && value.every(visitAssetValid);
}

function envelope(value: unknown): Record<string, unknown> {
  const payload = record(value);
  if (!payload || payload.success !== true || payload.version !== FIELD_AUTHORITY_API_VERSION) {
    throw new Error('Field Operations returned an unsupported or malformed response. Refresh and try again.');
  }
  return payload;
}

export function parseFieldScheduleResponse(value: unknown): FieldScheduleResponse {
  const payload = envelope(value);
  if (!Array.isArray(payload.jobs) || !payload.jobs.every(scheduleJobValid)) {
    throw new Error('Field Operations returned malformed schedule data. Refresh and try again.');
  }
  return payload as FieldScheduleResponse;
}

export function parseFieldJobResponse(value: unknown): FieldJobResponse {
  const payload = envelope(value);
  if (!scheduleJobValid(payload.job)) {
    throw new Error('Field Operations returned malformed job data. Refresh and try again.');
  }
  const job = payload.job as unknown as Record<string, unknown>;
  if (!knownEquipmentValid(job.knownEquipment)) {
    throw new Error('Field Operations returned malformed equipment data. Refresh and try again.');
  }
  if (!visitAssetsValid(job.visitAssets) || typeof job.canAddExistingAsset !== 'boolean') {
    throw new Error('Field Operations returned malformed actual-scope data. Refresh and try again.');
  }
  return payload as FieldJobResponse;
}

export function parseFieldPrepareVisitResponse(value: unknown): FieldPrepareVisitResponse {
  const payload = envelope(value);
  if (typeof payload.replayed !== 'boolean'
    || !string(payload.source)
    || !PREPARE_SOURCES.has(payload.source)
    || !visitStateValid(payload.visit)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed visit preparation data. Refresh and try again.');
  }
  return payload as FieldPrepareVisitResponse;
}

export function parseFieldTransitionVisitResponse(value: unknown): FieldTransitionVisitResponse {
  const payload = envelope(value);
  if (typeof payload.replayed !== 'boolean'
    || !visitStateValid(payload.visit)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed visit transition data. Refresh and try again.');
  }
  return payload as FieldTransitionVisitResponse;
}

export function parseFieldAttachVisitAssetResponse(value: unknown): FieldAttachVisitAssetResponse {
  const payload = envelope(value);
  if (typeof payload.replayed !== 'boolean'
    || !visitAssetValid(payload.visitAsset)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed Visit Asset data. Refresh and try again.');
  }
  return payload as FieldAttachVisitAssetResponse;
}
