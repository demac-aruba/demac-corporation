// Generated from OpenStreetMap address data. Do not edit manually.
// © OpenStreetMap contributors, available under the ODbL.
// The current file starts empty; scripts/build_aruba_address_index.py refreshes it
// together with the street index and preserves addr:housenumber coordinates.

export type OsmArubaAddressPoint = {
  street: string;
  houseNumber: string;
  latitude: number;
  longitude: number;
  neighborhood?: string;
  operationalZone?: string;
};

export const osmArubaAddressPointIndexGeneratedAt = 'pending-refresh';
export const osmArubaAddressPointAttribution = '© OpenStreetMap contributors · ODbL';

export const osmArubaAddressPoints: readonly OsmArubaAddressPoint[] = [] as const;
