import type { CentralProject } from './registry-types';
import type {
  checkOfficeCreateAvailability,
  OfficeAvailabilityResult,
  OfficeCreateAppointmentResult,
} from '../office-booking-authority';

/** This is a client contract, never availability, permission or execution authority. */
export type ProjectBookingSelection = {
  projectId: string;
  phaseId: string | null;
  expectedVersion: number;
};
export type ProjectBookingMode = 'confirmed' | 'temporary_hold';
export type ProjectBookingInput = Parameters<typeof checkOfficeCreateAvailability>[0];
export type BoundProjectBookingInput = ProjectBookingInput & { projectSelection: ProjectBookingSelection };
type PlanIdentity = Pick<CentralProject, 'id' | 'schemaVersion' | 'version' | 'customerId' | 'propertyId' | 'phases'>;
export type ProjectBookingExpectation = {
  selection: ProjectBookingSelection;
  actorId: string;
  customerId: string;
  propertyId: string;
  mode: ProjectBookingMode;
  offerId: string;
  offerVersion: number;
  optionId: string;
};
export type ProjectBookingConfirmation = {
  requestId: string;
  offerId: string;
  offerVersion: number;
  optionId: string;
  bookingMode?: 'backdated';
  backdatingAcknowledged?: boolean;
};

export class ProjectBookingContractError extends Error {
  readonly code: string;
  readonly outcomeUncertain: boolean;
  constructor(code: string, message: string, outcomeUncertain = false) {
    super(message);
    this.name = 'ProjectBookingContractError';
    this.code = code;
    this.outcomeUncertain = outcomeUncertain;
  }
}
function invalid(message: string, uncertain = false): never {
  throw new ProjectBookingContractError('project_booking_contract', message, uncertain);
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 180
    && value.trim() === value && !/[\/\x00-\x1f]/.test(value)
    && value !== '.' && value !== '..' && !value.startsWith('__');
}
function validVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) < Number.MAX_SAFE_INTEGER;
}
function snapshot<T>(value: T): T {
  // Same JSON representation sent to the existing Office API. Do not retain mutable form refs.
  return JSON.parse(JSON.stringify(value)) as T;
}
function requireSelection(value: ProjectBookingSelection): void {
  if (!isId(value.projectId) || (value.phaseId !== null && !isId(value.phaseId)) || !validVersion(value.expectedVersion)) {
    invalid('Select a central project and its current version before checking availability.');
  }
}
function equalBoundContext(value: unknown, selection: ProjectBookingSelection, actorId: string): boolean {
  const bound = record(value);
  return Boolean(bound && Object.keys(bound).length === 5 && bound.schemaVersion === 1
    && bound.projectId === selection.projectId && bound.phaseId === selection.phaseId
    && bound.expectedVersion === selection.expectedVersion && bound.actorId === actorId);
}

/** Preserve customer, property, support slots, instructions and normal Office input unchanged. */
export function bindCentralProjectBooking(
  project: PlanIdentity,
  phaseId: string | null,
  input: ProjectBookingInput,
): BoundProjectBookingInput {
  const selection = { projectId: project.id, phaseId, expectedVersion: project.version };
  requireSelection(selection);
  if (project.schemaVersion !== 1 || !isId(project.customerId) || !isId(project.propertyId)
      || !Array.isArray(project.phases) || (phaseId !== null && !project.phases.some(phase => phase.id === phaseId))) {
    invalid('The central planning record or selected phase needs to be refreshed.');
  }
  if (input.customerId !== project.customerId || input.propertyId !== project.propertyId) {
    invalid('Project, customer and property must match. No customer or property was changed.');
  }
  if (input.appointmentId !== undefined || input.changeKind !== undefined) {
    invalid('This adapter creates new bookings only. Existing appointments use their governed lifecycle.');
  }
  // Duration and estimates have different meanings. Never cap work at the remaining budget,
  // raise an estimate, invent worked hours, or perform a second browser-only Project write.
  return snapshot({ ...input, projectSelection: selection });
}

/** Check correlation before enabling Confirm; the server still revalidates on commit. */
export function prepareCentralProjectConfirmation({
  input, availability, actorId, optionId, requestId, mode,
}: {
  input: BoundProjectBookingInput;
  availability: OfficeAvailabilityResult;
  actorId: string;
  optionId: string;
  requestId: string;
  mode: ProjectBookingMode;
}): { command: ProjectBookingConfirmation; expectation: ProjectBookingExpectation } {
  requireSelection(input.projectSelection);
  if (!isId(actorId) || !isId(requestId) || requestId.length < 8 || !isId(optionId)
      || !['confirmed', 'temporary_hold'].includes(mode)) invalid('Invalid booking identity or confirmation mode.');
  const offer = record(availability.offer);
  const request = record(offer?.request);
  if (availability.success !== true || availability.available !== true || !offer || !isId(offer.id)
      || !validVersion(offer.version) || offer.status !== 'open'
      || !equalBoundContext(offer.projectContext, input.projectSelection, actorId)
      || request?.customerId !== input.customerId || request?.propertyId !== input.propertyId
      || !Array.isArray(availability.options) || availability.options.filter(option => option.id === optionId).length !== 1) {
    invalid('Availability does not confirm this project, phase, operator and option. Recheck before booking.');
  }
  if (mode === 'temporary_hold' && (input.bookingMode !== undefined || input.backdatingAcknowledged === true)) {
    invalid('Backdated work cannot be created as a temporary hold.');
  }
  return snapshot({
    command: {
      requestId, offerId: offer.id, offerVersion: offer.version, optionId,
      ...(input.bookingMode !== undefined ? { bookingMode: input.bookingMode } : {}),
      ...(input.backdatingAcknowledged !== undefined ? { backdatingAcknowledged: input.backdatingAcknowledged } : {}),
    },
    expectation: {
      selection: input.projectSelection, actorId, customerId: input.customerId,
      propertyId: input.propertyId, mode, offerId: offer.id, offerVersion: offer.version, optionId,
    },
  });
}

/** A missing or mismatched response is UNKNOWN, not proof that nothing was committed. */
export function verifyCentralProjectBooking(
  value: OfficeCreateAppointmentResult,
  expectation: ProjectBookingExpectation,
): { appointmentId: string; workOrderIds: string[]; projectId: string; phaseId: string | null; mode: ProjectBookingMode; replayed: boolean } {
  const result = record(value);
  const appointment = record(result?.appointment);
  const mode = result?.createMode;
  // A held booking may already have been promoted when its original request is recovered.
  const promotedHold = expectation.mode === 'temporary_hold' && mode === 'confirmed' && result?.replayed === true;
  const ids = result?.workOrderIds;
  const storedIds = appointment?.workOrderIds;
  const orderSetValid = Array.isArray(ids) && ids.length > 0 && ids.length <= 60
    && ids.every(isId) && new Set(ids).size === ids.length
    && Array.isArray(storedIds) && storedIds.length === ids.length && storedIds.every(isId)
    && new Set(storedIds).size === storedIds.length && storedIds.every(id => ids.includes(id));
  if (!result || result.success !== true || !isId(result.appointmentId) || !appointment
      || appointment.appointmentId !== result.appointmentId
      || appointment.offerId !== expectation.offerId || appointment.offerVersion !== expectation.offerVersion
      || appointment.selectedOptionId !== expectation.optionId
      || appointment.customerId !== expectation.customerId || appointment.propertyId !== expectation.propertyId
      || (appointment.clientId !== undefined && appointment.clientId !== expectation.customerId)
      || !equalBoundContext(appointment.projectContext, expectation.selection, expectation.actorId)
      || (mode !== expectation.mode && !promotedHold) || appointment.status !== mode || !orderSetValid) {
    invalid('The response does not verify the complete Project booking. Preserve the same request ID and reconcile or retry it; do not create a replacement.', true);
  }
  return {
    appointmentId: result.appointmentId as string, workOrderIds: [...ids as string[]],
    projectId: expectation.selection.projectId, phaseId: expectation.selection.phaseId,
    mode: mode as ProjectBookingMode, replayed: result.replayed === true,
  };
}
