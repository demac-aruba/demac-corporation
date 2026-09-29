import { parseArubaAddressParts, type DemacAddressSuggestion } from './booking-intelligence/address';

export type PropertyAddressDraft = { street: string; house: string };

/** Keep legacy apartment details in the address; never turn them into new dwelling IDs. */
export function splitPropertyAddress(address: string): PropertyAddressDraft {
  const parts = parseArubaAddressParts(address.replace(/,\s*(apt\b|apartment\b|apartamento\b|unit\b|unidad\b|suite\b|door\b|deur\b|piso\b|floor\b)/i, ' $1'));
  return { street: parts.street, house: [parts.houseNumber, parts.unit].filter(Boolean).join(', ') };
}

/** A pasted full address takes precedence over the separate, previously typed number. */
export function composePropertyAddress(draft: PropertyAddressDraft) {
  const parsed = splitPropertyAddress(draft.street);
  return [parsed.street, parsed.house || draft.house.trim()].filter(Boolean).join(' ');
}

export function selectPropertyAddress(draft: PropertyAddressDraft, suggestion: DemacAddressSuggestion) {
  const parts = splitPropertyAddress(draft.street);
  const next = { street: suggestion.canonical, house: parts.house || draft.house };
  return {
    draft: next,
    address: composePropertyAddress(next),
    zone: suggestion.operationalZone || suggestion.demacSector,
    neighborhood: suggestion.neighborhood,
  };
}
