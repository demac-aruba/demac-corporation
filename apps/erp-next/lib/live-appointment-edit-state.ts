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

export function optionSupportAssignment(option: OfficeBookingOption) {
  const explicitSupport = option.assignments.find((assignment) => assignment.role === 'support');
  if (explicitSupport) return explicitSupport;
  const primary = optionPrimaryAssignment(option);
  return option.assignments.find((assignment) => assignment !== primary);
}

export function optionAssignmentIsSupport(option: OfficeBookingOption, assignment: OfficeBookingOption['assignments'][number]) {
  if (assignment.role) return assignment.role === 'support';
  return assignment !== optionPrimaryAssignment(option);
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
