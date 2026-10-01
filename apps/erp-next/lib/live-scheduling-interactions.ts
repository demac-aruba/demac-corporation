export type AfterHoursVanTarget = {
  dateKey: string;
  vanId: string;
  vanName: string;
  start: '17:00';
  end: '';
};

export function afterHoursTargetForVan(dateKey: string, van: { id: string; name: string }): AfterHoursVanTarget {
  return { dateKey, vanId: van.id, vanName: van.name, start: '17:00', end: '' };
}

export type AvailableSlotIntent = 'card' | 'book' | 'support';

export function availableSlotAction(intent: AvailableSlotIntent): 'book' | 'support' {
  return intent === 'support' ? 'support' : 'book';
}

/** Stop at the first occupied/off slot or clock gap (including lunch). */
export function consecutiveSupportOptions(slots: Array<{
  start: string; end: string; operational: boolean; occupied: boolean;
}>, start: string) {
  const options: Array<{ slots: number; end: string }> = [];
  const index = slots.findIndex(slot => slot.start === start);
  if (index < 0) return options;
  let nextStart = start;
  for (const slot of slots.slice(index)) {
    if (slot.start !== nextStart || !slot.operational || slot.occupied) break;
    options.push({ slots: options.length + 1, end: slot.end });
    nextStart = slot.end;
  }
  return options;
}

export type LiveSchedulingInteractionState = {
  selectedAppointmentId?: string;
  bookingTarget?: unknown;
  supportTarget?: unknown;
  afterHoursTarget?: unknown;
  moveArmedJobId?: string;
  pendingDragMove?: unknown;
  moveBusy?: boolean;
  manualRefreshing?: boolean;
};

export function liveSchedulingInteractionActive(state: LiveSchedulingInteractionState) {
  return Boolean(
    state.selectedAppointmentId
      || state.bookingTarget
      || state.supportTarget
      || state.afterHoursTarget
      || state.moveArmedJobId
      || state.pendingDragMove
      || state.moveBusy
      || state.manualRefreshing,
  );
}

export function canPlanCoworkerSupport(dateKey: string) {
  const parsed = new Date(`${dateKey}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === dateKey;
}

export function canPlanAfterHours(dateKey: string, today: string) {
  return dateKey >= today;
}

export function weeklyRestSlotEligible(input: {
  dateKey: string; today: string; start: string; companyOpen: boolean; vanAvailable: boolean;
  schedule?: { workdayStart?: string; workdayEnd?: string };
}) {
  if (!input.companyOpen || !input.vanAvailable || !input.schedule || input.dateKey < input.today) return false;
  if (!['08:30', '09:30', '10:30', '13:30', '14:30', '15:30'].includes(input.start)) return false;
  return input.start < (input.schedule.workdayStart || '08:00') || input.start >= (input.schedule.workdayEnd || '13:00');
}
