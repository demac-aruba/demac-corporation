
import { arubaAddressDirectory, ArubaAddressEntry } from '../data/arubaAddresses';
import { PropertyLocation } from '../types';

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/straat/g, 'str').replace(/boulevard/g, 'blvd').replace(/[^a-z0-9]/g, '');
}

function levenshtein(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0][column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      rows[row][column] = Math.min(rows[row - 1][column] + 1, rows[row][column - 1] + 1, rows[row - 1][column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1));
    }
  }
  return rows[a.length][b.length];
}

export function suggestArubaAddresses(query: string, limit = 6): ArubaAddressEntry[] {
  const needle = normalize(query.replace(/\d+[a-z-]*$/i, ''));
  if (needle.length < 2) return [];
  return arubaAddressDirectory.map((entry) => {
    const candidates = [entry.canonical, ...(entry.aliases ?? [])].map(normalize);
    const best = Math.max(...candidates.map((candidate) => candidate === needle ? 100 : candidate.startsWith(needle) ? 92 : candidate.includes(needle) ? 84 : Math.max(0, 72 - levenshtein(candidate, needle) * 7)));
    return { entry, best };
  }).filter((item) => item.best >= 35).sort((a, b) => b.best - a.best || a.entry.canonical.localeCompare(b.entry.canonical)).slice(0, limit).map((item) => item.entry);
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
