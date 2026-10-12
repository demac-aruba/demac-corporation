import { callOfficeBookingAuthority } from './office-booking-authority';

export type CatalogItemType = 'Servicio' | 'Producto';
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
  duration: {
    minutes: number;
  };
};

export type CatalogItem = {
  id: string;
  name: string;
  itemType?: CatalogItemType;
  durationMinutes: number;
  basePrice: number | null;
  category: string;
  description?: string;
  sku?: string;
  active?: boolean;
  featured?: boolean;
  pricingDefinition?: CatalogPricingDefinition;
  serviceDefinition?: ServiceDefinition;
  catalogToken?: string;
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
  basePrice: string;
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

export function normalizedCatalogPricing(input?: Partial<CatalogPricingDefinition>): CatalogPricingDefinition {
  if (!input) return { version: 1, mode: 'fixed', currency: 'AWG' };
  if (input.version !== 1 || input.currency !== 'AWG' || !['fixed','per_unit','tiered_btu','quote'].includes(String(input.mode))) throw new Error('La configuración de tarifa requiere revisión; no se convertirá automáticamente.');
  return structuredClone(input) as CatalogPricingDefinition;
}

export function catalogDraftPrice(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) throw new Error('Escribe un precio con hasta dos decimales.');
  const price = Number(value.trim().replace(',', '.'));
  if (!Number.isFinite(price) || price > 1000000) throw new Error('Precio fuera del rango permitido.');
  return price;
}

function normalizedServiceDefinition(input: ServiceDefinition | undefined, name: string): ServiceDefinition | undefined {
  if (!input) return undefined;
  if (input.version !== 1) throw new Error('Esta versión de servicio requiere revisión; no se convertirá automáticamente.');
  const duration = Math.max(30, Math.min(720, Math.round(Number(input.duration?.minutes || 60))));
  return {
    version: 1,
    bookingCode: bookingCodeFromName(input.bookingCode || name),
    duration: { minutes: duration },
  };
}

export function legacyServiceDefinition(item: CatalogItem): ServiceDefinition {
  const duration = Math.max(30, Math.round(Number(item.durationMinutes || 60)));
  return {
    version: 1,
    bookingCode: bookingCodeFromName(item.name) || `service_${item.id}`,
    duration: { minutes: duration },
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
      basePrice: '',
      pricingDefinition: { version: 1, mode: 'fixed', currency: 'AWG' },
      serviceDefinition: {
        version: 1,
        bookingCode: '',
        duration: { minutes: 60 },
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
    basePrice: typeof item.basePrice === 'number' && Number.isFinite(item.basePrice) ? String(item.basePrice) : '',
    pricingDefinition: normalizedCatalogPricing(item.pricingDefinition),
    serviceDefinition: type === 'Servicio'
      ? normalizedServiceDefinition(item.serviceDefinition ?? legacyServiceDefinition(item), item.name)
      : undefined,
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
  const pricingDefinition = normalizedCatalogPricing(args.draft.pricingDefinition);
  return {
    ...args.existing,
    id: args.id,
    name: compactText(args.draft.name),
    itemType: type,
    category: compactText(args.draft.category) || type,
    sku: compactText(args.draft.sku),
    description: compactText(args.draft.description),
    active: args.draft.active,
    featured: type === 'Servicio' ? args.draft.featured : false,
    basePrice: catalogDraftPrice(args.draft.basePrice),
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
  const items: CatalogItem[] = [];
  let cursor: string | null = null;
  do {
    const page: { items: CatalogItem[]; nextCursor: string | null } = await callOfficeBookingAuthority('list_managed_catalog', { cursor });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return [...items].sort((left, right) => {
    const type = catalogItemType(left).localeCompare(catalogItemType(right));
    return type || left.name.localeCompare(right.name);
  });
}

async function saveCatalogItem(item: CatalogItem, expectedToken: string | null, patch: Partial<CatalogItem> = item) {
  const result = await callOfficeBookingAuthority<{ success: true; item: CatalogItem | null }>('save_catalog_item', { id: item.id, expectedToken, patch });
  if (!result.item) throw new Error('El artículo fue eliminado después de guardarse. Actualiza el catálogo.');
  return result.item;
}
export function createCatalogItem(item: CatalogItem) { return saveCatalogItem(item, null); }
export function updateCatalogItem(item: CatalogItem) {
  if (!item.catalogToken) throw new Error('Recarga el catálogo y vuelve a abrir el artículo.');
  return saveCatalogItem(item, item.catalogToken);
}
export function setCatalogItemActive(item: CatalogItem, active: boolean) {
  if (!item.catalogToken) throw new Error('Recarga el catálogo y vuelve a abrir el artículo.');
  return saveCatalogItem(item, item.catalogToken, { active });
}

export function newCatalogItemId(type: CatalogItemType) {
  const prefix = type === 'Servicio' ? 'service' : 'product';
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 20)
    : `${Date.now()}${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${random}`;
}
