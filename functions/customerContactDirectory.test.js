const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyRecipientSelections,
  assignmentIdFor,
  contactIdFor,
  linkedCustomerContactIdFor,
  normalizeContactLink,
  readDocumentSnapshots,
  resolveAppointmentRecipients,
  writeContactLinks,
} = require('./customerContactDirectory');

function documentSnapshot(id, value) {
  return {
    id,
    exists: value !== undefined,
    data: () => value,
  };
}

function collectionSnapshot(items = []) {
  return {
    docs: items.map((item) => documentSnapshot(item.id, Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id')))),
  };
}

function createReadDb(collections) {
  return {
    collection(name) {
      const items = collections[name] || [];
      return {
        async get() { return collectionSnapshot(items); },
        where(field, operator, value) {
          assert.equal(operator, '==');
          return {
            async get() { return collectionSnapshot(items.filter((item) => item[field] === value)); },
          };
        },
        doc(id) {
          return {
            async get() {
              const item = items.find((candidate) => candidate.id === id);
              return documentSnapshot(id, item ? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id')) : undefined);
            },
          };
        },
      };
    },
  };
}

test('contact identity is customer-scoped and stable', () => {
  const first = contactIdFor('client-1', { name: 'Finance', email: 'FINANCE@EXAMPLE.COM' });
  const repeated = contactIdFor('client-1', { name: 'Accounting', email: 'finance@example.com' });
  const otherCustomer = contactIdFor('client-2', { name: 'Finance', email: 'finance@example.com' });
  assert.equal(first, repeated);
  assert.notEqual(first, otherCustomer);
});

test('linked-customer contact projection ids are deterministic and customer-scoped', () => {
  const first = linkedCustomerContactIdFor('client-office', 'client-person');
  const replay = linkedCustomerContactIdFor('client-office', 'client-person');
  const otherBusiness = linkedCustomerContactIdFor('client-other-office', 'client-person');
  assert.equal(first, replay);
  assert.notEqual(first, otherBusiness);
});

test('linked-customer links reject a second manual or existing-contact identity source', () => {
  assert.throws(
    () => normalizeContactLink({ linkedCustomerId: 'client-person', contactId: 'contact-existing' }, {
      clientId: 'client-office', propertyId: 'property-office',
    }),
    (error) => error.details?.reason === 'ambiguous_contact_identity',
  );
  assert.throws(
    () => normalizeContactLink({
      linkedCustomerId: 'client-person',
      contact: { name: 'Stale Person Copy', phone: '+2975601000' },
    }, { clientId: 'client-office', propertyId: 'property-office' }),
    (error) => error.details?.reason === 'ambiguous_contact_identity',
  );
  assert.throws(
    () => normalizeContactLink({ linkedCustomerId: 'client-person', contact: {} }, {
      clientId: 'client-office', propertyId: 'property-office',
    }),
    (error) => error.details?.reason === 'ambiguous_contact_identity',
  );
  assert.throws(
    () => normalizeContactLink({
      contactId: 'contact-existing',
      contact: { name: 'Ignored duplicate payload', phone: '+2975601000' },
    }, { clientId: 'client-office', propertyId: 'property-office' }),
    (error) => error.details?.reason === 'ambiguous_contact_identity',
  );
});

test('linked customer profile reads use bounded Firestore batch requests', async () => {
  const batches = [];
  const refs = Array.from({ length: 205 }, (_, index) => ({ id: `client-${index}` }));
  const db = {
    async getAll(...batch) {
      batches.push(batch);
      return batch.map((ref) => documentSnapshot(ref.id, { active: true }));
    },
  };

  const snapshots = await readDocumentSnapshots(db, refs);
  assert.equal(snapshots.length, 205);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
});

test('property assignment ids keep property and all-properties scopes separate', () => {
  const property = assignmentIdFor({ clientId: 'client-1', contactId: 'contact-1', scope: 'property', propertyId: 'property-1' });
  const all = assignmentIdFor({ clientId: 'client-1', contactId: 'contact-1', scope: 'all_properties', propertyId: 'property-1' });
  assert.notEqual(property, all);
});

test('normalization carries all five communication responsibilities', () => {
  const link = normalizeContactLink({
    contact: { name: 'Supervisor', phone: '564-0000' },
    role: 'Supervisor',
    scope: 'all_properties',
    appointmentConfirmation: true,
    appointmentReminder: false,
    technicianArrival: true,
    invoice: true,
    serviceReport: true,
  }, { clientId: 'client-1', propertyId: 'property-1' });
  assert.equal(link.assignment.scope, 'all_properties');
  assert.equal(link.assignment.appointmentConfirmation, true);
  assert.equal(link.assignment.appointmentReminder, false);
  assert.equal(link.assignment.technicianArrival, true);
  assert.equal(link.assignment.invoice, true);
  assert.equal(link.assignment.serviceReport, true);
});

test('writeContactLinks reads every Firestore snapshot before scheduling writes', async () => {
  const records = new Map();
  const operations = [];
  const db = {
    collection(name) {
      return {
        doc(id) { return { name, id }; },
      };
    },
  };
  const transaction = {
    async get(ref) {
      if (operations.some((item) => item.kind === 'set')) throw new Error('read after write');
      operations.push({ kind: 'get', ref });
      const value = records.get(`${ref.name}/${ref.id}`);
      return documentSnapshot(ref.id, value);
    },
    set(ref, value) {
      operations.push({ kind: 'set', ref, value });
      records.set(`${ref.name}/${ref.id}`, value);
    },
  };

  const result = await writeContactLinks(transaction, db, {
    clientId: 'client-1',
    propertyId: 'property-1',
    identity: { uid: 'office-1', name: 'Office User' },
    now: '2026-08-20T18:00:00.000Z',
    links: [
      { contact: { name: 'Manager', phone: '564-1111' }, role: 'Manager', scope: 'property' },
      { contact: { name: 'Accounting', email: 'accounting@example.com' }, role: 'Accounting', scope: 'all_properties', invoice: true },
    ],
  });

  assert.equal(result.length, 2);
  const firstWrite = operations.findIndex((item) => item.kind === 'set');
  assert.equal(operations.slice(firstWrite).every((item) => item.kind === 'set'), true);
});

test('property-specific assignment overrides all-properties assignment for the same contact', async () => {
  const db = createReadDb({
    clients: [{ id: 'client-1', name: 'Holding Company', phone: '+2975640000', whatsapp: '+2975640000' }],
    properties: [{ id: 'property-1', clientId: 'client-1', name: 'Restaurant A' }],
    contacts: [{ id: 'contact-1', clientId: 'client-1', name: 'Maria', phone: '+2975641111', whatsapp: '+2975641111', active: true }],
    contactPropertyAssignments: [
      { id: 'assign-all', clientId: 'client-1', contactId: 'contact-1', scope: 'all_properties', role: 'Supervisor', appointmentConfirmation: false, appointmentReminder: false, invoice: true, serviceReport: true, active: true },
      { id: 'assign-property', clientId: 'client-1', contactId: 'contact-1', propertyId: 'property-1', scope: 'property', role: 'Manager', appointmentConfirmation: true, appointmentReminder: true, technicianArrival: true, invoice: false, serviceReport: false, active: true },
    ],
  });

  const recipients = await resolveAppointmentRecipients(db, { clientId: 'client-1', propertyId: 'property-1' });
  const maria = recipients.find((recipient) => recipient.sourceId === 'contact-1');
  const customer = recipients.find((recipient) => recipient.recipientType === 'client');
  assert.equal(maria.role, 'Manager');
  assert.equal(maria.sendConfirmation, true);
  assert.equal(maria.sendReminder, true);
  assert.equal(maria.sendInvoice, false);
  assert.equal(customer.sendConfirmation, false);
  assert.equal(customer.sendReminder, false);
});

test('linked customer remains the live identity source for appointment recipients', async () => {
  const linkedCustomer = {
    id: 'client-person',
    name: 'Residential Customer',
    phone: '+2975601000',
    whatsapp: '+2975601001',
    email: 'home@example.com',
    preferredLanguage: 'English',
    active: true,
  };
  const contactId = linkedCustomerContactIdFor('client-office', linkedCustomer.id);
  const db = createReadDb({
    clients: [
      { id: 'client-office', name: 'Office Systems Aruba', phone: '+2975640000', active: true },
      linkedCustomer,
    ],
    properties: [{ id: 'property-office', clientId: 'client-office', name: 'Office' }],
    contacts: [{
      id: contactId,
      clientId: 'client-office',
      linkedCustomerId: linkedCustomer.id,
      identitySource: 'linked_customer',
      active: true,
    }],
    contactPropertyAssignments: [{
      id: 'assignment-linked',
      clientId: 'client-office',
      contactId,
      propertyId: 'property-office',
      scope: 'property',
      role: 'Primary contact',
      appointmentReminder: true,
      active: true,
    }],
  });

  const first = await resolveAppointmentRecipients(db, { clientId: 'client-office', propertyId: 'property-office' });
  const firstContact = first.find((recipient) => recipient.sourceId === contactId);
  assert.equal(firstContact.name, 'Residential Customer');
  assert.equal(firstContact.phone, '+2975601000');
  assert.equal(firstContact.email, 'home@example.com');
  assert.equal(firstContact.linkedCustomerId, 'client-person');

  linkedCustomer.name = 'Residential Customer Updated';
  linkedCustomer.phone = '+2975609999';
  linkedCustomer.email = 'updated@example.com';
  const afterProfileEdit = await resolveAppointmentRecipients(db, { clientId: 'client-office', propertyId: 'property-office' });
  const updatedContact = afterProfileEdit.find((recipient) => recipient.sourceId === contactId);
  assert.equal(firstContact.name, 'Residential Customer', 'a previously captured recipient snapshot must remain unchanged');
  assert.equal(updatedContact.name, 'Residential Customer Updated');
  assert.equal(updatedContact.phone, '+2975609999');
  assert.equal(updatedContact.email, 'updated@example.com');
});

test('recipient resolution never resurrects a missing or inactive contact projection from an assignment', async () => {
  const activeSource = { id: 'client-person', name: 'Residential Customer', phone: '+2975601000', active: true };
  const activeBridge = {
    id: 'contact-linked',
    clientId: 'client-office',
    linkedCustomerId: 'client-person',
    identitySource: 'linked_customer',
    active: true,
  };
  for (const entry of [
    { clients: [activeSource], contacts: [] },
    { clients: [activeSource], contacts: [{ ...activeBridge, active: false }] },
    { clients: [], contacts: [activeBridge] },
    { clients: [{ ...activeSource, active: false }], contacts: [activeBridge] },
  ]) {
    const db = createReadDb({
      clients: [
        { id: 'client-office', name: 'Office Systems Aruba', phone: '+2975640000', active: true },
        ...entry.clients,
      ],
      properties: [{
        id: 'property-office',
        clientId: 'client-office',
        name: 'Office',
        contacts: [{
          id: 'legacy-stale',
          name: 'Stale Legacy Recipient',
          phone: '+2975609999',
          defaultSendReminder: true,
          active: true,
        }],
      }],
      contacts: entry.contacts,
      contactPropertyAssignments: [{
        id: 'assignment-linked',
        clientId: 'client-office',
        contactId: 'contact-linked',
        linkedCustomerId: 'client-person',
        propertyId: 'property-office',
        scope: 'property',
        appointmentReminder: true,
        active: true,
      }],
    });

    const recipients = await resolveAppointmentRecipients(db, { clientId: 'client-office', propertyId: 'property-office' });
    assert.equal(recipients.some((recipient) => recipient.sourceId === 'contact-linked'), false);
    assert.equal(recipients.some((recipient) => recipient.source === 'legacy_property_contact'), false, 'a canonical assignment must suppress stale legacy fallback even when its linked identity is unusable');
  }
});

test('Legacy property contacts remain a notification fallback when canonical assignments do not exist', async () => {
  const db = createReadDb({
    clients: [{ id: 'client-1', name: 'Legacy Owner', phone: '+2975640000', whatsapp: '+2975640000' }],
    properties: [{
      id: 'property-legacy',
      clientId: 'client-1',
      name: 'Legacy Restaurant',
      contacts: [{
        id: 'legacy-manager',
        name: 'Legacy Manager',
        role: 'Encargado',
        phone: '+2975642222',
        whatsapp: '+2975642222',
        preferredLanguage: 'Papiamento',
        defaultSendConfirmation: true,
        defaultSendReminder: true,
        arrivalContact: true,
        active: true,
      }],
    }],
    contacts: [],
    contactPropertyAssignments: [],
  });

  const recipients = await resolveAppointmentRecipients(db, { clientId: 'client-1', propertyId: 'property-legacy' });
  const legacy = recipients.find((recipient) => recipient.source === 'legacy_property_contact');
  assert.ok(legacy);
  assert.equal(legacy.name, 'Legacy Manager');
  assert.equal(legacy.sendConfirmation, true);
  assert.equal(legacy.sendReminder, true);
});

test('appointment recipient overrides change only confirmation/reminder for that appointment', () => {
  const recipients = [{ recipientType: 'contact', sourceId: 'contact-1', sendConfirmation: true, sendReminder: true, sendInvoice: true }];
  const result = applyRecipientSelections(recipients, [{ recipientType: 'contact', sourceId: 'contact-1', sendConfirmation: false, sendReminder: true }]);
  assert.equal(result[0].sendConfirmation, false);
  assert.equal(result[0].sendReminder, true);
  assert.equal(result[0].sendInvoice, true);
});

test('resolver preserves an explicit appointment confirmation opt-out even when the customer default is on', async () => {
  const db = createReadDb({
    clients: [{ id: 'client-1', name: 'Stefany', phone: '+2975640000', whatsapp: '+2975640000', preferredLanguage: 'Papiamento' }],
    properties: [{ id: 'property-1', clientId: 'client-1', name: 'Primary Property' }],
    contacts: [],
    contactPropertyAssignments: [],
  });
  const recipients = await resolveAppointmentRecipients(db, {
    clientId: 'client-1',
    propertyId: 'property-1',
    selections: [{ recipientType: 'client', sourceId: 'client-1', sendConfirmation: false, sendReminder: true }],
  });
  assert.equal(recipients.length, 1);
  assert.equal(recipients[0].sendConfirmation, false);
  assert.equal(recipients[0].sendReminder, true);
  assert.equal(recipients[0].preferredLanguage, 'Papiamento');
});
