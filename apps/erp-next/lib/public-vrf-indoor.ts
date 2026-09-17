import type { VrfCard } from './public-vrf-content';

/** Owner-approved product images, extracted from the approved concept at native size.
 * These are illustrative product renders, not photographs of a DEMAC installation.
 * Keep this catalogue shared by Website Manager and both responsive presentations.
 */
export const defaultVrfIndoorUnits: VrfCard[] = [
  { id: 'cassette', title: 'Cassette Units', description: 'Discreet ceiling integration with wide air distribution.', detail: 'Offices · retail · commercial spaces', imageUrl: '/website/vrf/indoor-cassette-approved.webp', imageAlt: 'Four-way ceiling cassette indoor unit' },
  { id: 'fan-coil', title: 'Fan Coil Units', description: 'Flexible concealed or ducted installation for refined interiors.', detail: 'Hotels · offices · residences', imageUrl: '/website/vrf/indoor-fan-coil-approved.webp', imageAlt: 'Concealed ducted fan coil indoor unit' },
  { id: 'floor-ceiling', title: 'Floor-Ceiling Units', description: 'Versatile mounting for open areas and spaces with limited ceiling options.', detail: 'Retail · restaurants · open spaces', imageUrl: '/website/vrf/indoor-floor-ceiling-approved.webp', imageAlt: 'Floor-ceiling indoor air conditioning unit' },
  { id: 'air-handler', title: 'Air Handlers', description: 'Higher-static solutions for custom ductwork and larger conditioned areas.', detail: 'Large buildings · custom applications', imageUrl: '/website/vrf/indoor-air-handler-approved.webp', imageAlt: 'Ducted air handler cabinet' },
  { id: 'mini-split', title: 'Mini Split Units', description: 'Compact, stylish indoor units with independent zoning.', detail: 'Bedrooms · offices · smaller rooms', imageUrl: '/website/vrf/indoor-mini-split-approved.webp', imageAlt: 'Wall-mounted mini split indoor unit' },
];

export function safeIndoorImageUrl(value: unknown, fallback = ''): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const url = value.trim();
  if (url.startsWith('/') && !url.startsWith('//') && !url.includes('\\')) return url;
  try { return new URL(url).protocol === 'https:' ? url : fallback; }
  catch { return fallback; }
}

function valueOr(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

/** Non-destructive read-time compatibility for saved six-card documents.
 * No database writes, no changes to unrelated sections. Canonical IDs, not array
 * positions, determine the image. Prefer the canonical mini-split then the old
 * wall-mounted card over its old duplicate. Preserve custom operator copy.
 */
export function normalizeVrfIndoorUnits(value: unknown): VrfCard[] {
  const source = Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object') : [];
  return defaultVrfIndoorUnits.map((base) => {
    const aliases = base.id === 'mini-split' ? ['mini-split', 'wall-mounted', 'split-unit'] : [base.id];
    const item: Record<string, unknown> = aliases.map((id) => source.find((card) => card.id === id)).find(Boolean) ?? {};
    const oldMiniTitle = ['Split Units', 'Wall-Mounted Split Units'].includes(String(item.title));
    const oldMiniDescription = ['Flexible indoor-unit option for smaller commercial zones.', 'Compact, familiar indoor units with independent zoning.'].includes(String(item.description));
    const isMini = base.id === 'mini-split';
    return {
      id: base.id,
      title: isMini && oldMiniTitle ? base.title : valueOr(item.title, base.title),
      description: isMini && oldMiniDescription ? base.description : valueOr(item.description, base.description),
      detail: isMini && item.detail === 'Offices · support spaces' ? base.detail : typeof item.detail === 'string' ? item.detail.trim() : base.detail,
      imageUrl: safeIndoorImageUrl(item.imageUrl, base.imageUrl),
      imageAlt: valueOr(item.imageAlt, base.imageAlt ?? base.title),
    };
  });
}
