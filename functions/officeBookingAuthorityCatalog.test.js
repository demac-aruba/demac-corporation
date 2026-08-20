const test = require("node:test");
const assert = require("node:assert/strict");
const { createOfficeBookingApi, OFFICE_BOOKING_ACTIONS } = require("./officeBookingAuthority");

function docSnapshot(data, exists = true) {
  return { exists, data: () => data };
}

function collectionSnapshot(items = []) {
  return {
    docs: items.map((item) => ({
      id: item.id,
      data: () => {
        const { id, ...data } = item;
        return data;
      },
    })),
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

test("office list_presets isolates Scheduling Work Types from the detailed commercial service catalog", async () => {
  const db = dbFixture({
    services: [{
      id: "service-standard",
      name: "12K BTU Split Unit Standard Service - First Floor",
      itemType: "Servicio",
      active: true,
      featured: true,
      durationMinutes: 90,
      serviceDefinition: {
        version: 1,
        bookingCode: "12k_standard_service",
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
  assert.deepEqual(result.body.presets.map((item) => item.id), [
    "standard_service",
    "deep_cleaning",
    "standard_installation",
    "installation_extended_labor",
    "check_up",
    "leak_repair",
    "commercial_service",
    "other",
  ]);
  assert.equal(result.body.presets.every((item) => item.source === "scheduling_work_types"), true);
  assert.equal(result.body.presets.some((item) => /12k/i.test(item.label)), false);
  assert.equal(result.body.presets.some((item) => item.serviceId === "service-standard"), false);
  assert.equal(result.body.presets.find((item) => item.id === "standard_service").durationMinutesPerUnit, 60);
  assert.equal(result.body.presets.find((item) => item.id === "deep_cleaning").durationMinutesPerUnit, 120);
});