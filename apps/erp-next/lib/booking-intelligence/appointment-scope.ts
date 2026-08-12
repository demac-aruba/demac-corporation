import type { BookingRequest, BookingWorkLine, SchedulingSettings } from '../scheduling';
import { calculateDurationMinutes, customerFacingDescription, getRuntimeSchedulingSettings } from '../scheduling';

export type AppointmentScopeSummary = {
  totalMinutes: number;
  totalUnits: number;
  description: string;
  lines: BookingWorkLine[];
};

export function normalizeWorkLines(lines: BookingWorkLine[]) {
  return lines
    .map((line, index) => ({
      ...line,
      id: line.id || `work-${index + 1}`,
      quantity: Math.max(1, Math.floor(Number(line.quantity) || 1)),
    }))
    .filter((line) => Boolean(line.presetId));
}

export function summarizeAppointmentScope(
  lines: BookingWorkLine[],
  settings: SchedulingSettings = getRuntimeSchedulingSettings(),
): AppointmentScopeSummary {
  const normalized = normalizeWorkLines(lines);
  const totalMinutes = normalized.reduce((sum, line) => sum + calculateDurationMinutes({ presetId: line.presetId, quantity: line.quantity }, settings), 0);
  const totalUnits = normalized.reduce((sum, line) => sum + line.quantity, 0);
  const description = normalized
    .map((line) => customerFacingDescription({ presetId: line.presetId, quantity: line.quantity }))
    .join(' + ');
  return { totalMinutes, totalUnits, description, lines: normalized };
}

export function bookingRequestFromScope(args: {
  customer: string;
  site: string;
  sector: string;
  lines: BookingWorkLine[];
  restriction?: BookingRequest['restriction'];
}): BookingRequest {
  const scope = summarizeAppointmentScope(args.lines);
  const primary = scope.lines[0];
  if (!primary) throw new Error('At least one work line is required.');
  return {
    customer: args.customer,
    site: args.site,
    sector: args.sector,
    presetId: primary.presetId,
    quantity: scope.totalUnits,
    workLines: scope.lines,
    restriction: args.restriction,
  };
}
