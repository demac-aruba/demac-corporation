import type { LiveConversation } from './browser-communications';

export type CommunicationEquipment = {
  id: string;
  propertyId?: string | null;
  locationLabel: string;
  systemType: string;
  active: boolean;
  condition?: string | null;
};

export type CommunicationProperty = {
  id: string;
  name: string;
  address: string;
  sector?: string | null;
  equipment: CommunicationEquipment[];
};

export type CommunicationCustomerContext = {
  id: string;
  displayName: string;
  phone: string;
  email: string;
  avatarUrl?: string | null;
  type?: string | null;
  status?: string | null;
  preferredLanguage?: string | null;
  tags: string[];
  properties: CommunicationProperty[];
  equipment: CommunicationEquipment[];
};

export async function loadCommunicationCustomerContext(conversation: LiveConversation): Promise<CommunicationCustomerContext | null> {
  if (!conversation.customerId) return null;

  const equipment: CommunicationEquipment[] = (conversation.customerEquipment ?? []).map((unit) => ({
    id: unit.id,
    propertyId: unit.propertyId ?? null,
    locationLabel: unit.locationLabel,
    systemType: unit.systemType,
    active: unit.active,
    condition: unit.condition ?? null,
  }));

  const properties: CommunicationProperty[] = (conversation.customerProperties ?? []).map((property) => ({
    id: property.id,
    name: property.name,
    address: property.address,
    equipment: equipment.filter((unit) => unit.propertyId === property.id),
  }));

  return {
    id: conversation.customerId,
    displayName: conversation.customer,
    phone: conversation.phone,
    email: conversation.customerEmail ?? '',
    avatarUrl: conversation.avatarUrl ?? null,
    type: conversation.customerType ?? null,
    status: conversation.customerStatus ?? null,
    preferredLanguage: conversation.language,
    tags: conversation.vip ? ['VIP'] : [],
    properties,
    equipment,
  };
}
