'use client';

import type { AfterHoursVanTarget } from '../../lib/live-scheduling-interactions';
import {
  LiveAppointmentCreateDrawer,
  type LiveCreatedBooking,
} from './live-appointment-create-drawer';

type Props = {
  target: AfterHoursVanTarget;
  onClose: () => void;
  onCreated?: (booking: LiveCreatedBooking) => void;
};

export function AfterHoursEmergencyDrawer({ target, onClose, onCreated }: Props) {
  return (
    <LiveAppointmentCreateDrawer
      mode="after_hours"
      target={target}
      onClose={onClose}
      onCreated={(booking) => {
        onCreated?.(booking);
        onClose();
      }}
    />
  );
}
