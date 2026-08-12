import { arubaAddressDirectory, type ArubaAddressEntry } from '../../../../src/data/arubaAddresses';

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

function withoutHouseNumber(value: string) {
  return value.replace(/\s+\d+[a-z-]*\s*$/i, '').trim();
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
  if (/san nicolas|brazil|zeewijk|lago heights|seroe colorado|baby beach/.test(place)) return 'San Nicolas';
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
  return matches
    .sort((left, right) => right.score - left.score || left.entry.canonical.localeCompare(right.entry.canonical))
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
  const house = raw.match(/\b(\d+[a-z-]*)\b/i)?.[1];
  return `${suggestion.canonical}${house ? ` ${house}` : ''}`;
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
      return { latitude, longitude, originalUrl: /^https?:/i.test(input) ? input : undefined };
    }
  }
  return /^https?:\/\//i.test(input) ? { originalUrl: input } : null;
}
