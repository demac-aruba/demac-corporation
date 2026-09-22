import { PROJECT_CAPACITY_SLOT_MINUTES } from './browser-projects';

/** Display legacy duration-based planning values as slots without changing stored records. */
export function projectSlotLabel(hours: number, slotDurationMinutes = PROJECT_CAPACITY_SLOT_MINUTES, locale = 'en-US') {
  const minutes = Number.isFinite(slotDurationMinutes) && slotDurationMinutes > 0
    ? slotDurationMinutes : PROJECT_CAPACITY_SLOT_MINUTES;
  const slots = hours * 60 / minutes;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(slots)} ${slots === 1 ? 'slot' : 'slots'}`;
}
