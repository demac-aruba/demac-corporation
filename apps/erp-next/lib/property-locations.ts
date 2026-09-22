import { callOfficeBookingAuthority } from './office-booking-authority';
import { primeLiveSchedulingReferenceCache } from './live-scheduling-fast';
import type { BookingContactAssignment } from './customer-contacts';
import type { LiveCrmEquipment, LiveCrmProperty } from './live-crm';

export type PropertyDwelling = {
  id: string; clientId: string; propertyId: string; code: string; name: string;
  type: 'main_house' | 'apartment' | 'annex'; accessInstructions: string; active: boolean;
};
export type PropertyArea = { id: string; clientId: string; propertyId: string; dwellingId: string; code: string; name: string; active: boolean };
export type PropertyLocationData = {
  success: true; property: LiveCrmProperty; dwellings: PropertyDwelling[]; areas: PropertyArea[];
  assignments: BookingContactAssignment[]; equipment?: LiveCrmEquipment[];
};
export type LocationDraft = {
  id?: string; code: string; name: string; type?: PropertyDwelling['type']; dwellingId?: string;
  accessInstructions?: string; contactIds?: string[];
};
export async function loadPropertyLocations(customerId: string, propertyId: string, equipmentDwellingId?: string) {
  const result = await callOfficeBookingAuthority<PropertyLocationData>('list_property_locations', {
    customerId, propertyId, ...(equipmentDwellingId !== undefined ? { includeEquipment: true, dwellingId: equipmentDwellingId } : {}),
  });
  primeLiveSchedulingReferenceCache({ properties: [result.property] });
  return result;
}
export function savePropertyLocations(input: { requestId: string; customerId: string; propertyId: string; expectedVersion: number; kind: 'dwellings' | 'areas'; rows: LocationDraft[] }) {
  return callOfficeBookingAuthority<{ success: true; replayed: boolean; ids: string[]; version: number }>('save_property_locations', input);
}
