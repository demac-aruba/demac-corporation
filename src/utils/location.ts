import { arubaAddressDirectory, ArubaAddressEntry } from '../data/arubaAddresses';
import { PropertyLocation } from '../types';

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

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] = Math.min(
        rows[row - 1][column] + 1,
        rows[row][column - 1] + 1,
        rows[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
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

export function suggestArubaAddresses(query: string, limit = 6): ArubaAddressEntry[] {
  const addressQuery = withoutHouseNumber(query);
  const queryWords = normalizeWords(addressQuery);
  const queryCompact = compact(addressQuery);
  if (queryCompact.length < 2) return [];

  // Once the operator selected or typed the exact canonical address, hide the list.
  if (arubaAddressDirectory.some((entry) => compact(entry.canonical) === queryCompact)) return [];

  const scored = arubaAddressDirectory.map((entry) => {
    const candidates = [entry.canonical, ...(entry.aliases ?? [])];
    const strong = Math.max(...candidates.map((candidate) => strongMatchScore(candidate, queryWords, queryCompact)));
    const fuzzy = strong ? 0 : Math.max(...candidates.map((candidate) => fuzzyMatchScore(candidate, queryWords, queryCompact)));
    return { entry, score: strong || fuzzy, strong: strong > 0 };
  });

  const strongMatches = scored.filter((item) => item.strong);
  const matches = strongMatches.length ? strongMatches : scored.filter((item) => item.score >= 68);
  return matches
    .sort((a, b) => b.score - a.score || a.entry.canonical.localeCompare(b.entry.canonical))
    .slice(0, limit)
    .map((item) => item.entry);
}

export function applyAddressSuggestion(raw: string, suggestion: ArubaAddressEntry) {
  const house = raw.match(/\b(\d+[a-z-]*)\b/i)?.[1];
  return `${suggestion.canonical}${house ? ` ${house}` : ''}`;
}

export function parseLocationInput(value: string): Partial<PropertyLocation> | null {
  const input = value.trim();
  if (!input) return null;
  let decoded = input;
  try { decoded = decodeURIComponent(input); } catch { /* keep original */ }
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
  if (/^https?:\/\//i.test(input)) return { originalUrl: input };
  return null;
}

export function mapsMeUrl(location?: PropertyLocation, label = 'Ubicación DEMAC') {
  if (!location) return '';
  if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude)) {
    return `https://dlink.maps.me/map?v=1&ll=${location.latitude},${location.longitude}&n=${encodeURIComponent(label)}`;
  }
  return location.originalUrl ?? '';
}

export function locationCoordinates(location?: PropertyLocation) {
  return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude) ? `${location?.latitude}, ${location?.longitude}` : '';
}

export function phoneDigits(value?: string) { return String(value ?? '').replace(/\D/g, ''); }
