import { listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument } from './firebase/firestore-rest';

export type CatalogItemType = 'Servicio' | 'Producto';
export type ServiceDurationMode = 'per_unit' | 'fixed';
export type ServiceAllocationMode = 'single_van' | 'primary_with_support';
export type CatalogPricingMode = 'fixed' | 'per_unit' | 'tiered_btu' | 'quote';

export type CatalogPriceTier = {
  id: string;
  label: string;
  minBtu?: number;
  maxBtu?: number;
  amount: number;
};

export type CatalogPricingDefinition = {
  version: 1;
  mode: CatalogPricingMode;
  currency: 'AWG';
  tiers?: CatalogPriceTier[];
};

export type ServiceDefinition = {
  version: 1;
  bookingCode: string;
  quantityUnit: string;
  duration: {
    mode: ServiceDurationMode;
    minutes: number;
  };
  allocation: {
    mode: ServiceAllocationMode;
    differentPropertyDailyMaxUnits?: number;
    primaryMaxUnits?: number;
    supportSelection: 'operator' | 'none';
  };
};

export type CatalogItem = {
  id: string;
  name: string;
  itemType?: CatalogItemType;
  durationMinutes: number;
  basePrice: number;
  category: string;
  description?: string;
  sku?: string;
  active?: boolean;
  featured?: boolean;
  pricingDefinition?: CatalogPricingDefinition;
  serviceDefinition?: ServiceDefinition;
  createdAt?: string;
  updatedAt?: string;
  createdById?: string;
  createdByName?: string;
  updatedById?: string;
  updatedByName?: string;
};

export type CatalogDraft = {
  name: string;
  itemType: CatalogItemType;
  category: string;
  sku: string;
  description: string;
  active: boolean;
  featured: boolean;
  basePrice: number;
  pricingDefinition: CatalogPricingDefinition;
  serviceDefinition?: ServiceDefinition;
};

export type CatalogMigrationState = 'canonical' | 'legacy_service' | 'product';

function compactText(value: unknown) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

export function catalogItemType(item: CatalogItem): CatalogItemType {
  return item.itemType === 'Producto' ? 'Producto' : 'Servicio';
}

export function bookingCodeFromName(value: string) {
  return compactText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
}

export function catalogMigrationState(item: CatalogItem): CatalogMigrationState {
  if (catalogItemType(item) === 'Producto') return 'product';
  return item.serviceDefinition?.version === 1 && Boolean(item.serviceDefinition.bookingCode)
    ? 'canonical'
    : 'legacy_service';
}

export function normalizedCatalogPricing(input?: Partial<CatalogPricingDefinition>, basePrice = 0): CatalogPricingDefinition {
  const mode: CatalogPricingMode = ['fixed', 'per_unit', 'tiered_btu', 'quote'].includes(String(input?.mode))
    ? input!.mode as CatalogPricingMode
    : 'fixed';
  const tiers = mode === 'tiered_btu'
    ? (input?.tiers ?? [])
      .map((tier, index) => ({
        id: compactText(tier.id) || `tier-${index + 1}`,
        label: compactText(tier.label) || `Tier ${index + 1}`,
        ...(Number.isFinite(Number(tier.minBtu)) ? { minBtu: Math.max(0, Math.round(Number(tier.minBtu))) } : {}),
        ...(Number.isFinite(Number(tier.maxBtu)) ? { maxBtu: Math.max(0, Math.round(Number(tier.maxBtu))) } : {}),
        amount: Math.max(0, Number(tier.amount) || 0),
      }))
      .filter((tier) => tier.amount >= 0)
    : undefined;
  return {
    version: 1,
    mode,
    currency: 'AWG',
    ...(tiers?.length ? { tiers } : {}),
  };
}

export function legacyServiceDefinition(item: CatalogItem): ServiceDefinition {
  const duration = Math.max(30, Math.round(Number(item.durationMinutes || 60) / 15) * 15);
  return {
    version: 1,
    bookingCode: bookingCodeFromName(item.name) || `service_${item.id}`,
    quantityUnit: 'ac_unit',
    duration: { mode: 'per_unit', minutes: duration },
    allocation: { mode: 'single_van', supportSelection: 'none' },
  };
}

export function draftFromCatalogItem(item?: CatalogItem): CatalogDraft {
  if (!item) {
    return {
      name: '',
      itemType: 'Servicio',
      category: 'Servicio',
      sku: '',
      description: '',
      active: true,
      featured: true,
      basePrice: 0,
      pricingDefinition: { version: 1, mode: 'fixed', currency: 'AWG' },
      serviceDefinition: {
        version: 1,
        bookingCode: '',
        quantityUnit: 'ac_unit',
        duration: { mode: 'per_unit', minutes: 60 },
        allocation: { mode: 'single_van', supportSelection: 'none' },
      },
    };
  }
  const type = catalogItemType(item);
  return {
    name: item.name,
    itemType: type,
    category: item.category || type,
    sku: item.sku ?? '',
    description: item.description ?? '',
    active: item.active !== false,
    featured: type === 'Servicio' ? item.featured !== false : false,
    basePrice: Math.max(0, Number(item.basePrice || 0)),
    pricingDefinition: normalizedCatalogPricing(item.pricingDefinition, item.basePrice),
    serviceDefinition: type === 'Servicio'
      ? item.serviceDefinition ?? legacyServiceDefinition(item)
      : undefined,
  };
}

function normalizedServiceDefinition(input: ServiceDefinition | undefined, name: string): ServiceDefinition | undefined {
  if (!input) return undefined;
  const duration = Math.max(30, Math.min(720, Math.round(Number(input.duration.minutes || 60) / 15) * 15));
  const mode: ServiceAllocationMode = input.allocation.mode === 'primary_with_support' ? 'primary_with_support' : 'single_van';
  const regular = Math.max(1, Math.min(24, Math.round(Number(input.allocation.differentPropertyDailyMaxUnits || 6))));
  const primary = Math.max(regular, Math.min(48, Math.round(Number(input.allocation.primaryMaxUnits || Math.max(regular, 7)))));
  return {
    version: 1,
    bookingCode: bookingCodeFromName(input.bookingCode || name),
    quantityUnit: compactText(input.quantityUnit) || 'ac_unit',
    duration: {
      mode: input.duration.mode === 'fixed' ? 'fixed' : 'per_unit',
      minutes: duration,
    },
    allocation: mode === 'primary_with_support'
      ? {
        mode,
        differentPropertyDailyMaxUnits: regular,
        primaryMaxUnits: primary,
        supportSelection: 'operator',
      }
      : { mode, supportSelection: 'none' },
  };
}

export function materializeCatalogDraft(args: {
  id: string;
  draft: CatalogDraft;
  existing?: CatalogItem;
  actorId: string;
  actorName: string;
  now?: string;
}): CatalogItem {
  const now = args.now ?? new Date().toISOString();
  const type = args.draft.itemType;
  const serviceDefinition = type === 'Servicio'
    ? normalizedServiceDefinition(args.draft.serviceDefinition, args.draft.name)
    : undefined;
  const pricingDefinition = normalizedCatalogPricing(args.draft.pricingDefinition, args.draft.basePrice);
  return {
    ...args.existing,
    id: args.id,
    name: compactText(args.draft.name),
    itemType: type,
    category: compactText(args.draft.category) || type,
    sku: compactText(args.draft.sku) || undefined,
    description: compactText(args.draft.description) || undefined,
    active: args.draft.active,
    featured: type === 'Servicio' ? args.draft.featured : false,
    basePrice: Math.max(0, Number(args.draft.basePrice || 0)),
    durationMinutes: serviceDefinition?.duration.minutes ?? 0,
    pricingDefinition,
    serviceDefinition,
    createdAt: args.existing?.createdAt ?? now,
    createdById: args.existing?.createdById ?? args.actorId,
    createdByName: args.existing?.createdByName ?? args.actorName,
    updatedAt: now,
    updatedById: args.actorId,
    updatedByName: args.actorName,
  };
}

export async function listCanonicalCatalog() {
  const items = await listFirestoreCollection<CatalogItem>('services');
  return [...items].sort((left, right) => {
    const type = catalogItemType(left).localeCompare(catalogItemType(right));
    return type || left.name.localeCompare(right.name);
  });
}

export async function createCatalogItem(item: CatalogItem) {
  return saveFirestoreDocument('services', item);
}

export async function updateCatalogItem(item: CatalogItem) {
  const { id, ...changes } = item;
  return updateFirestoreDocument<CatalogItem>('services', id, changes);
}

export async function setCatalogItemActive(id: string, active: boolean, actorId: string, actorName: string) {
  return updateFirestoreDocument<CatalogItem>('services', id, {
    active,
    updatedAt: new Date().toISOString(),
    updatedById: actorId,
    updatedByName: actorName,
  });
}

export function newCatalogItemId(type: CatalogItemType) {
  const prefix = type === 'Servicio' ? 'service' : 'product';
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 20)
    : `${Date.now()}${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${random}`;
}
