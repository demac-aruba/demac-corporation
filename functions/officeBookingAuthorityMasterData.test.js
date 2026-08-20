const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OFFICE_BOOKING_ACTIONS,
  createOfficeBookingApi,
  normalizeOfficePhone,
} = require("./officeBookingAuthority");

function snapshot(data, exists = true) {
  return { exists, data: () => data };
}

function createTransactionalDb({ role = "owner", active = true, clients = {} } = {}) {
  const writes = [];
  const docs = new Map();
  for (const [id, value] of Object.entries(clients)) docs.set(`clients/${id}`, value);

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
        set(reference, value) {
          writeStarted = true;
          staged.push({ reference, value });
        },
      };
      const result = await callback(transaction);
      for (const item of staged) {
        docs.set(item.reference.path, item.value);
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
      phone: "564-2625",
      whatsapp: "5642625",
      email: "jane@example.com",
      preferredLanguage: "Papiamento",
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
  assert.equal(result.body.version, 10);
  assert.match(result.body.customer.id, /^client-/);
  assert.match(result.body.property.id, /^property-/);
  assert.equal(result.body.property.clientId, result.body.customer.id);
  assert.equal(result.body.customer.phone, "+2975642625");
  assert.equal(result.body.customer.whatsapp, "+2975642625");
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
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_CUSTOMER_PROPERTY, {
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
  }));

  assert.equal(result.status, 200);
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
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.CREATE_PROPERTY, {
    requestId: "schedule-property-12345",
    customerId: "client-existing",
    property: {
      name: "Office",
      type: "Oficina",
      address: "Oranjestad 20",
      zone: "Oranjestad",
    },
  }));

  assert.equal(result.status, 200);
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

test("office phone normalization keeps Aruba booking master data canonical", () => {
  assert.equal(normalizeOfficePhone("564-2625"), "+2975642625");
  assert.equal(normalizeOfficePhone("+297 564 2625"), "+2975642625");
  assert.equal(normalizeOfficePhone("2975642625"), "+2975642625");
  assert.equal(normalizeOfficePhone(""), "");
});
