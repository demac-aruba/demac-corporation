type DiagnosticMetadata = Record<string, unknown>;

type DiagnosticInput = {
  reason?: unknown;
  metadata?: DiagnosticMetadata;
};

export type OfficeBookingResolvedWorkload = {
  quantity?: number;
  durationMinutes?: number;
  durationMode?: string;
  slots?: number;
  ownedSlots?: string[];
  endTime?: string;
  capacityEndTime?: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): DiagnosticMetadata {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as DiagnosticMetadata
    : {};
}

function finiteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => text(item))
    .filter(Boolean);
}

function diagnosticMetadata(metadata: DiagnosticMetadata) {
  return record(metadata.diagnostic);
}

function diagnosticCode(metadata: DiagnosticMetadata) {
  return text(diagnosticMetadata(metadata).code);
}

export function officeBookingResolvedWorkload(metadata?: DiagnosticMetadata): OfficeBookingResolvedWorkload | undefined {
  const root = metadata ?? {};
  const source = record(root.resolvedWorkload);
  const nested = record(diagnosticMetadata(root).resolvedWorkload);
  const workload = Object.keys(source).length ? source : nested;
  if (!Object.keys(workload).length) return undefined;
  return {
    quantity: finiteNumber(workload.quantity),
    durationMinutes: finiteNumber(workload.durationMinutes),
    durationMode: text(workload.durationMode) || undefined,
    slots: finiteNumber(workload.slots),
    ownedSlots: stringList(workload.ownedSlots),
    endTime: text(workload.endTime) || undefined,
    capacityEndTime: text(workload.capacityEndTime) || undefined,
  };
}

function messageForReason(reason: string, metadata: DiagnosticMetadata, fallback: string) {
  switch (reason) {
    case 'START_TIME_PASSED':
    case 'requested-start-not-future':
    case 'selected-time-passed':
      return 'The selected start time has already passed. Choose a future start and check again.';
    case 'required-primary-target-unavailable':
      return metadata.requestedTimeUnavailable === true
        ? 'The selected date, start, and primary Van are not available together. The start may have passed or live capacity may have changed.'
        : 'Booking Authority cannot use this exact primary Van and start for the complete workload.';
    case 'required-van-unavailable':
    case 'van-unavailable':
      return 'The selected Van is not operationally available for this booking.';
    case 'crew-unavailable':
      return 'The selected Van has no dated crew available for this booking.';
    case 'half-day-capacity-unavailable':
      return 'The complete workload does not fit the selected Van’s dated half-day capacity.';
    case 'route-policy-rejected':
      return 'The selected target does not satisfy the current route policy for this workload.';
    case 'work-order-conflict':
      return 'Another Work Order now owns part of the required Van capacity.';
    case 'capacity-or-route-changed':
    case 'operational-target-unavailable':
      return 'Live capacity or route conditions changed. Recheck and choose a current Authority option.';
    case 'offer_expired':
      return 'The Booking Authority offer expired and must be checked again before saving.';
    case 'offer_version_mismatch':
      return 'The Booking Authority offer changed before it could be saved. Recheck current capacity.';
    case 'offer_not_open':
    case 'offer_not_found':
      return 'This Booking Authority offer is no longer active. Recheck current capacity.';
    case 'no-availability':
    case 'no_availability':
    case 'capacity':
    case 'mixed-work-exceeds-single-van-capacity':
      return 'No complete allocation is available for this workload at the selected target.';
    default:
      return fallback;
  }
}

export function officeBookingDiagnosticMessage(input: DiagnosticInput, fallback: string) {
  const reason = text(input.reason);
  const metadata = input.metadata ?? {};
  const code = diagnosticCode(metadata);
  const message = messageForReason(code || reason, metadata, fallback);
  const compatibleReason = reason || code;
  return compatibleReason ? `${message} (${compatibleReason})` : message;
}

export function officeBookingErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') return fallback;
  const errorRecord = error as Record<string, unknown>;
  const details = errorRecord.details && typeof errorRecord.details === 'object' ? errorRecord.details as DiagnosticMetadata : {};
  const nestedMetadata = errorRecord.details && typeof details.metadata === 'object' ? record(details.metadata) : {};
  const metadata = Object.keys(nestedMetadata).length
    ? { ...nestedMetadata, ...(details.diagnostic ? { diagnostic: details.diagnostic } : {}) }
    : details;
  const reason = text(errorRecord.reason) || text(details.reason);
  if (reason || diagnosticCode(metadata)) return officeBookingDiagnosticMessage({ reason, metadata }, fallback);
  return text(errorRecord.message) || fallback;
}
