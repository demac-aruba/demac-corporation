import type { OfficeBookingOption } from './office-booking-authority';

export type FixedAppointmentTarget = {
  dateKey: string;
  start: string;
  vanId: string;
};

export function appointmentDraftHydrationAllowed(hydratedAppointmentId: string, nextAppointmentId: string, dirty: boolean) {
  return hydratedAppointmentId !== nextAppointmentId || !dirty;
}

export function optionPrimaryAssignment(option: OfficeBookingOption) {
  return option.assignments.find((assignment) => assignment.role === 'primary')
    ?? option.assignments.find((assignment) => assignment.role !== 'support')
    ?? option.assignments[0];
}

export function optionAssignmentIsSupport(option: OfficeBookingOption, assignment: OfficeBookingOption['assignments'][number]) {
  if (assignment.role) return assignment.role === 'support';
  return assignment !== optionPrimaryAssignment(option);
}

export function optionSupportAssignments(option: OfficeBookingOption) {
  const primary = optionPrimaryAssignment(option);
  return option.assignments.filter((assignment) => (
    assignment !== primary && optionAssignmentIsSupport(option, assignment)
  ));
}

export function optionSupportAssignment(option: OfficeBookingOption) {
  return optionSupportAssignments(option)[0];
}

export function optionAssignmentStart(option: OfficeBookingOption, assignment: OfficeBookingOption['assignments'][number]) {
  return assignment.time || option.time;
}

export function optionAssignmentWorkEnd(option: OfficeBookingOption, assignment: OfficeBookingOption['assignments'][number]) {
  return assignment.endTime || (optionAssignmentIsSupport(option, assignment) ? '' : option.endTime || '');
}

export function optionAssignmentCapacityEnd(option: OfficeBookingOption, assignment: OfficeBookingOption['assignments'][number]) {
  return assignment.capacityEndTime
    || (optionAssignmentIsSupport(option, assignment) ? '' : option.capacityEndTime || '')
    || optionAssignmentWorkEnd(option, assignment);
}

export function optionSupportWindow(option: OfficeBookingOption) {
  return optionSupportWindows(option)[0] ?? null;
}

export function optionSupportWindows(option: OfficeBookingOption) {
  return optionSupportAssignments(option).map((assignment) => ({
    assignment,
    start: optionAssignmentStart(option, assignment),
    end: optionAssignmentWorkEnd(option, assignment),
    workEnd: optionAssignmentWorkEnd(option, assignment),
    capacityEnd: optionAssignmentCapacityEnd(option, assignment),
  }));
}

export function fixedAppointmentOptions(options: OfficeBookingOption[], target: FixedAppointmentTarget) {
  return options.filter((option) => {
    const primary = optionPrimaryAssignment(option);
    return option.date === target.dateKey
      && option.time === target.start
      && primary?.vanId === target.vanId
      && (primary.time || option.time) === target.start;
  });
}
