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
