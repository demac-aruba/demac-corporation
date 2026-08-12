import type { BrowserCrmCustomerIdentity, BrowserCrmSiteIdentity } from '../browser-crm';
import { suggestArubaServiceAddresses } from './address';
import { normalizeIdentityText } from './identity';

export type CopilotPropertyCandidate = {
  customer: BrowserCrmCustomerIdentity;
  site: BrowserCrmSiteIdentity;
};

export type CopilotLocationResolution = {
  customerId?: string;
  customerName?: string;
  siteId?: string;
  siteName?: string;
  siteAddress?: string;
  sector?: string;
  confidence: 'high' | 'medium' | 'low' | 'none';
  source: 'registered_property' | 'registered_customer' | 'aruba_address' | 'previous' | 'none';
};

const genericPropertyWords = new Set([
  'residence', 'residencia', 'residentie', 'house', 'home', 'casa', 'property', 'propiedad',
  'main', 'family', 'villa', 'apartment', 'apartamento', 'office', 'oficina', 'aruba',
]);

function normalizeSpeechLocation(value: string) {
  return normalizeIdentityText(value)
    .replace(/\b(?:guayaca|huayaca|wayaka)\b/g, 'wayaca')
    .replace(/\borange\s+stad\b/g, 'oranjestad')
    .replace(/\bnorth\b/g, 'noord')
    .replace(/\bsan\s+nicolaas\b/g, 'san nicolas')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value: string) {
  return normalizeSpeechLocation(value).split(' ').filter(Boolean);
}

function significantWords(value: string) {
  return words(value).filter((token) => token.length >= 3 && !genericPropertyWords.has(token) && !/^\d+$/.test(token));
}

function numbers(value: string) {
  return words(value).filter((token) => /^\d+[a-z-]*$/i.test(token));
}

function customerScore(message: string, customerName: string) {
  const text = normalizeSpeechLocation(message);
  const name = normalizeSpeechLocation(customerName);
  if (!name) return 0;
  if (text.includes(name)) return 120;
  const nameTokens = name.split(' ').filter((token) => token.length >= 3);
  const messageTokens = new Set(text.split(' '));
  const matched = nameTokens.filter((token) => messageTokens.has(token)).length;
  if (nameTokens.length >= 2 && matched === nameTokens.length) return 105;
  if (matched >= 2) return 82;
  return 0;
}

function propertyScore(message: string, site: BrowserCrmSiteIdentity) {
  const messageText = normalizeSpeechLocation(message);
  const siteText = normalizeSpeechLocation(`${site.name} ${site.address}`);
  if (!siteText) return 0;
  if (messageText.includes(normalizeSpeechLocation(site.address)) || messageText.includes(normalizeSpeechLocation(site.name))) return 130;

  const messageTokens = new Set(significantWords(message));
  const siteTokens = significantWords(`${site.name} ${site.address}`);
  const uniqueSiteTokens = [...new Set(siteTokens)];
  const placeMatches = uniqueSiteTokens.filter((token) => messageTokens.has(token)).length;
  const placeRatio = placeMatches / Math.max(1, uniqueSiteTokens.length);

  const messageNumbers = new Set(numbers(message));
  const siteNumbers = numbers(`${site.name} ${site.address}`);
  const numberMatch = siteNumbers.some((token) => messageNumbers.has(token));

  let score = 0;
  if (placeMatches) score += Math.round(70 * Math.min(1, placeRatio + 0.35));
  if (numberMatch) score += 42;
  if (placeMatches && numberMatch) score += 18;
  return score;
}

function sectorFromFreeTextAddress(message: string) {
  const tokens = words(message).filter((token) => token.length >= 4 && !genericPropertyWords.has(token) && !/^\d/.test(token));
  const candidates: Array<{ sector: string; score: number }> = [];
  for (let size = Math.min(3, tokens.length); size >= 1; size -= 1) {
    for (let index = 0; index <= tokens.length - size; index += 1) {
      const query = tokens.slice(index, index + size).join(' ');
      const suggestion = suggestArubaServiceAddresses(query, 1)[0];
      if (!suggestion?.demacSector || suggestion.score < 90) continue;
      candidates.push({ sector: suggestion.demacSector, score: suggestion.score + size * 2 });
    }
  }
  return candidates.sort((left, right) => right.score - left.score)[0]?.sector;
}

export function resolveBookingCopilotLocation(args: {
  text: string;
  candidates: CopilotPropertyCandidate[];
  previous?: CopilotLocationResolution | null;
}): CopilotLocationResolution {
  const customerScores = new Map<string, number>();
  for (const candidate of args.candidates) {
    if (!customerScores.has(candidate.customer.id)) customerScores.set(candidate.customer.id, customerScore(args.text, candidate.customer.name));
  }
  const rankedCustomers = [...customerScores.entries()].filter(([, score]) => score >= 82).sort((left, right) => right[1] - left[1]);
  const explicitCustomerId = rankedCustomers[0]?.[0];
  const activeCustomerId = explicitCustomerId ?? args.previous?.customerId;
  const customerCandidates = activeCustomerId ? args.candidates.filter((item) => item.customer.id === activeCustomerId) : args.candidates;

  const rankedProperties = customerCandidates
    .map((candidate) => ({ candidate, score: propertyScore(args.text, candidate.site) }))
    .filter((item) => item.score >= 70)
    .sort((left, right) => right.score - left.score);

  let matchedProperty = rankedProperties[0]?.candidate;
  let propertyScoreValue = rankedProperties[0]?.score ?? 0;

  if (!matchedProperty && explicitCustomerId) {
    const sites = customerCandidates.filter((item) => item.customer.id === explicitCustomerId);
    if (sites.length === 1) {
      matchedProperty = sites[0];
      propertyScoreValue = 78;
    }
  }

  if (matchedProperty) {
    const addressSuggestion = suggestArubaServiceAddresses(matchedProperty.site.address, 1)[0];
    const sector = matchedProperty.site.sector || addressSuggestion?.demacSector || sectorFromFreeTextAddress(args.text);
    return {
      customerId: matchedProperty.customer.id,
      customerName: matchedProperty.customer.name,
      siteId: matchedProperty.site.id,
      siteName: matchedProperty.site.name,
      siteAddress: matchedProperty.site.address,
      sector: sector || undefined,
      confidence: propertyScoreValue >= 100 ? 'high' : 'medium',
      source: 'registered_property',
    };
  }

  if (explicitCustomerId) {
    const customer = args.candidates.find((item) => item.customer.id === explicitCustomerId)?.customer;
    const sector = sectorFromFreeTextAddress(args.text);
    return {
      customerId: customer?.id,
      customerName: customer?.name,
      sector,
      confidence: sector ? 'medium' : 'low',
      source: 'registered_customer',
    };
  }

  const sector = sectorFromFreeTextAddress(args.text);
  if (sector) return { sector, confidence: 'medium', source: 'aruba_address' };

  if (args.previous?.source && args.previous.source !== 'none') return { ...args.previous, source: 'previous' };
  return { confidence: 'none', source: 'none' };
}
