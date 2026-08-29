import { listOfficeContactDirectory } from './office-booking-authority';
import { listFirestoreCollection } from './firebase/firestore-rest';

export type LiveCrmClient = {
  id: string;
  name?: string;
  company?: string;
  legalName?: string;
  type?: string;
  phone?: string;
  phoneCountry?: string;
  whatsapp?: string;
  whatsappCountry?: string;
  email?: string;
  preferredLanguage?: string;
  address?: string;
  zone?: string;
  balance?: number;
  equipmentCount?: number;
  lastService?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type LiveCrmProperty = {
  id: string;
  clientId: string;
  name?: string;
  type?: string;
  address?: string;
  addressRaw?: string;
  addressNormalized?: string;
  neighborhood?: string;
  zone?: string;
  operationalZone?: string;
  notes?: string;
  accessInstructions?: string;
  landmark?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type LiveCrmContact = {
  id: string;
  clientId: string;
  name: string;
  phone?: string;
  phoneCountry?: string;
  whatsapp?: string;
  whatsappCountry?: string;
  email?: string;
  preferredLanguage?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type LiveCrmContactScope = 'property' | 'all_properties';

export type LiveCrmContactAssignment = {
  id: string;
  clientId: string;
  contactId: string;
  scope: LiveCrmContactScope;
  propertyId?: string;
  role?: string;
  appointmentConfirmation?: boolean;
  appointmentReminder?: boolean;
  technicianArrival?: boolean;
  invoice?: boolean;
  serviceReport?: boolean;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type LiveCrmEquipment = {
  id: string;
  clientId?: string;
  propertyId?: string;
  locationLabel?: string;
  systemType?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  capacityBtu?: number;
  qrCode?: string;
  condition?: string;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type LiveCrmWorkOrder = {
  id: string;
  clientId?: string;
  customerId?: string;
  propertyId?: string;
  siteId?: string;
  appointmentId?: string;
  status?: string;
  date?: string;
  time?: string;
  problem?: string;
  customerFacingDescription?: string;
  amount?: number;
  paid?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type LiveCrmSnapshot = {
  clients: LiveCrmClient[];
  properties: LiveCrmProperty[];
  contacts: LiveCrmContact[];
  assignments: LiveCrmContactAssignment[];
  equipment: LiveCrmEquipment[];
  workOrders: LiveCrmWorkOrder[];
  loadedAt: string;
};

export type LiveCrmCustomerFacts = {
  propertyCount: number;
  activePropertyCount: number;
  contactCount: number;
  activeContactCount: number;
  equipmentCount: number;
  activeEquipmentCount: number;
  workOrderCount: number;
  openWorkOrderCount: number;
  outstandingBalance: number | null;
  createdAt?: string;
  updatedAt?: string;
  lastService?: string;
};

export type LiveCrmContactRelationship = {
  contact: LiveCrmContact;
  assignments: LiveCrmContactAssignment[];
  roles: string[];
  scope: LiveCrmContactScope | 'mixed' | 'unassigned';
  properties: LiveCrmProperty[];
};

export type LiveCrmPersonRelationship = {
  id: string;
  kind: 'owner' | 'contact';
  name: string;
  phone: string;
  whatsapp: string;
  email: string;
  roles: string[];
  scope: 'all_properties' | 'property' | 'mixed' | 'unassigned';
  properties: LiveCrmProperty[];
  contact?: LiveCrmContact;
};

export type LiveCrmCustomerGraph = {
  client: LiveCrmClient;
  properties: LiveCrmProperty[];
  contacts: LiveCrmContact[];
  assignments: LiveCrmContactAssignment[];
  contactRelationships: LiveCrmContactRelationship[];
  people: LiveCrmPersonRelationship[];
  equipment: LiveCrmEquipment[];
  workOrders: LiveCrmWorkOrder[];
  facts: LiveCrmCustomerFacts;
};

export type LiveCrmDataSource = {
  listClients(): Promise<LiveCrmClient[]>;
  listProperties(): Promise<LiveCrmProperty[]>;
  listEquipment(): Promise<LiveCrmEquipment[]>;
  listWorkOrders(): Promise<LiveCrmWorkOrder[]>;
  listContactDirectory(): Promise<{
    contacts: LiveCrmContact[];
    assignments: LiveCrmContactAssignment[];
  }>;
};

export type LiveCrmSearchOptions = {
  includeInactive?: boolean;
  limit?: number;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedSearchText(value: unknown) {
  return text(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function active<T extends { active?: boolean }>(items: T[]) {
  return items.filter((item) => item.active !== false);
}

function uniqueById<T extends { id: string }>(items: T[]) {
  return [...new Map(items.filter((item) => text(item.id)).map((item) => [item.id, item])).values()];
}

function sortedByName<T extends { id: string; name?: string }>(items: T[]) {
  return [...items].sort((left, right) => (text(left.name) || left.id).localeCompare(text(right.name) || right.id, 'en', { sensitivity: 'base' }));
}

export function workOrderClientId(workOrder: LiveCrmWorkOrder) {
  return text(workOrder.clientId) || text(workOrder.customerId);
}

export function workOrderPropertyId(workOrder: LiveCrmWorkOrder) {
  return text(workOrder.propertyId) || text(workOrder.siteId);
}

export function isOpenLiveCrmWorkOrder(workOrder: LiveCrmWorkOrder) {
  const status = normalizedSearchText(workOrder.status).replaceAll(' ', '_');
  if (!status) return true;
  return !new Set([
    'cancelled',
    'canceled',
    'closed',
    'completed',
    'cancelada',
    'cancelado',
    'cerrada',
    'cerrado',
    'completada',
    'completado',
    'facturada',
    'facturado',
    'pagada',
    'pagado',
  ]).has(status);
}

export function propertiesForLiveCrmClient(snapshot: LiveCrmSnapshot, clientId: string, includeInactive = true) {
  const matching = snapshot.properties.filter((property) => property.clientId === clientId && (includeInactive || property.active !== false));
  return sortedByName(matching);
}

export function contactsForLiveCrmClient(snapshot: LiveCrmSnapshot, clientId: string, includeInactive = true) {
  const matching = snapshot.contacts.filter((contact) => contact.clientId === clientId && (includeInactive || contact.active !== false));
  return sortedByName(matching);
}

export function assignmentsForLiveCrmClient(snapshot: LiveCrmSnapshot, clientId: string, includeInactive = true) {
  return snapshot.assignments.filter((assignment) => assignment.clientId === clientId && (includeInactive || assignment.active !== false));
}

export function effectiveLiveCrmAssignmentsForProperty(snapshot: LiveCrmSnapshot, clientId: string, propertyId: string) {
  const effective = new Map<string, LiveCrmContactAssignment>();
  assignmentsForLiveCrmClient(snapshot, clientId, false)
    .filter((assignment) => assignment.scope === 'all_properties' || assignment.propertyId === propertyId)
    .sort((left, right) => Number(left.scope === 'property') - Number(right.scope === 'property'))
    .forEach((assignment) => effective.set(assignment.contactId, assignment));
  return [...effective.values()];
}

export function equipmentForLiveCrmClient(snapshot: LiveCrmSnapshot, clientId: string, includeInactive = true) {
  const propertyIds = new Set(propertiesForLiveCrmClient(snapshot, clientId, true).map((property) => property.id));
  return snapshot.equipment.filter((item) => {
    const belongs = item.clientId === clientId || Boolean(item.propertyId && propertyIds.has(item.propertyId));
    return belongs && (includeInactive || item.active !== false);
  });
}

export function workOrdersForLiveCrmClient(snapshot: LiveCrmSnapshot, clientId: string) {
  const propertyIds = new Set(propertiesForLiveCrmClient(snapshot, clientId, true).map((property) => property.id));
  return snapshot.workOrders.filter((workOrder) => workOrderClientId(workOrder) === clientId
    || Boolean(workOrderPropertyId(workOrder) && propertyIds.has(workOrderPropertyId(workOrder))));
}

export function liveCrmContactRelationships(snapshot: LiveCrmSnapshot, clientId: string): LiveCrmContactRelationship[] {
  const properties = propertiesForLiveCrmClient(snapshot, clientId, false);
  const propertyById = new Map(properties.map((property) => [property.id, property]));
  const customerAssignments = assignmentsForLiveCrmClient(snapshot, clientId, false);

  return contactsForLiveCrmClient(snapshot, clientId, false).map((contact) => {
    const assignments = customerAssignments.filter((assignment) => assignment.contactId === contact.id);
    const allProperties = assignments.some((assignment) => assignment.scope === 'all_properties');
    const assignedProperties = allProperties
      ? properties
      : uniqueById(assignments.flatMap((assignment) => assignment.propertyId && propertyById.has(assignment.propertyId) ? [propertyById.get(assignment.propertyId)!] : []));
    const scopes = new Set(assignments.map((assignment) => assignment.scope));
    const scope: LiveCrmContactRelationship['scope'] = !assignments.length
      ? 'unassigned'
      : scopes.size > 1
        ? 'mixed'
        : assignments[0].scope;
    return {
      contact,
      assignments,
      roles: [...new Set(assignments.map((assignment) => text(assignment.role)).filter(Boolean))],
      scope,
      properties: assignedProperties,
    };
  });
}

export function liveCrmPeopleRelationships(snapshot: LiveCrmSnapshot, clientId: string): LiveCrmPersonRelationship[] {
  const client = snapshot.clients.find((candidate) => candidate.id === clientId);
  if (!client) return [];
  const properties = propertiesForLiveCrmClient(snapshot, clientId, false);
  const owner: LiveCrmPersonRelationship = {
    id: `owner:${client.id}`,
    kind: 'owner',
    name: text(client.name) || text(client.company) || client.id,
    phone: text(client.phone),
    whatsapp: text(client.whatsapp),
    email: text(client.email),
    roles: ['Customer / owner'],
    scope: 'all_properties',
    properties,
  };
  const contacts = liveCrmContactRelationships(snapshot, clientId).map<LiveCrmPersonRelationship>((relationship) => ({
    id: `contact:${relationship.contact.id}`,
    kind: 'contact',
    name: text(relationship.contact.name) || relationship.contact.id,
    phone: text(relationship.contact.phone),
    whatsapp: text(relationship.contact.whatsapp),
    email: text(relationship.contact.email),
    roles: relationship.roles.length ? relationship.roles : ['Contact'],
    scope: relationship.scope,
    properties: relationship.properties,
    contact: relationship.contact,
  }));
  return [owner, ...contacts];
}

export function joinLiveCrmCustomer(snapshot: LiveCrmSnapshot, clientId: string): LiveCrmCustomerGraph | null {
  const client = snapshot.clients.find((candidate) => candidate.id === clientId);
  if (!client) return null;
  const properties = propertiesForLiveCrmClient(snapshot, clientId, true);
  const contacts = contactsForLiveCrmClient(snapshot, clientId, true);
  const assignments = assignmentsForLiveCrmClient(snapshot, clientId, true);
  const equipment = equipmentForLiveCrmClient(snapshot, clientId, true);
  const workOrders = workOrdersForLiveCrmClient(snapshot, clientId);
  return {
    client,
    properties,
    contacts,
    assignments,
    contactRelationships: liveCrmContactRelationships(snapshot, clientId),
    people: liveCrmPeopleRelationships(snapshot, clientId),
    equipment,
    workOrders,
    facts: {
      propertyCount: properties.length,
      activePropertyCount: active(properties).length,
      contactCount: contacts.length,
      activeContactCount: active(contacts).length,
      equipmentCount: equipment.length,
      activeEquipmentCount: active(equipment).length,
      workOrderCount: workOrders.length,
      openWorkOrderCount: workOrders.filter(isOpenLiveCrmWorkOrder).length,
      outstandingBalance: Number.isFinite(Number(client.balance)) ? Number(client.balance) : null,
      createdAt: text(client.createdAt) || undefined,
      updatedAt: text(client.updatedAt) || undefined,
      lastService: text(client.lastService) || undefined,
    },
  };
}

export function joinLiveCrmCustomers(snapshot: LiveCrmSnapshot, includeInactive = false) {
  return sortedByName(snapshot.clients.filter((client) => includeInactive || client.active !== false))
    .flatMap((client) => {
      const graph = joinLiveCrmCustomer(snapshot, client.id);
      return graph ? [graph] : [];
    });
}

function graphSearchValues(graph: LiveCrmCustomerGraph) {
  const client = graph.client;
  return [
    client.id,
    client.name,
    client.company,
    client.legalName,
    client.type,
    client.phone,
    client.whatsapp,
    client.email,
    client.address,
    client.zone,
    ...graph.properties.flatMap((property) => [
      property.id,
      property.name,
      property.type,
      property.address,
      property.addressRaw,
      property.addressNormalized,
      property.neighborhood,
      property.zone,
      property.operationalZone,
    ]),
    ...graph.contacts.flatMap((contact) => [contact.id, contact.name, contact.phone, contact.whatsapp, contact.email]),
    ...graph.assignments.map((assignment) => assignment.role),
  ].flatMap((value) => {
    const normalized = normalizedSearchText(value);
    if (!normalized) return [];
    const compact = normalized.replaceAll(' ', '');
    return compact === normalized ? [normalized] : [normalized, compact];
  });
}

export function searchLiveCrmCustomers(snapshot: LiveCrmSnapshot, query: string, options: LiveCrmSearchOptions = {}) {
  const graphs = joinLiveCrmCustomers(snapshot, options.includeInactive === true);
  const tokens = normalizedSearchText(query).split(' ').filter(Boolean);
  const matching = !tokens.length
    ? graphs
    : graphs.filter((graph) => {
      const values = graphSearchValues(graph);
      return tokens.every((token) => values.some((value) => value.includes(token)));
    });
  const limit = Math.max(1, Math.min(5_000, Math.round(options.limit ?? 1_000)));
  return matching.slice(0, limit);
}

export function buildLiveCrmSnapshot(input: Omit<LiveCrmSnapshot, 'loadedAt'> & { loadedAt?: string }): LiveCrmSnapshot {
  return {
    clients: uniqueById(input.clients),
    properties: uniqueById(input.properties),
    contacts: uniqueById(input.contacts),
    assignments: uniqueById(input.assignments),
    equipment: uniqueById(input.equipment),
    workOrders: uniqueById(input.workOrders),
    loadedAt: text(input.loadedAt) || new Date().toISOString(),
  };
}

const firebaseLiveCrmDataSource: LiveCrmDataSource = {
  listClients: () => listFirestoreCollection<LiveCrmClient>('clients', 1_000),
  listProperties: () => listFirestoreCollection<LiveCrmProperty>('properties', 1_000),
  listEquipment: () => listFirestoreCollection<LiveCrmEquipment>('equipmentSystems', 1_000),
  listWorkOrders: () => listFirestoreCollection<LiveCrmWorkOrder>('workOrders', 1_000),
  listContactDirectory: async () => {
    const directory = await listOfficeContactDirectory();
    return {
      contacts: directory.contacts as LiveCrmContact[],
      assignments: directory.assignments as LiveCrmContactAssignment[],
    };
  },
};

export async function loadLiveCrmSnapshot(source: LiveCrmDataSource = firebaseLiveCrmDataSource) {
  const [clients, properties, equipment, workOrders, directory] = await Promise.all([
    source.listClients(),
    source.listProperties(),
    source.listEquipment(),
    source.listWorkOrders(),
    source.listContactDirectory(),
  ]);
  return buildLiveCrmSnapshot({
    clients,
    properties,
    contacts: directory.contacts,
    assignments: directory.assignments,
    equipment,
    workOrders,
  });
}
