import { getFirestoreDocument, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';
import { invalidateOfficeBookingPresetCache } from './office-booking-authority';

export type SchedulingWorkTypeKind = 'service' | 'installation' | 'commercial' | 'other';

export type SchedulingWorkType = {
  id: string;
  label: string;
  durationMinutesPerUnit: number;
  kind: SchedulingWorkTypeKind;
  active: boolean;
  sortOrder: number;
  manualDuration?: boolean;
};

type SchedulingWorkTypeSettings = {
  id: 'appointment-work-presets';
  workTypesVersion?: number;
  presets?: SchedulingWorkType[];
  updatedAt?: string;
};

export const SCHEDULING_WORK_TYPES_SETTINGS_ID = 'appointment-work-presets' as const;
export const SCHEDULING_WORK_TYPES_VERSION = 2;

export const DEFAULT_SCHEDULING_WORK_TYPES: SchedulingWorkType[] = [
  { id: 'standard_service', label: 'Standard Service', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 10 },
  { id: 'deep_cleaning', label: 'Premium Deep Cleaning Service', durationMinutesPerUnit: 120, kind: 'service', active: true, sortOrder: 20 },
  { id: 'standard_installation', label: 'Standard Installation', durationMinutesPerUnit: 120, kind: 'installation', active: true, sortOrder: 30 },
  { id: 'installation_extended_labor', label: 'Installation Extended Labor', durationMinutesPerUnit: 180, kind: 'installation', active: true, sortOrder: 40 },
  { id: 'check_up', label: 'Check Up', durationMinutesPerUnit: 60, kind: 'service', active: true, sortOrder: 50 },
  { id: 'leak_repair', label: 'Leak Repair', durationMinutesPerUnit: 180, kind: 'service', active: true, sortOrder: 60 },
  { id: 'commercial_service', label: 'Commercial Service', durationMinutesPerUnit: 180, kind: 'commercial', active: true, sortOrder: 70 },
  { id: 'other', label: 'Other', durationMinutesPerUnit: 60, kind: 'other', active: true, sortOrder: 80, manualDuration: true },
];

const defaultById = new Map(DEFAULT_SCHEDULING_WORK_TYPES.map((item) => [item.id, item]));
const aliases: Record<string, string> = {
  standard_service: 'standard_service',
  deep_cleaning: 'deep_cleaning',
  premium_deep_cleaning: 'deep_cleaning',
  standard_installation: 'standard_installation',
  installation_standard: 'standard_installation',
  extended_installation: 'installation_extended_labor',
  special_installation: 'installation_extended_labor',
  installation_extended: 'installation_extended_labor',
  installation_extended_labor: 'installation_extended_labor',
  rooftop_installation: 'installation_extended_labor',
  installation_rooftop: 'installation_extended_labor',
  second_floor_installation: 'installation_extended_labor',
  installation_second_floor: 'installation_extended_labor',
  third_floor_installation: 'installation_extended_labor',
  installation_third_floor: 'installation_extended_labor',
  checkup: 'check_up',
  check_up: 'check_up',
  diagnostic: 'check_up',
  leak_repair: 'leak_repair',
  commercial: 'commercial_service',
  commercial_service: 'commercial_service',
  other: 'other',
  otro: 'other',
};

function normalizedId(value: unknown) {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return aliases[normalized] ?? normalized;
}

function duration(value: unknown, fallback = 60) {
  const number = Number(value);
  const safe = Number.isFinite(number) && number > 0 ? number : fallback;
  return Math.max(60, Math.min(720, Math.round(safe / 30) * 30));
}

function kind(value: unknown, fallback: SchedulingWorkTypeKind): SchedulingWorkTypeKind {
  return value === 'installation' || value === 'commercial' || value === 'other' || value === 'service'
    ? value
    : fallback;
}

export function normalizeSchedulingWorkTypes(input?: SchedulingWorkType[]) {
  const configured = Array.isArray(input) ? input : [];
  const configuredById = new Map<string, SchedulingWorkType>();
  const custom: SchedulingWorkType[] = [];

  configured.forEach((item, index) => {
    const id = normalizedId(item?.id);
    if (!id) return;
    const defaults = defaultById.get(id);
    const next: SchedulingWorkType = {
      id,
      label: String(item?.label ?? defaults?.label ?? id.replaceAll('_', ' ')).trim(),
      durationMinutesPerUnit: duration(item?.durationMinutesPerUnit, defaults?.durationMinutesPerUnit ?? 60),
      kind: kind(item?.kind, defaults?.kind ?? 'service'),
      active: item?.active !== false,
      sortOrder: Number.isFinite(Number(item?.sortOrder)) ? Math.max(0, Math.round(Number(item.sortOrder))) : (defaults?.sortOrder ?? (index + 1) * 10),
      ...(id === 'other' || item?.manualDuration === true || defaults?.manualDuration ? { manualDuration: true } : {}),
    };
    if (!next.label) return;
    if (defaultById.has(id)) {
      if (!configuredById.has(id)) configuredById.set(id, next);
    } else if (!custom.some((candidate) => candidate.id === id)) {
      custom.push(next);
    }
  });

  const builtIns = DEFAULT_SCHEDULING_WORK_TYPES.map((defaults) => configuredById.get(defaults.id) ?? { ...defaults });
  return [...builtIns, ...custom].sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));
}

export function formatSchedulingDuration(minutes: number) {
  const hours = Math.max(0, minutes) / 60;
  const value = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(/\.0$/, '');
  return `${value} hour${hours === 1 ? '' : 's'}`;
}

export async function loadSchedulingWorkTypes() {
  const settings = await getFirestoreDocument<SchedulingWorkTypeSettings>('businessSettings', SCHEDULING_WORK_TYPES_SETTINGS_ID);
  if (!settings || Number(settings.workTypesVersion || 0) < SCHEDULING_WORK_TYPES_VERSION) {
    return DEFAULT_SCHEDULING_WORK_TYPES.map((item) => ({ ...item }));
  }
  return normalizeSchedulingWorkTypes(settings.presets);
}

export async function saveSchedulingWorkTypes(presets: SchedulingWorkType[]) {
  const normalized = normalizeSchedulingWorkTypes(presets);
  const persisted = normalized.map((item) => ({
    id: item.id,
    label: item.label.trim(),
    durationMinutesPerUnit: duration(item.durationMinutesPerUnit),
    kind: item.kind,
    active: item.active !== false,
    sortOrder: item.sortOrder,
    ...(item.manualDuration ? { manualDuration: true } : {}),
  }));
  const existing = await getFirestoreDocument<SchedulingWorkTypeSettings>('businessSettings', SCHEDULING_WORK_TYPES_SETTINGS_ID);
  const updatedAt = new Date().toISOString();
  const changes = { workTypesVersion: SCHEDULING_WORK_TYPES_VERSION, presets: persisted, updatedAt };
  if (existing) {
    await updateFirestoreDocument<SchedulingWorkTypeSettings>('businessSettings', SCHEDULING_WORK_TYPES_SETTINGS_ID, changes);
  } else {
    await saveFirestoreDocument<SchedulingWorkTypeSettings>('businessSettings', {
      id: SCHEDULING_WORK_TYPES_SETTINGS_ID,
      ...changes,
    });
  }
  invalidateOfficeBookingPresetCache();
  return normalized;
}
