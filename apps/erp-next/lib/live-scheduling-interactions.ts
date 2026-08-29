export type AfterHoursVanTarget = {
  dateKey: string;
  vanId: string;
  vanName: string;
};

export function afterHoursTargetForVan(dateKey: string, van: { id: string; name: string }): AfterHoursVanTarget {
  return { dateKey, vanId: van.id, vanName: van.name };
}

export type AvailableSlotIntent = 'card' | 'book' | 'support';

export function availableSlotAction(intent: AvailableSlotIntent): 'book' | 'support' {
  return intent === 'support' ? 'support' : 'book';
}
