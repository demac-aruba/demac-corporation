const test = require("node:test");
const assert = require("node:assert/strict");
const { createOfficeBookingApi, OFFICE_BOOKING_ACTIONS } = require("./officeBookingAuthority");

function docSnapshot(data, exists = true) {
  return { exists, data: () => data };
}

function collectionSnapshot(items = []) {
  return {
    docs: items.map((item) => ({ id: item.id, data: () => ({ ...item, id: undefined }) })),
  };
}

function dbFixture({ services = [], presets = [] } = {}) {
  return {
    collection(name) {
      const collection = {
        async get() {
          if (name === "services") return collectionSnapshot(services);
          return collectionSnapshot([]);
        },
        doc(id) {
          return {
            async get() {
              if (name === "users") return docSnapshot({ id, role: "office", active: true, name: "Office User" });
              if (name === "businessSettings" && id === "appointment-work-presets") return docSnapshot({ presets });
              return docSnapshot({}, false);
            },
          };
        },
      };
      return collection;
    },
  };
}

const verifyIdToken = async () => ({ uid: "user-1", email: "office@demac.test" });
const bookingAuthority = {
  async checkAvailability() { return { success: true, available: false, options: [] }; },
  async createAppointment() { return { success: true, appointmentId: "APT-1" }; },
  async getAppointment(id) { return { id, appointmentId: id }; },
};

function request(action) {
  return {
    method: "POST",
    headers: { authorization: "Bearer firebase-token" },
    body: { action, data: {} },
  };
}

test("office list_presets exposes canonical service catalog definitions before legacy duplicates", async () => {
  const db = dbFixture({
    services: [{
      id: "service-standard",
      name: "Standard Service",
      itemType: "Servicio",
      active: true,
      durationMinutes: 90,
      serviceDefinition: {
        version: 1,
        bookingCode: "standard_service",
        quantityUnit: "ac_unit",
        duration: { mode: "per_unit", minutes: 60 },
        allocation: {
          mode: "primary_with_support",
          differentPropertyDailyMaxUnits: 6,
          primaryMaxUnits: 7,
          supportSelection: "operator",
        },
      },
    }],
    presets: [{
      id: "standard_service",
      label: "Standard Service",
      durationMinutesPerUnit: 90,
      active: true,
    }, {
      id: "deep_cleaning",
      label: "Deep Cleaning",
      durationMinutesPerUnit: 120,
      active: true,
    }],
  });
  const api = createOfficeBookingApi({ db, verifyIdToken, bookingAuthority, schedulingProvider: {} });
  const result = await api.handle(request(OFFICE_BOOKING_ACTIONS.LIST_PRESETS));

  assert.equal(result.status, 200);
  assert.equal(result.body.catalogSource, "services");
  assert.deepEqual(result.body.presets.map((item) => item.id), ["standard_service", "deep_cleaning"]);
  assert.equal(result.body.presets[0].source, "service_catalog");
  assert.equal(result.body.presets[0].serviceId, "service-standard");
  assert.equal(result.body.presets[0].durationMinutesPerUnit, 60);
  assert.equal(result.body.presets[1].source, "appointment_work_presets");
});
