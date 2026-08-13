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
  type?: string | null;
  status?: string | null;
  preferredLanguage?: string | null;
  tags: string[];
  properties: CommunicationProperty[];
  equipment: CommunicationEquipment[];
};

export async function loadCommunicationCustomerContext(_conversation: LiveConversation): Promise<CommunicationCustomerContext | null> {
  return null;
}
