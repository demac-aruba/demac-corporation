export const FIELD_AUTHORITY_API_VERSION = 1 as const;

/**
 * Versioned transport vocabulary mirrored by the Field Operations server.
 * This is not an authorization decision table: the server remains the sole authority that
 * chooses which actions appear for a principal/assignment. If this wire vocabulary changes,
 * the API version must change with it so older clients fail closed instead of guessing.
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

const FIELD_PREPARE_SOURCES = ['field_authority', 'legacy_existing'] as const;
export type FieldPrepareSource = (typeof FIELD_PREPARE_SOURCES)[number];

export type FieldPlannedWork = {
  id: string;
  serviceId?: string;
  presetId?: string;
  label: string;
  quantity: number;
  durationMinutes?: number;
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

export type FieldJobDetail = FieldScheduleJob & { knownEquipment: FieldKnownEquipment[] };
export type FieldScheduleResponse = { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; jobs: FieldScheduleJob[] };
export type FieldJobResponse = { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; job: FieldJobDetail };
export type FieldPrepareVisitResponse = {
  success: true;
  version: typeof FIELD_AUTHORITY_API_VERSION;
  replayed: boolean;
  source: FieldPrepareSource;
  visit: FieldPreparedVisit;
  allowedActions: FieldAllowedAction[];
  auditEventId?: string;
};

const RESPONSIBILITIES = new Set<string>(FIELD_RESPONSIBILITIES);
const ASSIGNMENT_SOURCES = new Set<string>(FIELD_ASSIGNMENT_SOURCES);
const ALLOWED_ACTIONS = new Set<string>(FIELD_ALLOWED_ACTIONS);
const VISIT_STATUSES = new Set<string>(FIELD_VISIT_STATUSES);
const PREPARE_SOURCES = new Set<string>(FIELD_PREPARE_SOURCES);

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

function allowedActionsValid(value: unknown): value is FieldAllowedAction[] {
  return Array.isArray(value) && value.every((action) => string(action) && ALLOWED_ACTIONS.has(action));
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
    && optionalString(job.assignmentRole);
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
    && optionalString(visit.submittedAt)
    && optionalString(visit.completedAt)
    && typeof visit.requiresSecondVisit === 'boolean'
    && optionalString(visit.secondVisitReason)
    && optionalString(visit.previousVisitId)
    && string(visit.createdAt)
    && string(visit.createdBy)
    && string(visit.updatedAt)
    && string(visit.updatedBy)
    && typeof visit.version === 'number'
    && Number.isFinite(visit.version)
    && visit.version >= 1;
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
  return payload as FieldJobResponse;
}

export function parseFieldPrepareVisitResponse(value: unknown): FieldPrepareVisitResponse {
  const payload = envelope(value);
  if (typeof payload.replayed !== 'boolean'
    || !string(payload.source)
    || !PREPARE_SOURCES.has(payload.source)
    || !preparedVisitValid(payload.visit)
    || !allowedActionsValid(payload.allowedActions)
    || !optionalString(payload.auditEventId)) {
    throw new Error('Field Operations returned malformed visit preparation data. Refresh and try again.');
  }
  return payload as FieldPrepareVisitResponse;
}
