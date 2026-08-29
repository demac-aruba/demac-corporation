import assert from 'node:assert/strict';
import {
  buildLiveCrmSnapshot,
  effectiveLiveCrmAssignmentsForProperty,
  joinLiveCrmCustomer,
  liveCrmPeopleRelationships,
  loadLiveCrmSnapshot,
  searchLiveCrmCustomers,
  type LiveCrmDataSource,
} from '../lib/live-crm';

const canonicalInput = {
  clients: [
    {
      id: 'client-iza',
      name: 'Izaíra Mansur',
      company: 'California Lighthouse Z/N',
      phone: '+297 560 1111',
      whatsapp: '+297 560 1111',
      email: 'izaira@example.com',
      preferredLanguage: 'Papiamento',
      address: 'L.G. Smith Blvd 548',
      zone: 'Noord',
      balance: 75,
      active: true,
      createdAt: '2026-08-01T12:00:00.000Z',
      updatedAt: '2026-08-28T12:00:00.000Z',
    },
    {
      id: 'client-archived',
      name: 'Archived Relationship',
      phone: '+297 555 0000',
      active: false,
    },
  ],
  properties: [
    {
      id: 'property-home',
      clientId: 'client-iza',
      name: 'Residence',
      type: 'Casa',
      address: 'L.G. Smith Blvd 548',
      neighborhood: 'Malmok',
      zone: 'Noord',
      operationalZone: 'Malmok / Arashi',
      active: true,
    },
    {
      id: 'property-office',
      clientId: 'client-iza',
      name: 'Office',
      type: 'Oficina',
      address: 'Wayaca 268A',
      neighborhood: 'Wayaca',
      zone: 'Oranjestad',
      active: true,
    },
    {
      id: 'property-foreign',
      clientId: 'client-archived',
      name: 'Archived Site',
      address: 'San Nicolas',
      active: true,
    },
  ],
  contacts: [
    {
      id: 'contact-manager',
      clientId: 'client-iza',
      name: 'Marisol Manager',
      phone: '+297 563 9999',
      whatsapp: '+297 563 9999',
      email: 'manager@example.com',
      active: true,
    },
    {
      id: 'contact-tenant',
      clientId: 'client-iza',
      name: 'Tania Tenant',
      phone: '+297 562 8888',
      active: true,
    },
    {
      id: 'contact-old',
      clientId: 'client-iza',
      name: 'Former Contact',
      phone: '+297 561 7777',
      active: false,
    },
  ],
  assignments: [
    {
      id: 'assignment-manager-all',
      clientId: 'client-iza',
      contactId: 'contact-manager',
      scope: 'all_properties' as const,
      role: 'Administrator',
      active: true,
    },
    {
      id: 'assignment-manager-office',
      clientId: 'client-iza',
      contactId: 'contact-manager',
      propertyId: 'property-office',
      scope: 'property' as const,
      role: 'Office manager',
      active: true,
    },
    {
      id: 'assignment-tenant-home',
      clientId: 'client-iza',
      contactId: 'contact-tenant',
      propertyId: 'property-home',
      scope: 'property' as const,
      role: 'Tenant',
      active: true,
    },
  ],
  equipment: [
    {
      id: 'equipment-client',
      clientId: 'client-iza',
      propertyId: 'property-home',
      locationLabel: 'Living room',
      systemType: 'Split',
      active: true,
    },
    {
      id: 'equipment-property-only',
      propertyId: 'property-office',
      locationLabel: 'Front office',
      systemType: 'Cassette',
      active: true,
    },
    {
      id: 'equipment-foreign',
      clientId: 'client-archived',
      propertyId: 'property-foreign',
      locationLabel: 'Archive room',
      active: true,
    },
  ],
  workOrders: [
    {
      id: 'WO-open',
      clientId: 'client-iza',
      propertyId: 'property-home',
      status: 'Confirmada',
      date: '2026-08-29',
    },
    {
      id: 'WO-completed',
      propertyId: 'property-office',
      status: 'Completada',
      date: '2026-08-20',
    },
    {
      id: 'WO-foreign',
      customerId: 'client-archived',
      siteId: 'property-foreign',
      status: 'closed',
    },
  ],
};

async function run() {
  const empty = buildLiveCrmSnapshot({
    clients: [],
    properties: [],
    contacts: [],
    assignments: [],
    equipment: [],
    workOrders: [],
    loadedAt: '2026-08-28T00:00:00.000Z',
  });
  assert.equal(empty.clients.length, 0, 'an empty canonical source must stay empty; the CRM layer must never seed demo customers');
  assert.equal(searchLiveCrmCustomers(empty, '').length, 0, 'empty canonical data must not produce fixture search results');

  const snapshot = buildLiveCrmSnapshot({ ...canonicalInput, loadedAt: '2026-08-28T00:00:00.000Z' });
  const graph = joinLiveCrmCustomer(snapshot, 'client-iza');
  assert(graph, 'the canonical customer graph should join by client id');
  assert.equal(graph.properties.length, 2, 'only properties belonging to the selected client should join');
  assert.equal(graph.contacts.length, 3, 'all persisted contacts remain visible in total facts, including inactive history');
  assert.equal(graph.facts.activeContactCount, 2, 'active contact facts should exclude archived contacts');
  assert.equal(graph.equipment.length, 2, 'equipment should join by client id or by a property owned by the client');
  assert.equal(graph.workOrders.length, 2, 'work orders should join by client id or canonical property id');
  assert.equal(graph.facts.openWorkOrderCount, 1, 'completed work must not count as open');
  assert.equal(graph.facts.outstandingBalance, 75, 'customer financial facts must be read from the canonical client record');

  assert.deepEqual(searchLiveCrmCustomers(snapshot, 'Izaíra').map((item) => item.client.id), ['client-iza'], 'customer-name search should be accent-insensitive');
  assert.deepEqual(searchLiveCrmCustomers(snapshot, 'smith 548').map((item) => item.client.id), ['client-iza'], 'property-address terms should resolve the owning customer');
  assert.deepEqual(searchLiveCrmCustomers(snapshot, '563-9999').map((item) => item.client.id), ['client-iza'], 'contact-phone search should resolve the owning customer');
  assert.deepEqual(searchLiveCrmCustomers(snapshot, '2975639999').map((item) => item.client.id), ['client-iza'], 'compact phone search should ignore stored phone formatting');
  assert.deepEqual(searchLiveCrmCustomers(snapshot, 'tenant').map((item) => item.client.id), ['client-iza'], 'contact role search should resolve the owning customer');
  assert.equal(searchLiveCrmCustomers(snapshot, 'ABC Aruba N.V.').length, 0, 'the canonical layer must not inject the former demo customer fixture');
  assert.equal(searchLiveCrmCustomers(snapshot, 'Archived Relationship').length, 0, 'inactive clients should be hidden by default');
  assert.deepEqual(searchLiveCrmCustomers(snapshot, 'Archived Relationship', { includeInactive: true }).map((item) => item.client.id), ['client-archived'], 'inactive clients should remain available to an explicit archive view');

  const effectiveAtOffice = effectiveLiveCrmAssignmentsForProperty(snapshot, 'client-iza', 'property-office');
  assert.equal(effectiveAtOffice.filter((item) => item.contactId === 'contact-manager').length, 1, 'a property-specific assignment should override the all-properties assignment for that contact');
  assert.equal(effectiveAtOffice.find((item) => item.contactId === 'contact-manager')?.role, 'Office manager');

  const people = liveCrmPeopleRelationships(snapshot, 'client-iza');
  assert.equal(people[0].kind, 'owner', 'the canonical client must be represented separately as the property owner/customer');
  assert.deepEqual(people[0].properties.map((property) => property.id).sort(), ['property-home', 'property-office']);
  const tenant = people.find((person) => person.id === 'contact:contact-tenant');
  assert.equal(tenant?.kind, 'contact');
  assert.deepEqual(tenant?.properties.map((property) => property.id), ['property-home'], 'a property contact must expose the exact property relationship');

  const calls = new Map<string, number>();
  const counted = <T>(name: string, value: T) => async () => {
    calls.set(name, (calls.get(name) ?? 0) + 1);
    return value;
  };
  const source: LiveCrmDataSource = {
    listClients: counted('clients', canonicalInput.clients),
    listProperties: counted('properties', canonicalInput.properties),
    listEquipment: counted('equipment', canonicalInput.equipment),
    listWorkOrders: counted('workOrders', canonicalInput.workOrders),
    listContactDirectory: counted('directory', { contacts: canonicalInput.contacts, assignments: canonicalInput.assignments }),
  };
  const loaded = await loadLiveCrmSnapshot(source);
  assert.equal(joinLiveCrmCustomer(loaded, 'client-iza')?.facts.propertyCount, 2, 'the provider-neutral loader should build the same canonical graph');
  assert.deepEqual(Object.fromEntries(calls), { clients: 1, properties: 1, equipment: 1, workOrders: 1, directory: 1 }, 'each authenticated source should be loaded exactly once');

  console.log('CRM canonical acceptance passed');
}

void run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
