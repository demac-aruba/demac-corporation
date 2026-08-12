import { arubaAddressDirectory, type ArubaAddressEntry } from '../../../../src/data/arubaAddresses';
import { osmArubaAddressPoints } from '../../../../src/data/arubaAddressPoints.generated';

export type AddressConfidence = 'verified' | 'suggested' | 'unresolved';

export type DemacAddressSuggestion = {
  canonical: string;
  neighborhood: string;
  operationalZone: string;
  demacSector: string;
  source: 'DEMAC' | 'OpenStreetMap' | 'unknown';
  score: number;
};

export type ParsedLocationInput = {
  latitude?: number;
  longitude?: number;
  originalUrl?: string;
};

export type ParsedArubaAddress = {
  street: string;
  houseNumber?: string;
  unit?: string;
};

export type ResolvedArubaAddress = ParsedArubaAddress & {
  address: string;
  sector: string;
  source: 'DEMAC' | 'OpenStreetMap' | 'unknown';
  neighborhood: string;
  operationalZone: string;
  confidence: 'verified';
  latitude?: number;
  longitude?: number;
};

function normalizeWords(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/straat/g, 'str')
    .replace(/boulevard/g, 'blvd')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function compact(value: string) {
  return normalizeWords(value).replace(/\s+/g, '');
}

function normalizeHouseNumber(value: string) {
  return value.replace(/\s+/g, '').replace(/-+/g, '-').toUpperCase();
}

function normalizeUnit(label: string, value: string) {
  const cleanValue = value.trim().replace(/^#/, '');
  const key = label.toLowerCase();
  if (/^apt|apartment|apartamento/.test(key)) return `Apt ${cleanValue}`;
  if (/^unit|unidad/.test(key)) return `Unit ${cleanValue}`;
  if (/^suite/.test(key)) return `Suite ${cleanValue}`;
  if (/^piso|floor/.test(key)) return `Floor ${cleanValue}`;
  if (/^door|deur/.test(key)) return `Door ${cleanValue}`;
  return `${label} ${cleanValue}`.trim();
}

export function parseArubaAddressParts(value: string): ParsedArubaAddress {
  const trimmed = value.trim();
  if (!trimmed) return { street: '' };

  let base = trimmed;
  let unit: string | undefined;
  const unitMatch = base.match(/\s+(apt(?:\.?|artment)?|apartment|apartamento|unit|unidad|suite|door|deur|piso|floor)\s*#?\s*([a-z0-9-]+)\s*$/i);
  if (unitMatch) {
    unit = normalizeUnit(unitMatch[1], unitMatch[2]);
    base = base.slice(0, unitMatch.index).trim();
  }

  const houseMatch = base.match(/^(.*?)(?:\s+(\d+(?:\s*-?\s*[a-z])?))\s*$/i);
  const street = (houseMatch?.[1] ?? base).trim();
  const houseNumber = houseMatch?.[2] ? normalizeHouseNumber(houseMatch[2]) : undefined;

  return { street, houseNumber, unit };
}

export function formatArubaServiceAddress(parts: Pick<ParsedArubaAddress, 'street' | 'houseNumber' | 'unit'>) {
  const streetAndHouse = `${parts.street.trim()}${parts.houseNumber?.trim() ? ` ${parts.houseNumber.trim()}` : ''}`.trim();
  return `${streetAndHouse}${parts.unit?.trim() ? `, ${parts.unit.trim()}` : ''}`.trim();
}

function withoutHouseNumber(value: string) {
  return parseArubaAddressParts(value).street;
}

function levenshtein(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, row) => [row]);
  for (let column = 1; column <= right.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

function strongMatchScore(candidate: string, queryWords: string, queryCompact: string) {
  const candidateWords = normalizeWords(candidate);
  const candidateCompact = candidateWords.replace(/\s+/g, '');
  const queryTokens = queryWords.split(' ').filter(Boolean);
  const candidateTokens = candidateWords.split(' ').filter(Boolean);
  if (candidateCompact === queryCompact) return 100;
  if (candidateWords.startsWith(queryWords)) return 96;
  if (candidateCompact.startsWith(queryCompact)) return 94;
  if (queryTokens.every((queryToken) => candidateTokens.some((candidateToken) => candidateToken.startsWith(queryToken)))) return 90;
  if (candidateWords.includes(queryWords) || candidateCompact.includes(queryCompact)) return 84;
  return 0;
}

function fuzzyMatchScore(candidate: string, queryWords: string, queryCompact: string) {
  if (queryCompact.length < 4) return 0;
  const candidateWords = normalizeWords(candidate);
  const candidateCompact = candidateWords.replace(/\s+/g, '');
  if (candidateCompact[0] !== queryCompact[0]) return 0;
  const allowedDistance = queryCompact.length <= 5 ? 1 : 2;
  const prefix = candidateCompact.slice(0, queryCompact.length);
  const prefixDistance = levenshtein(prefix, queryCompact);
  if (prefixDistance <= allowedDistance) return 76 - prefixDistance * 6;
  const queryTokens = queryWords.split(' ').filter(Boolean);
  const candidateTokens = candidateWords.split(' ').filter(Boolean);
  const tokenMatches = queryTokens.every((queryToken) => candidateTokens.some((candidateToken) => {
    if (candidateToken[0] !== queryToken[0]) return false;
    const tokenPrefix = candidateToken.slice(0, queryToken.length);
    return levenshtein(tokenPrefix, queryToken) <= (queryToken.length <= 5 ? 1 : 2);
  }));
  return tokenMatches ? 68 : 0;
}

function addressSourcePriority(entry: ArubaAddressEntry) {
  if (entry.source === 'DEMAC') return 2;
  if (entry.source === 'OpenStreetMap') return 1;
  return 0;
}

export function demacSectorForAddress(entry: Pick<ArubaAddressEntry, 'canonical' | 'neighborhood' | 'operationalZone'>) {
  const zone = normalizeWords(entry.operationalZone || '');
  const place = normalizeWords(`${entry.canonical} ${entry.neighborhood}`);
  if (zone.includes('san nicolas')) return 'San Nicolas';
  if (zone.includes('savaneta')) return 'Savaneta';
  if (zone.includes('santa cruz')) return 'Santa Cruz';
  if (zone.includes('paradera')) return 'Paradera';
  if (zone.includes('oranjestad')) return 'Oranjestad';
  if (zone.includes('noord hoteles')) return 'Palm Beach';
  if (zone.includes('noord')) return 'Noord';
  if (/palm beach|eagle beach|bakval|bubali|irausquin|sasaki/.test(place)) return 'Palm Beach';
  if (/noord|malmok|westpunt|opal|rooi santo|alto vista|boegoeroei|washington/.test(place)) return 'Noord';
  if (/oranjestad|playa|dakota|ponton|madiki|tanki leendert|wayaca/.test(place)) return 'Oranjestad';
  if (/santa cruz|hooiberg|balashi|macuarima/.test(place)) return 'Santa Cruz';
  if (/paradera|piedra plat|papaya|cashero/.test(place)) return 'Paradera';
  if (/savaneta|pos chiquito|mangel halto/.test(place)) return 'Savaneta';
  if (/san nicolas|brazil|zeewijk|lago heights|seroe colorado|baby beach|weg fontein|fontein/.test(place)) return 'San Nicolas';
  return '';
}

export function suggestArubaServiceAddresses(query: string, limit = 6): DemacAddressSuggestion[] {
  const addressQuery = withoutHouseNumber(query);
  const queryWords = normalizeWords(addressQuery);
  const queryCompact = compact(addressQuery);
  if (queryCompact.length < 2) return [];

  const scored = arubaAddressDirectory.map((entry) => {
    const candidates = [entry.canonical, ...(entry.aliases ?? [])];
    const strong = Math.max(...candidates.map((candidate) => strongMatchScore(candidate, queryWords, queryCompact)));
    const fuzzy = strong ? 0 : Math.max(...candidates.map((candidate) => fuzzyMatchScore(candidate, queryWords, queryCompact)));
    return { entry, score: strong || fuzzy, strong: strong > 0 };
  });
  const strongMatches = scored.filter((item) => item.strong);
  const matches = strongMatches.length ? strongMatches : scored.filter((item) => item.score >= 68);
  const seen = new Set<string>();
  return matches
    .sort((left, right) => right.score - left.score || addressSourcePriority(right.entry) - addressSourcePriority(left.entry) || left.entry.canonical.localeCompare(right.entry.canonical))
    .filter(({ entry }) => {
      const key = compact(entry.canonical);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ entry, score }) => ({
      canonical: entry.canonical,
      neighborhood: entry.neighborhood,
      operationalZone: entry.operationalZone,
      demacSector: demacSectorForAddress(entry),
      source: entry.source ?? 'unknown',
      score,
    }));
}

export function applyArubaAddressSuggestion(raw: string, suggestion: Pick<DemacAddressSuggestion, 'canonical'>) {
  const { houseNumber, unit } = parseArubaAddressParts(raw);
  return formatArubaServiceAddress({ street: suggestion.canonical, houseNumber, unit });
}

export function resolveArubaHouseNumberGps(street: string, houseNumber?: string): ParsedLocationInput | null {
  if (!street.trim() || !houseNumber?.trim()) return null;
  const streetKey = compact(street);
  const houseKey = compact(houseNumber);
  const point = osmArubaAddressPoints.find((candidate) => compact(candidate.street) === streetKey && compact(candidate.houseNumber) === houseKey);
  if (!point) return null;
  return { latitude: point.latitude, longitude: point.longitude };
}

export function resolveArubaAddressSuggestion(raw: string, suggestion: DemacAddressSuggestion): ResolvedArubaAddress {
  const { houseNumber, unit } = parseArubaAddressParts(raw);
  const point = resolveArubaHouseNumberGps(suggestion.canonical, houseNumber);
  return {
    street: suggestion.canonical,
    houseNumber,
    unit,
    address: formatArubaServiceAddress({ street: suggestion.canonical, houseNumber, unit }),
    sector: suggestion.demacSector,
    source: suggestion.source,
    neighborhood: suggestion.neighborhood,
    operationalZone: suggestion.operationalZone,
    confidence: 'verified',
    latitude: point?.latitude,
    longitude: point?.longitude,
  };
}

export function addressConfidence(value: string): AddressConfidence {
  const base = compact(withoutHouseNumber(value));
  if (!base) return 'unresolved';
  const exact = arubaAddressDirectory.some((entry) => [entry.canonical, ...(entry.aliases ?? [])].some((candidate) => compact(candidate) === base));
  return exact ? 'verified' : suggestArubaServiceAddresses(value, 1)[0]?.score >= 84 ? 'suggested' : 'unresolved';
}

export function parseLocationInput(value: string): ParsedLocationInput | null {
  const input = value.trim();
  if (!input) return null;
  let decoded = input;
  try { decoded = decodeURIComponent(input); } catch { /* keep raw */ }
  const patterns = [
    /(?:ll=|q=|query=|destination=)(-?\d{1,2}(?:\.\d+)?)[,%20\s]+(-?\d{1,3}(?:\.\d+)?)/i,
    /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
    /(-?\d{1,2}\.\d+)\s*[,; ]\s*(-?\d{1,3}\.\d+)/,
  ];
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (!match) continue;
    const latitude = Number(match[1]);
    const longitude = Number(match[2]);
    if (latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      return { latitude, longitude, originalUrl: /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : undefined };
    }
  }
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? { originalUrl: input } : null;
}

export function navigationUrlForAddress(address: string, location?: ParsedLocationInput | null) {
  const target = location?.latitude != null && location?.longitude != null
    ? `${location.latitude},${location.longitude}`
    : address.trim();
  if (!target) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(target)}`;
}
