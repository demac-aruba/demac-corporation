const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OFFICE_BOOKING_ACTIONS,
  buildOfficeProperty,
  createOfficeBookingApi,
  normalizeOfficePhone,
} = require("./officeBookingAuthority");

function snapshot(data, exists = true) {
  return { exists, data: () => data };
}

function createTransactionalDb({
  role = "owner",
  active = true,
  clients = {},
  properties = {},
  contacts = {},
  contactPropertyAssignments = {},
} = {}) {
  const writes = [];
  const docs = new Map();
  for (const [collection, values] of Object.entries({ clients, properties, contacts, contactPropertyAssignments })) {
    for (const [id, value] of Object.entries(values)) docs.set(`${collection}/${id}`, value);
  }

  function ref(collection, id) {
    return { collection, id, path: `${collection}/${id}` };
  }

  function read(reference) {
    if (reference.collection === "users") return snapshot({ role, active, name: "Office Owner" });
    if (reference.collection === "businessSettings" && reference.id === "appointment-work-presets") return snapshot({ presets: [] });
    if (docs.has(reference.path)) return snapshot(docs.get(reference.path));
    return snapshot({}, false);
  }

  return {
    writes,
    docs,
    collection(name) {
      return {
        async get() {
          return {
            docs: [...docs.entries()]
              .filter(([path]) => path.startsWith(`${name}/`))
              .map(([path, value]) => ({ id: path.slice(name.length + 1), data: () => value })),
          };
        },
        where(field, operator, value) {
          assert.equal(operator, "==");
          return {
            async get() {
              return {
                docs: [...docs.entries()]
                  .filter(([path, record]) => path.startsWith(`${name}/`) && record[field] === value)
                  .map(([path, record]) => ({ id: path.slice(name.length + 1), data: () => record })),
              };
            },
          };
        },
        doc(id) {
          const reference = ref(name, id);
          return {
            ...reference,
            async get() {
              return read(reference);
            },
          };
        },
      };
    },
    async runTransaction(callback) {
      const staged = [];
      let writeStarted = false;
      const transaction = {
        async get(reference) {
          if (writeStarted) throw new Error("transaction read after write");
          return read(reference);
        },
        set(reference, value, options = {}) {
          writeStarted = true;
          staged.push({ reference, value, options });
        },
      };
      const result = await callback(transaction);
      for (const item of staged) {
        const current = docs.get(item.reference.path) || {};
        docs.set(item.reference.path, item.options.merge ? { ...current, ...item.value } : item.value);
        writes.push({ path: item.reference.path, value: item.value });
      }
      return result;
    },
  };
}

function request(action, data = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer firebase-token" },
    body: { action, data },
  };
}

const verifyIdToken = async () => ({ uid: "owner-1", email: "owner@demac.test", name: "Christian" });

function createApi(db) {
  return createOfficeBookingApi({
    db,
    verifyIdToken,
    bookingAuthority: {
      async checkAvailability() { return { success: true, available: false, offer: null, options: [] }; },
      async createAppointment() { return { success: true, appointmentId: "APT-1" }; },
      async getAppointment(id) { return { id, appointmentId: id }; },
    },
    schedulingProvider: {},
  });
}

test("booking customer creation writes customer and first property atomically through the office authority", async () => {
  const db = createTransactionalDb();
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY, {
    requestId: "schedule-customer-12345",
    customer: {
      name: "Jane Customer",
      company: "Jane NV",
      legalName: "Jane Customer N.V.",
      type: "Commercial",
      phone: "564-2625",
      whatsapp: "5642625",
      email: "jane@example.com",
      preferredLanguage: "Papiamento",
      zone: "Aruba-wide relationship",
    },
    property: {
      name: "Home",
      type: "Casa",
      address: "Santa Cruz 10",
      zone: "Santa Cruz",
      neighborhood: "Macuarima",
    },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.version, api.version);
  assert.match(result.body.customer.id, /^client-/);
  assert.match(result.body.property.id, /^property-/);
  assert.equal(result.body.property.clientId, result.body.customer.id);
  assert.equal(result.body.customer.phone, "+2975642625");
  assert.equal(result.body.customer.whatsapp, "+2975642625");
  assert.equal(result.body.customer.legalName, "Jane Customer N.V.");
  assert.equal(result.body.customer.type, "Commercial");
  assert.equal(result.body.customer.zone, "Aruba-wide relationship");
  assert.equal(result.body.customer.balance, 0);
  assert.equal(result.body.customer.equipmentCount, 0);
  assert.equal(result.body.customer.createdById, "owner-1");
  assert.equal(result.body.property.createdById, "owner-1");
  assert.equal(db.writes.length, 2);
  assert.deepEqual(db.writes.map((item) => item.path.split("/")[0]).sort(), ["clients", "properties"]);
});

test("new customer, first property, contact and property relationship commit atomically without duplicate embedded contact data", async () => {
  const db = createTransactionalDb();
  const api = createApi(db);
  const data = {
    requestId: "schedule-customer-contact-12345",
    customer: { name: "Commercial Owner", phone: "564-2000" },
    property: {
      name: "Restaurant A",
      type: "Local comercial",
      address: "Noord 100",
      zone: "Noord",
      contactLinks: [{
        contact: { name: "Property Manager", phone: "564-2111", email: "manager@example.com", preferredLanguage: "English" },
        role: "Manager",
        scope: "property",
        appointmentConfirmation: true,
        appointmentReminder: true,
        technicianArrival: true,
        invoice: false,
        serviceReport: true,
      }],
    },
  };
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY, data));
  const retry = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY, data));

  assert.equal(result.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.customer.id, result.body.customer.id);
  assert.equal(retry.body.property.id, result.body.property.id);
  assert.equal(result.body.property.contacts, undefined);
  const collections = db.writes.map((item) => item.path.split("/")[0]).sort();
  assert.deepEqual(collections, ["clients", "contactPropertyAssignments", "contacts", "properties"]);
  const contactWrite = db.writes.find((item) => item.path.startsWith("contacts/"));
  const assignmentWrite = db.writes.find((item) => item.path.startsWith("contactPropertyAssignments/"));
  assert.equal(contactWrite.value.clientId, result.body.customer.id);
  assert.equal(contactWrite.value.email, "manager@example.com");
  assert.equal(assignmentWrite.value.propertyId, result.body.property.id);
  assert.equal(assignmentWrite.value.serviceReport, true);
});

test("booking customer creation performs no partial write when required property data is invalid", async () => {
  const db = createTransactionalDb();
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY, {
    requestId: "schedule-customer-54321",
    customer: { name: "No Address", phone: "564-0000" },
    property: { name: "Home", address: "", zone: "Santa Cruz" },
  }));

  assert.equal(result.status, 409);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error.code, "invalid_request");
  assert.equal(db.writes.length, 0);
});

test("adding a booking property verifies the canonical customer inside the transaction", async () => {
  const db = createTransactionalDb({ clients: { "client-existing": { id: "client-existing", active: true, name: "Existing" } } });
  const api = createApi(db);
  const data = {
    requestId: "schedule-property-12345",
    customerId: "client-existing",
    property: {
      name: "Office",
      type: "Oficina",
      address: "Oranjestad 20",
      zone: "Oranjestad",
    },
  };
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY, data));
  const retry = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY, data));

  assert.equal(result.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.property.id, result.body.property.id);
  assert.equal(result.body.property.clientId, "client-existing");
  assert.equal(result.body.property.type, "Oficina");
  assert.equal(db.writes.length, 1);
  assert.match(db.writes[0].path, /^properties\//);
});

test("adding a booking property rejects missing or inactive customers without writing anything", async () => {
  for (const clients of [{}, { "client-inactive": { id: "client-inactive", active: false } }]) {
    const customerId = Object.keys(clients)[0] || "client-missing";
    const db = createTransactionalDb({ clients });
    const api = createApi(db);
    const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY, {
      requestId: `schedule-property-${customerId}-12345`,
      customerId,
      property: { name: "Office", address: "Oranjestad 20", zone: "Oranjestad" },
    }));

    assert.equal(result.status, 409);
    assert.equal(result.body.error.code, "customer_not_found");
    assert.equal(db.writes.length, 0);
  }
});

test("CRM can create a canonical customer without fabricating a property", async () => {
  const db = createTransactionalDb();
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER, {
    requestId: "crm-customer-create-12345",
    customer: {
      name: "New Customer",
      company: "New Customer NV",
      legalName: "New Customer N.V.",
      type: "Commercial",
      phone: "564-3000",
      whatsapp: "5643001",
      email: "OFFICE@EXAMPLE.COM",
      preferredLanguage: "English",
      zone: "Noord",
    },
  }));

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.success, true);
  assert.match(result.body.customer.id, /^client-/);
  assert.equal(result.body.customer.phone, "+2975643000");
  assert.equal(result.body.customer.whatsapp, "+2975643001");
  assert.equal(result.body.customer.email, "office@example.com");
  assert.equal(result.body.customer.zone, "Noord");
  assert.equal(result.body.customer.address, "");
  assert.equal(result.body.customer.createdById, "owner-1");
  assert.equal(result.body.customer.updatedById, "owner-1");
  assert.equal(db.writes.length, 1);
  assert.match(db.writes[0].path, /^clients\//);
});

test("CRM customer creation is idempotent for the same office request", async () => {
  const db = createTransactionalDb();
  const api = createApi(db);
  const data = {
    requestId: "crm-customer-idempotent-12345",
    customer: { name: "One Canonical Customer", phone: "564-3030", zone: "Noord" },
  };

  const first = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER, data));
  const retry = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER, data));

  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.customer.id, first.body.customer.id);
  assert.equal(retry.body.customer.createdAt, first.body.customer.createdAt);
  assert.equal(db.writes.length, 1);
});

test("CRM rejects reuse of a creation request with a different payload", async () => {
  const db = createTransactionalDb();
  const api = createApi(db);
  const requestId = "crm-customer-conflict-12345";

  await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER, {
    requestId,
    customer: { name: "First Customer", phone: "564-3031" },
  }));
  const conflict = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER, {
    requestId,
    customer: { name: "Different Customer", phone: "564-3032" },
  }));

  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error.code, "idempotency_conflict");
  assert.equal(db.writes.length, 1);
});

test("CRM customer update normalizes communication fields and preserves creation evidence", async () => {
  const createdAt = "2026-08-01T10:00:00.000Z";
  const updatedAt = "2026-08-20T12:00:00.000Z";
  const db = createTransactionalDb({
    clients: {
      "client-existing": {
        id: "client-existing",
        name: "Before",
        phone: "+2975600000",
        whatsapp: "+2975600000",
        balance: 450,
        createdAt,
        createdById: "owner-original",
        updatedAt,
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_CUSTOMER, {
    requestId: "crm-customer-update-12345",
    customerId: "client-existing",
    expectedUpdatedAt: updatedAt,
    changes: { name: "After", phone: "561-1212", email: "AFTER@EXAMPLE.COM", zone: "Oranjestad" },
  }));

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.customer.name, "After");
  assert.equal(result.body.customer.phone, "+2975611212");
  assert.equal(result.body.customer.email, "after@example.com");
  assert.equal(result.body.customer.zone, "Oranjestad");
  assert.equal(result.body.customer.balance, 450);
  assert.equal(result.body.customer.createdAt, createdAt);
  assert.equal(result.body.customer.createdById, "owner-original");
  assert.equal(result.body.customer.updatedById, "owner-1");
  assert.equal(db.writes.length, 1);
});

test("CRM rejects a stale customer edit without overwriting the current record", async () => {
  const db = createTransactionalDb({
    clients: {
      "client-existing": {
        id: "client-existing",
        name: "Current",
        phone: "+2975600000",
        whatsapp: "+2975600000",
        createdAt: "2026-08-01T10:00:00.000Z",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_CUSTOMER, {
    requestId: "crm-customer-stale-12345",
    customerId: "client-existing",
    expectedUpdatedAt: "2026-08-19T12:00:00.000Z",
    changes: { name: "Stale edit" },
  }));

  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.code, "invalid_request");
  assert.equal(result.body.error.details.reason, "stale_record");
  assert.equal(db.writes.length, 0);
  assert.equal(db.docs.get("clients/client-existing").name, "Current");
});

test("CRM compares an Admin SDK Timestamp with the browser ISO version", async () => {
  const updatedAt = "2026-08-20T12:00:00.000Z";
  const db = createTransactionalDb({
    clients: {
      "client-timestamp": {
        id: "client-timestamp",
        name: "Before",
        phone: "+2975600000",
        updatedAt: { _seconds: Date.parse(updatedAt) / 1_000, _nanoseconds: 0 },
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_CUSTOMER, {
    requestId: "crm-customer-timestamp-12345",
    customerId: "client-timestamp",
    expectedUpdatedAt: updatedAt,
    changes: { name: "After" },
  }));

  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.customer.name, "After");
  assert.equal(db.writes.length, 1);
});

test("CRM requires the record version when an existing record already has one", async () => {
  const db = createTransactionalDb({
    clients: {
      "client-versioned": {
        id: "client-versioned",
        name: "Current",
        phone: "+2975600000",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_CUSTOMER, {
    requestId: "crm-customer-missing-version-12345",
    customerId: "client-versioned",
    changes: { name: "Unversioned edit" },
  }));

  assert.equal(result.status, 409, JSON.stringify(result.body));
  assert.equal(result.body.error.details.reason, "missing_record_version");
  assert.equal(db.writes.length, 0);
});

test("CRM property update verifies ownership and preserves its canonical customer", async () => {
  const createdAt = "2026-08-02T10:00:00.000Z";
  const updatedAt = "2026-08-20T12:00:00.000Z";
  const db = createTransactionalDb({
    clients: { "client-existing": { id: "client-existing", active: true } },
    properties: {
      "property-existing": {
        id: "property-existing",
        clientId: "client-existing",
        name: "Before",
        address: "Noord 1",
        zone: "Noord",
        createdAt,
        updatedAt,
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_PROPERTY, {
    requestId: "crm-property-update-12345",
    customerId: "client-existing",
    propertyId: "property-existing",
    expectedUpdatedAt: updatedAt,
    changes: { name: "After", address: "Noord 22", zone: "Malmok", accessInstructions: "Call at gate" },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.property.clientId, "client-existing");
  assert.equal(result.body.property.name, "After");
  assert.equal(result.body.property.address, "Noord 22");
  assert.equal(result.body.property.addressRaw, "Noord 22");
  assert.equal(result.body.property.operationalZone, "Malmok");
  assert.equal(result.body.property.createdAt, createdAt);
  assert.equal(result.body.property.updatedById, "owner-1");
  assert.equal(db.writes.length, 1);
});

test("CRM property update rejects a customer/property mismatch", async () => {
  const db = createTransactionalDb({
    clients: { "client-a": { id: "client-a", active: true } },
    properties: { "property-b": { id: "property-b", clientId: "client-b", address: "Noord 1", zone: "Noord", updatedAt: "2026-08-20T12:00:00.000Z" } },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_PROPERTY, {
    requestId: "crm-property-mismatch-12345",
    customerId: "client-a",
    propertyId: "property-b",
    changes: { name: "Wrong relationship" },
  }));

  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "property_customer_mismatch");
  assert.equal(db.writes.length, 0);
});

test("CRM contact update normalizes channels and preserves contact ownership", async () => {
  const createdAt = "2026-08-03T10:00:00.000Z";
  const updatedAt = "2026-08-20T12:00:00.000Z";
  const db = createTransactionalDb({
    clients: { "client-existing": { id: "client-existing", active: true } },
    contacts: {
      "contact-existing": {
        id: "contact-existing",
        clientId: "client-existing",
        name: "Manager Before",
        phone: "+2975601111",
        whatsapp: "+2975601111",
        email: "before@example.com",
        createdAt,
        updatedAt,
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_CONTACT, {
    requestId: "crm-contact-update-12345",
    customerId: "client-existing",
    contactId: "contact-existing",
    expectedUpdatedAt: updatedAt,
    changes: { name: "Manager After", phone: "562-2222", whatsapp: "5622223", email: "MANAGER@EXAMPLE.COM" },
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.contact.clientId, "client-existing");
  assert.equal(result.body.contact.name, "Manager After");
  assert.equal(result.body.contact.phone, "+2975622222");
  assert.equal(result.body.contact.whatsapp, "+2975622223");
  assert.equal(result.body.contact.email, "manager@example.com");
  assert.equal(result.body.contact.createdAt, createdAt);
  assert.equal(result.body.contact.updatedById, "owner-1");
  assert.equal(db.writes.length, 1);
});

test("CRM contact update rejects a customer/contact mismatch", async () => {
  const db = createTransactionalDb({
    clients: { "client-a": { id: "client-a", active: true } },
    contacts: { "contact-b": { id: "contact-b", clientId: "client-b", name: "Other", email: "other@example.com" } },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_CONTACT, {
    requestId: "crm-contact-mismatch-12345",
    customerId: "client-a",
    contactId: "contact-b",
    changes: { name: "Wrong relationship" },
  }));

  assert.equal(result.status, 409);
  assert.equal(result.body.error.details.reason, "contact_customer_mismatch");
  assert.equal(db.writes.length, 0);
});

test("CRM links an existing customer as a contact without duplicating canonical identity fields", async () => {
  const db = createTransactionalDb({
    clients: {
      "client-office": { id: "client-office", active: true, name: "Office Systems Aruba" },
      "client-person": {
        id: "client-person",
        active: true,
        name: "Existing Residential Customer",
        phone: "+2975601010",
        email: "person@example.com",
      },
    },
    properties: {
      "property-office": { id: "property-office", clientId: "client-office", active: true },
    },
  });
  const api = createApi(db);
  const data = {
    requestId: "crm-link-existing-customer-12345",
    customerId: "client-office",
    propertyId: "property-office",
    link: {
      linkedCustomerId: "client-person",
      scope: "property",
      role: "Primary contact",
      appointmentReminder: true,
    },
  };

  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT, data));
  const contactPaths = [...db.docs.keys()].filter((path) => path.startsWith("contacts/"));
  const assignmentPaths = [...db.docs.keys()].filter((path) => path.startsWith("contactPropertyAssignments/"));
  const firstContactCreatedAt = db.docs.get(contactPaths[0]).createdAt;
  const firstAssignmentCreatedAt = db.docs.get(assignmentPaths[0]).createdAt;
  db.docs.set(contactPaths[0], {
    ...db.docs.get(contactPaths[0]),
    createdById: "original-office-user",
    createdByName: "Original Office User",
  });
  const replay = await api.handle(request(OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT, data));

  assert.equal(result.status, 200);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.contactId, result.body.contactId);
  assert.equal(replay.body.assignmentId, result.body.assignmentId);
  assert.equal(result.body.linkedCustomerId, "client-person");
  assert.equal(contactPaths.length, 1);
  assert.equal(assignmentPaths.length, 1);
  const contact = db.docs.get(contactPaths[0]);
  const assignment = db.docs.get(assignmentPaths[0]);
  assert.equal(contact.clientId, "client-office");
  assert.equal(contact.linkedCustomerId, "client-person");
  assert.equal(contact.identitySource, "linked_customer");
  assert.equal(contact.name, undefined);
  assert.equal(contact.phone, undefined);
  assert.equal(contact.email, undefined);
  assert.equal(assignment.linkedCustomerId, undefined);
  assert.equal(assignment.contactId, contact.id);
  assert.equal(assignment.propertyId, "property-office");
  assert.equal(contact.createdAt, firstContactCreatedAt);
  assert.equal(contact.createdById, "original-office-user");
  assert.equal(contact.createdByName, "Original Office User");
  assert.equal(assignment.createdAt, firstAssignmentCreatedAt);
});

test("contact directory hydrates linked contacts from the current canonical customer profile", async () => {
  const db = createTransactionalDb({
    clients: {
      "client-office": { id: "client-office", active: true, name: "Office Systems Aruba" },
      "client-person": {
        id: "client-person",
        active: true,
        name: "Current Person Name",
        phone: "+2975603030",
        whatsapp: "+2975603031",
        email: "current@example.com",
        preferredLanguage: "English",
      },
    },
    contacts: {
      "contact-linked": {
        id: "contact-linked",
        clientId: "client-office",
        linkedCustomerId: "client-person",
        identitySource: "linked_customer",
        active: true,
      },
    },
    contactPropertyAssignments: {
      "assignment-linked": {
        id: "assignment-linked",
        clientId: "client-office",
        contactId: "contact-linked",
        scope: "all_properties",
        active: true,
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.LIST_CONTACT_DIRECTORY, {
    customerId: "client-office",
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.contacts.length, 1);
  assert.equal(result.body.contacts[0].linkedCustomerId, "client-person");
  assert.equal(result.body.contacts[0].name, "Current Person Name");
  assert.equal(result.body.contacts[0].phone, "+2975603030");
  assert.equal(result.body.contacts[0].whatsapp, "+2975603031");
  assert.equal(result.body.contacts[0].email, "current@example.com");
  assert.equal(result.body.assignments[0].linkedCustomerId, undefined);
});

test("contact directory keeps linked relationship history but marks an inactive source customer inactive", async () => {
  const db = createTransactionalDb({
    clients: {
      "client-office": { id: "client-office", active: true },
      "client-person": { id: "client-person", active: false, name: "Archived Person" },
    },
    contacts: {
      "contact-linked": {
        id: "contact-linked",
        clientId: "client-office",
        linkedCustomerId: "client-person",
        identitySource: "linked_customer",
        active: true,
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.LIST_CONTACT_DIRECTORY, {
    customerId: "client-office",
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.contacts.length, 1);
  assert.equal(result.body.contacts[0].active, false);
  assert.equal(result.body.contacts[0].linkedCustomerActive, false);
});

test("contact directory sanitizes stale identity fields when a linked source customer is missing", async () => {
  const db = createTransactionalDb({
    clients: { "client-office": { id: "client-office", active: true } },
    contacts: {
      "contact-linked": {
        id: "contact-linked",
        clientId: "client-office",
        linkedCustomerId: "client-missing",
        identitySource: "linked_customer",
        name: "Stale Copied Name",
        phone: "+2975609999",
        whatsapp: "+2975609999",
        email: "stale@example.com",
        active: true,
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.LIST_CONTACT_DIRECTORY, {
    customerId: "client-office",
  }));

  assert.equal(result.status, 200);
  assert.equal(result.body.contacts.length, 1);
  assert.equal(result.body.contacts[0].active, false);
  assert.equal(result.body.contacts[0].linkedCustomerActive, false);
  assert.equal(result.body.contacts[0].name, "");
  assert.equal(result.body.contacts[0].phone, "");
  assert.equal(result.body.contacts[0].whatsapp, "");
  assert.equal(result.body.contacts[0].email, "");
});

test("CRM rejects linking a contact to an inactive property", async () => {
  const db = createTransactionalDb({
    clients: {
      "client-office": { id: "client-office", active: true },
      "client-person": { id: "client-person", active: true },
    },
    properties: {
      "property-office": { id: "property-office", clientId: "client-office", active: false },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT, {
    requestId: "crm-link-inactive-property-12345",
    customerId: "client-office",
    propertyId: "property-office",
    link: { linkedCustomerId: "client-person", scope: "property", role: "Contact" },
  }));

  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "property_customer_mismatch");
  assert.equal(db.writes.length, 0);
});

test("CRM rejects linking a contact to a property owned by another customer", async () => {
  const db = createTransactionalDb({
    clients: {
      "client-office": { id: "client-office", active: true },
      "client-other": { id: "client-other", active: true },
      "client-person": { id: "client-person", active: true },
    },
    properties: {
      "property-other": { id: "property-other", clientId: "client-other", active: true },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT, {
    requestId: "crm-link-wrong-property-owner-12345",
    customerId: "client-office",
    propertyId: "property-other",
    link: { linkedCustomerId: "client-person", scope: "property", role: "Contact" },
  }));

  assert.equal(result.status, 409);
  assert.equal(result.body.error.code, "property_customer_mismatch");
  assert.equal(db.writes.length, 0);
});

test("CRM rejects missing, inactive, and self-referential linked customers without writes", async () => {
  const cases = [
    { linkedCustomerId: "client-missing", extraClients: {}, reason: "linked_customer_not_found" },
    { linkedCustomerId: "client-inactive", extraClients: { "client-inactive": { id: "client-inactive", active: false } }, reason: "linked_customer_not_found" },
    { linkedCustomerId: "client-office", extraClients: {}, reason: "linked_customer_self_reference" },
  ];
  for (const entry of cases) {
    const db = createTransactionalDb({
      clients: {
        "client-office": { id: "client-office", active: true },
        ...entry.extraClients,
      },
      properties: { "property-office": { id: "property-office", clientId: "client-office", active: true } },
    });
    const api = createApi(db);
    const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT, {
      requestId: `crm-link-invalid-${entry.linkedCustomerId}-12345`,
      customerId: "client-office",
      propertyId: "property-office",
      link: { linkedCustomerId: entry.linkedCustomerId, scope: "property", role: "Contact" },
    }));

    assert.equal(result.status, 409);
    assert.equal(result.body.error.details.reason, entry.reason);
    assert.equal(db.writes.length, 0);
  }
});

test("CRM rejects an active linked customer profile without a usable canonical identity", async () => {
  const cases = [
    { linkedCustomer: { id: "client-person", active: true, phone: "+2975601010" } },
    { linkedCustomer: { id: "client-person", active: true, name: "No Channel Person" } },
  ];
  for (const entry of cases) {
    const db = createTransactionalDb({
      clients: {
        "client-office": { id: "client-office", active: true },
        "client-person": entry.linkedCustomer,
      },
      properties: { "property-office": { id: "property-office", clientId: "client-office", active: true } },
    });
    const api = createApi(db);
    const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT, {
      requestId: "crm-link-unusable-profile-12345",
      customerId: "client-office",
      propertyId: "property-office",
      link: { linkedCustomerId: "client-person", scope: "property", role: "Contact" },
    }));

    assert.equal(result.status, 409);
    assert.equal(result.body.error.details.reason, "linked_customer_unusable");
    assert.equal(db.writes.length, 0);
  }
});

test("CRM prevents editing a linked customer's identity through the contact projection", async () => {
  const db = createTransactionalDb({
    clients: { "client-office": { id: "client-office", active: true } },
    contacts: {
      "contact-linked": {
        id: "contact-linked",
        clientId: "client-office",
        linkedCustomerId: "client-person",
        identitySource: "linked_customer",
        active: true,
        updatedAt: "2026-08-29T12:00:00.000Z",
      },
    },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_CONTACT, {
    requestId: "crm-linked-contact-update-12345",
    customerId: "client-office",
    contactId: "contact-linked",
    expectedUpdatedAt: "2026-08-29T12:00:00.000Z",
    changes: { name: "Stale duplicate" },
  }));

  assert.equal(result.status, 409);
  assert.equal(result.body.error.details.reason, "linked_customer_contact_read_only");
  assert.equal(db.writes.length, 0);
});

test("linking an existing customer as a contact requires an authorized office role", async () => {
  const db = createTransactionalDb({
    role: "technician",
    clients: {
      "client-office": { id: "client-office", active: true },
      "client-person": { id: "client-person", active: true },
    },
    properties: { "property-office": { id: "property-office", clientId: "client-office", active: true } },
  });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.SAVE_CONTACT_ASSIGNMENT, {
    requestId: "crm-linked-contact-auth-12345",
    customerId: "client-office",
    propertyId: "property-office",
    link: { linkedCustomerId: "client-person", scope: "property", role: "Contact" },
  }));

  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, "permission_denied");
  assert.equal(db.writes.length, 0);
});

test("CRM master-data writes reject an authenticated user without an office role", async () => {
  const db = createTransactionalDb({ role: "technician" });
  const api = createApi(db);
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER, {
    requestId: "crm-customer-auth-12345",
    customer: { name: "Blocked", phone: "564-9999" },
  }));

  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, "permission_denied");
  assert.equal(db.writes.length, 0);
});

test("property name is optional and an empty name remains empty at the canonical write boundary", () => {
  const unnamed = buildOfficeProperty({
    id: "property-empty",
    clientId: "client-1",
    input: { name: "", address: "Caya G. F. Betico Croes 42", zone: "Oranjestad Centro", neighborhood: "Playa" },
    identity: { uid: "owner-1", name: "Office Owner" },
    now: "2026-08-21T12:00:00.000Z",
  });
  const named = buildOfficeProperty({
    id: "property-named",
    clientId: "client-1",
    input: {
      name: "Pastechi House Building",
      address: "Caya G. F. Betico Croes 42",
      zone: "Oranjestad Centro",
      neighborhood: "Playa",
      accessInstructions: "Use the blue side gate",
      landmark: "Across from the post office",
    },
    identity: { uid: "owner-1", name: "Office Owner" },
    now: "2026-08-21T12:00:00.000Z",
  });
  assert.equal(unnamed.name, "");
  assert.equal(named.name, "Pastechi House Building");
  assert.equal(named.accessInstructions, "Use the blue side gate");
  assert.equal(named.landmark, "Across from the post office");
});

test("office phone normalization keeps Aruba booking master data canonical", () => {
  assert.equal(normalizeOfficePhone("564-2625"), "+2975642625");
  assert.equal(normalizeOfficePhone("+297 564 2625"), "+2975642625");
  assert.equal(normalizeOfficePhone("2975642625"), "+2975642625");
  assert.equal(normalizeOfficePhone(""), "");
});
