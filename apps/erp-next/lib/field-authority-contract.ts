import type { FieldAllowedAction } from './field-authorization';

export const FIELD_AUTHORITY_API_VERSION = 1 as const;

export type FieldResponsibility = 'lead' | 'technician' | 'helper' | 'office';

export type FieldAssignmentSource =
  | 'office'
  | 'daily_assignment'
  | 'regular_crew'
  | 'direct_staff'
  | 'profile_van_fallback';

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
  technicianIds: string[];
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

export type FieldJobDetail = FieldScheduleJob & { knownEquipment: FieldKnownEquipment[] };
export type FieldScheduleResponse = { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; jobs: FieldScheduleJob[] };
export type FieldJobResponse = { success: true; version: typeof FIELD_AUTHORITY_API_VERSION; job: FieldJobDetail };

const RESPONSIBILITIES = new Set<FieldResponsibility>(['lead', 'technician', 'helper', 'office']);
const ASSIGNMENT_SOURCES = new Set<FieldAssignmentSource>(['office', 'daily_assignment', 'regular_crew', 'direct_staff', 'profile_van_fallback']);

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
    && Array.isArray(job.technicianIds)
    && job.technicianIds.every(string)
    && string(job.responsibility)
    && RESPONSIBILITIES.has(job.responsibility as FieldResponsibility)
    && string(job.assignmentSource)
    && ASSIGNMENT_SOURCES.has(job.assignmentSource as FieldAssignmentSource)
    && Array.isArray(job.allowedActions)
    && job.allowedActions.every(string)
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
