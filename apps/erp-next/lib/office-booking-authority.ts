import type {
  AppointmentRecipientSelection,
  BookingContact,
  BookingContactAssignment,
  NewBookingContactLink,
} from './customer-contacts';
import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type OfficeBookingPreset = {
  id: string;
  label: string;
  kind?: string;
  durationMinutesPerUnit: number;
  durationMode?: 'per_unit' | 'fixed';
  active: boolean;
  serviceId?: string;
  source?: 'service_catalog' | 'scheduling_work_types' | 'appointment_work_presets';
  serviceDefinitionVersion?: number;
};

export type OfficeBookingWorkLine = {
  id: string;
  presetId: string;
  serviceId?: string;
  quantity: number;
  manualDurationMinutes?: number;
  customerFacingDescription?: string;
  technicianInstructions?: string;
};

export type OfficeBookingWorkItem = {
  id: string;
  presetId: string;
  serviceId?: string;
  label?: string;
  quantity: number;
  durationMinutes: number;
  durationMinutesPerUnit: number;
  durationMode: 'per_unit' | 'fixed' | 'manual';
  serviceDefinitionVersion?: number;
};

export type OfficeBookingOption = {
  id: string;
  date: string;
  time: string;
  endTime?: string;
  capacityEndTime?: string;
  address?: string;
  zone?: string;
  presetId?: string;
  presetLabel?: string;
  serviceId?: string;
  durationMinutesPerUnit?: number;
  durationMode?: 'per_unit' | 'fixed' | 'manual' | 'mixed';
  serviceDefinitionVersion?: number;
  quantity?: number;
  workItems?: OfficeBookingWorkItem[];
  assignments: Array<{
    vanId: string;
    vanName?: string;
    technicianIds?: string[];
    quantity: number;
    durationMinutes?: number;
    slots: number;
    fullDay?: boolean;
    time?: string;
    endTime?: string;
    capacityEndTime?: string;
    role?: 'primary' | 'support';
  }>;
};

export type OfficeAvailabilityResult = {
  success: boolean;
  available: boolean;
  offer: { id: string; version: number; status: string; expiresAt?: string } | null;
  options: OfficeBookingOption[];
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type OfficeAppointmentAttribution = {
  appointmentId: string;
  source?: string;
  createdBy?: string;
  createdByName?: string;
  createdAtIso?: string;
  updatedAtIso?: string;
};

export type OfficeCommunicationQueueEntry = {
  queueId: string;
  status: string;
  messageId?: string;
  errorMessage?: string;
  reason?: string;
};

export type OfficeCommunicationState = {
  enabled: boolean;
  queueIds: string[];
  historyQueueIds: string[];
  state: string;
  queue?: OfficeCommunicationQueueEntry[];
  lastError: string;
  canSendNow?: boolean;
};

export type OfficeCommunicationPurpose = 'confirmation' | 'reminder';

export type OfficeRecipientCommunicationState = {
  selected: boolean;
  state: string;
  queueIds: string[];
  historyQueueIds: string[];
  lastError: string;
  canSendNow: boolean;
  manual: boolean;
  reason: string;
  blockedReason?: string;
  messageId?: string;
  provider?: string;
  historyAttemptCount: number;
};

export type OfficeAppointmentCommunicationRecipient = {
  id: string;
  recipientType: string;
  sourceId: string;
  name: string;
  role: string;
  phone: string;
  preferredLanguage: string;
  sendConfirmation: boolean;
  sendReminder: boolean;
  confirmation: OfficeRecipientCommunicationState;
  reminder: OfficeRecipientCommunicationState;
};

export type OfficeAppointmentCommunication = {
  success: true;
  version: number;
  appointmentId: string;
  workOrderId: string;
  whatsappEnabled: boolean;
  recipients: OfficeAppointmentCommunicationRecipient[];
  confirmation: OfficeCommunicationState;
  reminder: OfficeCommunicationState;
};

export type OfficeLifecycleChangeKind = 'customer_reschedule' | 'operational_move' | 'details_edited';

export type OfficeLifecycleResult = {
  success: true;
  replayed?: boolean;
  appointmentId: string;
  changeKind?: OfficeLifecycleChangeKind;
  customerNotificationRecommended?: boolean;
  appointment: Record<string, unknown>;
  workOrderIds?: string[];
};

export type OfficeAdhocSupportResult = {
  success: true;
  replayed?: boolean;
  appointmentId: string;
  supportWorkOrderId: string;
  supportWorkOrder: Record<string, unknown>;
  appointment: Record<string, unknown>;
};

export type OfficeCreateAppointmentResult = {
  success: true;
  replayed?: boolean;
  createMode?: 'confirmed' | 'temporary_hold';
  appointmentId: string;
  appointment: Record<string, unknown>;
  workOrderIds: string[];
};

export type OfficeMasterDataRecord = Record<string, unknown> & { id: string };

export type OfficeCustomerInput = {
  name: string;
  company?: string;
  legalName?: string;
  type?: string;
  phone: string;
  whatsapp?: string;
  email?: string;
  preferredLanguage?: string;
  zone?: string;
};

export type OfficeCustomerRecord = OfficeMasterDataRecord & {
  name: string;
  company?: string;
  legalName?: string;
  type?: string;
  phone: string;
  phoneCountry?: string;
  whatsapp?: string;
  whatsappCountry?: string;
  email?: string;
  preferredLanguage?: string;
  address?: string;
  zone?: string;
  balance?: number;
  equipmentCount?: number;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdById?: string;
  createdByName?: string;
  updatedById?: string;
  updatedByName?: string;
};

export type OfficeCustomerChanges = Partial<Pick<OfficeCustomerInput,
  'name' | 'company' | 'legalName' | 'type' | 'phone' | 'whatsapp' | 'email' | 'preferredLanguage' | 'zone'
>>;

export type OfficePropertyRecord = OfficeMasterDataRecord & {
  clientId: string;
  name?: string;
  type?: string;
  address: string;
  addressRaw?: string;
  addressNormalized?: string;
  neighborhood?: string;
  zone: string;
  operationalZone?: string;
  notes?: string;
  accessInstructions?: string;
  landmark?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
  createdById?: string;
  createdByName?: string;
  updatedById?: string;
  updatedByName?: string;
};

export type OfficePropertyChanges = Partial<Pick<OfficePropertyRecord,
  'name' | 'type' | 'address' | 'neighborhood' | 'zone' | 'notes' | 'accessInstructions' | 'landmark'
>>;

export type OfficeContactRecord = BookingContact & {
  createdById?: string;
  createdByName?: string;
  updatedById?: string;
  updatedByName?: string;
};

export type OfficeContactChanges = Partial<Pick<OfficeContactRecord,
  'name' | 'phone' | 'whatsapp' | 'email' | 'preferredLanguage' | 'active'
>>;

type ApiError = { error?: { code?: string; message?: string; details?: Record<string, unknown> } };
type PresetResponse = {
  success: true;
  version: number;
  presets: OfficeBookingPreset[];
  catalogSource?: 'services' | 'legacy_fallback';
};

const PRESET_CACHE_MS = 5 * 60_000;
let presetCache: { expiresAt: number; promise: Promise<PresetResponse> } | null = null;

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for ERP Next.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/officeBookingAuthority`;
}

function apiErrorDetail(payload: ApiError) {
  const reason = payload.error?.details?.reason;
  return typeof reason === 'string' && reason.trim() ? ` · ${reason.trim()}` : '';
}

async function callOfficeBookingAuthority<T>(action: string, data: Record<string, unknown>, timeoutMs = 15_000): Promise<T> {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({})) as T & ApiError;
    if (!response.ok) {
      const code = payload.error?.code ? ` (${payload.error.code})` : '';
      throw new Error(`${payload.error?.message ?? 'The appointment operation could not be completed.'}${code}${apiErrorDetail(payload)}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Booking Authority took too long to respond, so the outcome is not yet confirmed. Refresh before trying again.');
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function createOfficeLifecycleRequestId(prefix = 'schedule') {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

export function invalidateOfficeBookingPresetCache() {
  presetCache = null;
}

export function listOfficeBookingPresets(force = false) {
  const now = Date.now();
  if (!force && presetCache && presetCache.expiresAt > now) return presetCache.promise;
  const promise = callOfficeBookingAuthority<PresetResponse>('list_presets', {}, 8_000);
  presetCache = { expiresAt: now + PRESET_CACHE_MS, promise };
  promise.catch(() => {
    if (presetCache?.promise === promise) presetCache = null;
  });
  return promise;
}

export function listOfficeContactDirectory(customerId?: string) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    contacts: BookingContact[];
    assignments: BookingContactAssignment[];
  }>('list_contact_directory', customerId ? { customerId } : {}, 8_000);
}

export function createOfficeCustomer(input: {
  requestId: string;
  customer: OfficeCustomerInput;
}) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    customer: OfficeCustomerRecord;
  }>('create_customer', input, 10_000);
}

export function createOfficeCustomerWithProperty(input: {
  requestId: string;
  customer: OfficeCustomerInput;
  property: Record<string, unknown>;
}) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    customer: OfficeCustomerRecord;
    property: OfficePropertyRecord;
  }>('create_customer_property', input, 10_000);
}

export function createOfficeProperty(input: {
  requestId: string;
  customerId: string;
  property: Record<string, unknown>;
}) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    property: OfficePropertyRecord;
  }>('create_property', input, 10_000);
}

export function updateOfficeCustomer(input: {
  requestId: string;
  customerId: string;
  changes: OfficeCustomerChanges;
  expectedUpdatedAt: string;
}) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    customer: OfficeCustomerRecord;
  }>('update_customer', input, 10_000);
}

export function updateOfficeProperty(input: {
  requestId: string;
  customerId: string;
  propertyId: string;
  changes: OfficePropertyChanges;
  expectedUpdatedAt: string;
}) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    property: OfficePropertyRecord;
  }>('update_property', input, 10_000);
}

export function updateOfficeContact(input: {
  requestId: string;
  customerId: string;
  contactId: string;
  changes: OfficeContactChanges;
  expectedUpdatedAt: string;
}) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    contact: OfficeContactRecord;
  }>('update_contact', input, 10_000);
}

export function saveOfficeContactAssignment(input: {
  requestId: string;
  customerId: string;
  propertyId: string;
  link: NewBookingContactLink;
}) {
  return callOfficeBookingAuthority<{
    success: true;
    version: number;
    contactId: string;
    assignmentId: string;
  }>('save_contact_assignment', input, 10_000);
}

export function deactivateOfficeContactAssignment(input: {
  requestId: string;
  customerId: string;
  propertyId: string;
  assignmentId: string;
}) {
  return callOfficeBookingAuthority<{ success: true; version: number; assignmentId: string }>('deactivate_contact_assignment', input, 10_000);
}

export async function checkOfficeCreateAvailability(input: {
  requestId: string;
  customerId: string;
  propertyId: string;
  appointmentId?: string;
  presetId?: string;
  serviceId?: string;
  quantity?: number;
  workLines?: OfficeBookingWorkLine[];
  requestedDate: string;
  requestedTime: string;
  requiredVanId: string;
  customerFacingDescription?: string;
  technicianInstructions?: string;
  recipientSelections?: AppointmentRecipientSelection[];
  notes?: string;
  changeKind?: OfficeLifecycleChangeKind;
}) {
  return callOfficeBookingAuthority<OfficeAvailabilityResult>('check_availability', input, 12_000);
}

export async function confirmOfficeAppointment(input: {
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
}) {
  const result = await callOfficeBookingAuthority<OfficeCreateAppointmentResult>('create_appointment', input, 12_000);
  if (!result.success || !result.appointmentId) {
    throw new Error('Booking Authority did not return a verified appointment id. Nothing was marked as confirmed.');
  }
  return result;
}

export async function createOfficeTemporaryHold(input: {
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
}) {
  const result = await callOfficeBookingAuthority<OfficeCreateAppointmentResult>('create_temporary_hold', input, 12_000);
  if (!result.success || !result.appointmentId || result.createMode !== 'temporary_hold') {
    throw new Error('Booking Authority did not return a verified temporary hold. Nothing was reserved.');
  }
  return result;
}

export async function confirmOfficeTemporaryHold(input: {
  appointmentId: string;
  requestId: string;
}) {
  const result = await callOfficeBookingAuthority<OfficeLifecycleResult>('confirm_temporary_hold', input, 12_000);
  if (!result.success || !result.appointmentId) {
    throw new Error('Booking Authority did not confirm the temporary hold. The hold was left unchanged.');
  }
  return result;
}

export function getOfficeAppointment(appointmentId: string) {
  return callOfficeBookingAuthority<{
    success: true;
    appointmentId: string;
    appointment: Record<string, unknown>;
  }>('get_appointment', { appointmentId }, 8_000);
}

export async function listOfficeAppointmentAttribution(appointmentIds: string[]) {
  const ids = [...new Set(appointmentIds.map((item) => item.trim()).filter(Boolean))];
  const attribution: OfficeAppointmentAttribution[] = [];
  for (let index = 0; index < ids.length; index += 500) {
    const result = await callOfficeBookingAuthority<{ success: true; attribution: OfficeAppointmentAttribution[] }>(
      'list_appointment_attribution',
      { appointmentIds: ids.slice(index, index + 500) },
      6_000,
    );
    attribution.push(...(result.attribution ?? []));
  }
  return attribution;
}

export function getOfficeAppointmentCommunication(appointmentId: string) {
  return callOfficeBookingAuthority<OfficeAppointmentCommunication>(
    'get_appointment_communication',
    { appointmentId },
    8_000,
  );
}

/** Legacy global reminder preference contract. New appointment UI uses the per-recipient method below. */
export function updateOfficeAppointmentReminder(input: {
  appointmentId: string;
  requestId: string;
  sendReminder: boolean;
}) {
  return callOfficeBookingAuthority<OfficeAppointmentCommunication>(
    'update_appointment_communication',
    input,
    10_000,
  );
}

export function updateOfficeAppointmentReminderRecipient(input: {
  appointmentId: string;
  requestId: string;
  recipientId: string;
  enabled: boolean;
}) {
  return callOfficeBookingAuthority<OfficeAppointmentCommunication>(
    'update_appointment_communication',
    input,
    10_000,
  );
}

/** Legacy global manual reminder contract. New appointment UI uses sendOfficeAppointmentCommunication. */
export function sendOfficeAppointmentReminder(input: {
  appointmentId: string;
  requestId: string;
}) {
  return callOfficeBookingAuthority<OfficeAppointmentCommunication>(
    'send_appointment_reminder',
    input,
    12_000,
  );
}

export function sendOfficeAppointmentCommunication(input: {
  appointmentId: string;
  requestId: string;
  recipientId: string;
  purpose: OfficeCommunicationPurpose;
}) {
  return callOfficeBookingAuthority<OfficeAppointmentCommunication>(
    'send_appointment_communication',
    input,
    12_000,
  );
}

export async function checkOfficeRescheduleAvailability(input: {
  appointmentId: string;
  requestId: string;
  customerId: string;
  propertyId: string;
  presetId?: string;
  serviceId?: string;
  quantity?: number;
  workLines?: OfficeBookingWorkLine[];
  requestedDate: string;
  requestedTime?: string;
  requiredVanId?: string;
  customerFacingDescription?: string;
  technicianInstructions?: string;
  notes?: string;
  changeKind?: OfficeLifecycleChangeKind;
}) {
  return callOfficeBookingAuthority<OfficeAvailabilityResult>('check_availability', input, 12_000);
}

export async function cancelOfficeAppointment(input: {
  appointmentId: string;
  requestId: string;
  reason: string;
  note?: string;
}) {
  return callOfficeBookingAuthority<{ success: true; appointmentId: string; appointment: Record<string, unknown> }>('cancel_appointment', input);
}

export async function rescheduleOfficeAppointment(input: {
  appointmentId: string;
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
  reason: string;
  note?: string;
  changeKind?: OfficeLifecycleChangeKind;
}) {
  return callOfficeBookingAuthority<OfficeLifecycleResult>('reschedule_appointment', input, 12_000);
}

/**
 * Fast path for an authenticated office drag-and-drop move.
 * Booking Authority derives the work/customer data from the canonical appointment,
 * validates the exact van/time, and commits the lifecycle transaction inside one
 * server request so the browser does not pay two sequential network round trips.
 */
export async function moveOfficeAppointment(input: {
  appointmentId: string;
  requestId: string;
  requestedDate: string;
  requestedTime: string;
  requiredVanId: string;
  reason: string;
  note?: string;
}) {
  return callOfficeBookingAuthority<OfficeLifecycleResult>('move_appointment', input, 12_000);
}

export async function addOfficeAdhocSupport(input: {
  appointmentId: string;
  requestId: string;
  requestedDate: string;
  requestedTime: string;
  requiredVanId: string;
  reason?: string;
}) {
  return callOfficeBookingAuthority<OfficeAdhocSupportResult>('add_adhoc_support', input, 12_000);
}
