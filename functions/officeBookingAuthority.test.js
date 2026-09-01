const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OFFICE_BOOKING_ACTIONS,
  bookingRequestFromOffice,
  createOfficeBookingApi,
} = require("./officeBookingAuthority");

function snapshot(data, exists = true) {
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

function createDb({ role = "office", active = true, presets = [], appointments = {}, services = [] } = {}) {
  return {
    collection(name) {
      return {
        async get() {
          if (name === "services") return collectionSnapshot(services);
          return collectionSnapshot([]);
        },
        doc(id) {
          return {
            async get() {
              if (name === "users") return snapshot({ id, role, active, name: "Office User" });
              if (name === "businessSettings" && id === "appointment-work-presets") return snapshot({ presets });
              if (name === "appointments") return Object.prototype.hasOwnProperty.call(appointments, id)
                ? snapshot(appointments[id])
                : snapshot({}, false);
              return snapshot({}, false);
            },
          };
        },
      };
    },
  };
}

function request(body, token = "firebase-token") {
  return {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  };
}

function createAuthority(overrides = {}) {
  return {
    async checkAvailability(args) {
      return { success: true, available: true, offer: { id: "OFR-1", version: 1 }, options: [], args };
    },
    async createAppointment(args) {
      return { success: true, appointmentId: "APT-REAL-1", appointment: { id: "APT-REAL-1" }, args };
    },
    async getAppointment(id) {
      return { id, appointmentId: id, status: "confirmed" };
    },
    ...overrides,
  };
}

function createLifecycle(overrides = {}) {
  return {
    async cancelAppointment(args) {
      return { success: true, appointmentId: args.appointmentId, appointment: { id: args.appointmentId, status: "cancelled" }, args };
    },
    async rescheduleAppointment(args) {
      return { success: true, appointmentId: args.appointmentId, appointment: { id: args.appointmentId, status: "confirmed" }, args };
    },
    ...overrides,
  };
}

const verifyIdToken = async () => ({ uid: "user-1", email: "office@demac.test" });

test("office request maps to canonical Booking Authority request without inventing a preset", () => {
  const mapped = bookingRequestFromOffice({
    customerId: "client-1",
    propertyId: "property-1",
    presetId: "standard_service",
    serviceId: "service-1",
    quantity: 3,
    requestedDate: "2026-08-20",
    requestedTime: "08:30",
    preferredTime: "morning",
    customerFacingDescription: "Service three units",
    technicianInstructions: "Call on arrival",
    notes: "Office note",
  });
  assert.equal(mapped.customerId, "client-1");
  assert.equal(mapped.propertyId, "property-1");
  assert.equal(mapped.workLines[0].presetId, "standard_service");
  assert.equal(mapped.workLines[0].quantity, 3);
  assert.equal(mapped.workLines[0].customerFacingDescription, "Service three units");
  assert.equal(mapped.workLines[0].technicianInstructions, "Call on arrival");
  assert.deepEqual(mapped.constraints, {
    requestedDate: "2026-08-20",
    requestedTime: "08:30",
    preferredTime: "morning",
  });
  assert.equal(mapped.notes, "Office note");
});

test("office gateway requires Firebase authentication and an office scheduling role", async () => {
  const api = createOfficeBookingApi({ db: createDb(), verifyIdToken, bookingAuthority: createAuthority(), schedulingProvider: {} });
  const unauthenticated = await api.handle(request({ action: OFFICE_BOOKING_ACTIONS.LIST_PRESETS }, ""));
  assert.equal(unauthenticated.status, 401);
  assert.equal(unauthenticated.body.error.code, "unauthenticated");

  const denied = createOfficeBookingApi({ db: createDb({ role: "technician" }), verifyIdToken, bookingAuthority: createAuthority(), schedulingProvider: {} });
  const result = await denied.handle(request({ action: OFFICE_BOOKING_ACTIONS.LIST_PRESETS }));
  assert.equal(result.status, 403);
  assert.equal(result.body.error.code, "permission_denied");
});

test("owner and super-admin roles can use the authenticated office booking authority", async () => {
  for (const role of ["owner", "super_admin", "super-admin", "superadmin"]) {
    const api = createOfficeBookingApi({ db: createDb({ role }), verifyIdToken, bookingAuthority: createAuthority(), schedulingProvider: {} });
    const result = await api.handle(request({ action: OFFICE_BOOKING_ACTIONS.LIST_PRESETS }));
    assert.equal(result.status, 200, `expected ${role} to be authorized`);
  }
});

test("list_presets exposes the eight canonical Scheduling Work Types instead of Legacy picker variants", async () => {
  const db = createDb({ presets: [
    { id: "standard_service", label: "Servicio estándar", durationMinutesPerUnit: 60, active: true },
    { id: "deep_service", label: "Servicio deep", durationMinutesPerUnit: 90, active: false },
  ] });
  const api = createOfficeBookingApi({ db, verifyIdToken, bookingAuthority: createAuthority(), schedulingProvider: {} });
  const result = await api.handle(request({ action: OFFICE_BOOKING_ACTIONS.LIST_PRESETS }));
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
  assert.equal(result.body.presets[0].durationMinutesPerUnit, 60);
});

test("list_appointment_attribution exposes only safe creator metadata through authenticated office authority", async () => {
  const db = createDb({ appointments: {
    "APT-1": { appointmentId: "APT-1", source: "office-scheduling", createdBy: "christian-id", createdByName: "Christian", customerId: "secret-customer" },
    "APT-2": { appointmentId: "APT-2", source: "demac-customer-agent", createdByName: "", propertyId: "secret-property" },
  } });
  const api = createOfficeBookingApi({ db, verifyIdToken, bookingAuthority: createAuthority(), schedulingProvider: {} });
  const result = await api.handle(request({
    action: OFFICE_BOOKING_ACTIONS.LIST_APPOINTMENT_ATTRIBUTION,
    data: { appointmentIds: ["APT-1", "APT-2", "APT-MISSING", "APT-1"] },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.attribution.length, 2);
  assert.deepEqual(result.body.attribution[0], {
    appointmentId: "APT-1",
    source: "office-scheduling",
    createdBy: "christian-id",
    createdByName: "Christian",
    createdAtIso: "",
    updatedAtIso: "",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(result.body.attribution[0], "customerId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(result.body.attribution[1], "propertyId"), false);
});

test("check_availability delegates to canonical Booking Authority for non-drag booking workflows", async () => {
  let captured;
  const authority = createAuthority({
    async checkAvailability(args) {
      captured = args;
      return { success: true, available: true, offer: { id: "OFR-OFFICE", version: 1 }, options: [{ id: "OPT-1" }] };
    },
  });
  const api = createOfficeBookingApi({ db: createDb(), verifyIdToken, bookingAuthority: authority, schedulingProvider: {} });
  const result = await api.handle(request({
    action: OFFICE_BOOKING_ACTIONS.CHECK_AVAILABILITY,
    data: {
      requestId: "office-form-123",
      appointmentId: "APT-EXISTING-1",
      customerId: "client-1",
      propertyId: "property-1",
      presetId: "standard_service",
      serviceId: "",
      quantity: 2,
      requestedDate: "2026-08-20",
      requestedTime: "09:30",
      requiredVanId: "VAN-4",
      preferredTime: "",
      customerFacingDescription: "Servicio de dos aires",
      technicianInstructions: "Acceso por recepción",
      notes: "Creado desde Agenda",
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(captured.request.workLines[0].presetId, "standard_service");
  assert.equal(captured.request.constraints.requestedDate, "2026-08-20");
  assert.equal(captured.request.constraints.requestedTime, "09:30");
  assert.equal(captured.actor.source, "office-scheduling");
  assert.equal(captured.actor.id, "user-1");
  assert.equal(captured.context.requestKey, "office:user-1:office-form-123:availability");
  assert.equal(captured.context.excludeAppointmentId, "APT-EXISTING-1");
  assert.equal(captured.context.requiredPrimaryVanId, "VAN-4");
});

test("create_appointment uses stable idempotency and returns only real Booking Authority proof", async () => {
  const calls = [];
  const authority = createAuthority({
    async createAppointment(args) {
      calls.push(args);
      return { success: true, appointmentId: "APT-REAL-77", workOrderIds: ["WO-77"] };
    },
  });
  const api = createOfficeBookingApi({ db: createDb(), verifyIdToken, bookingAuthority: authority, schedulingProvider: {} });
  const body = {
    action: OFFICE_BOOKING_ACTIONS.CREATE_APPOINTMENT,
    data: { requestId: "office-form-777", offerId: "OFR-77", offerVersion: 2, optionId: "OPT-77" },
  };
  const first = await api.handle(request(body));
  const second = await api.handle(request(body));
  assert.equal(first.status, 200);
  assert.equal(first.body.appointmentId, "APT-REAL-77");
  assert.equal(second.body.appointmentId, "APT-REAL-77");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(calls[0].idempotencyKey, "office:user-1:office-form-777:create:OFR-77:OPT-77");
});

test("create_appointment refuses success without a verified appointment id", async () => {
  const authority = createAuthority({ async createAppointment() { return { success: true }; } });
  const api = createOfficeBookingApi({ db: createDb(), verifyIdToken, bookingAuthority: authority, schedulingProvider: {} });
  const result = await api.handle(request({
    action: OFFICE_BOOKING_ACTIONS.CREATE_APPOINTMENT,
    data: { requestId: "office-form-888", offerId: "OFR-88", offerVersion: 1, optionId: "OPT-88" },
  }));
  assert.equal(result.status, 409);
  assert.equal(result.body.success, false);
  assert.equal(result.body.error.code, "availability_provider_error");
});

test("cancel_appointment delegates to the canonical lifecycle authority", async () => {
  let captured;
  const lifecycle = createLifecycle({
    async cancelAppointment(args) {
      captured = args;
      return { success: true, appointmentId: args.appointmentId, appointment: { status: "cancelled" } };
    },
  });
  const api = createOfficeBookingApi({
    db: createDb(),
    verifyIdToken,
    bookingAuthority: createAuthority(),
    schedulingProvider: {},
    lifecycleAuthority: lifecycle,
  });
  const result = await api.handle(request({
    action: OFFICE_BOOKING_ACTIONS.CANCEL_APPOINTMENT,
    data: { requestId: "cancel-form-123", appointmentId: "APT-REAL-1", reason: "Customer cancelled service", note: "Called office" },
  }));
  assert.equal(result.status, 200);
  assert.equal(captured.appointmentId, "APT-REAL-1");
  assert.equal(captured.reason, "Customer cancelled service");
  assert.equal(captured.actor.source, "office-scheduling");
});

test("reschedule_appointment keeps the canonical customer reschedule lifecycle path intact", async () => {
  let captured;
  const lifecycle = createLifecycle({
    async rescheduleAppointment(args) {
      captured = args;
      return { success: true, appointmentId: args.appointmentId, appointment: { id: args.appointmentId, status: "confirmed" }, args };
    },
  });
  const api = createOfficeBookingApi({
    db: createDb(),
    verifyIdToken,
    bookingAuthority: createAuthority(),
    schedulingProvider: {},
    lifecycleAuthority: lifecycle,
  });
  const result = await api.handle(request({
    action: OFFICE_BOOKING_ACTIONS.RESCHEDULE_APPOINTMENT,
    data: {
      requestId: "reschedule-form-123",
      appointmentId: "APT-REAL-1",
      offerId: "OFR-NEW",
      offerVersion: 3,
      optionId: "OPT-NEW",
      reason: "Customer requested another schedule",
      note: "Customer-facing reschedule",
      changeKind: "customer_reschedule",
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(captured.appointmentId, "APT-REAL-1");
  assert.equal(captured.offerId, "OFR-NEW");
  assert.equal(captured.optionId, "OPT-NEW");
  assert.equal(captured.changeKind, "customer_reschedule");
  assert.equal(captured.context.excludeAppointmentId, "APT-REAL-1");
});

test("move_appointment delegates directly to dedicated operational transaction without creating a booking offer", async () => {
  let captured;
  let bookingAvailabilityCalls = 0;
  const authority = createAuthority({
    async checkAvailability() {
      bookingAvailabilityCalls += 1;
      throw new Error("manual drag must not use booking availability offers");
    },
  });
  const operationalMoveAuthority = {
    async moveAppointment(args) {
      captured = args;
      return {
        success: true,
        appointmentId: args.appointmentId,
        changeKind: "operational_move",
        customerNotificationRecommended: true,
        appointment: { id: args.appointmentId, status: "confirmed" },
      };
    },
  };
  const api = createOfficeBookingApi({
    db: createDb(),
    verifyIdToken,
    bookingAuthority: authority,
    schedulingProvider: {},
    operationalMoveAuthority,
  });
  const result = await api.handle(request({
    action: OFFICE_BOOKING_ACTIONS.MOVE_APPOINTMENT,
    data: {
      requestId: "drag-move-12345",
      appointmentId: "APT-REAL-1",
      requestedDate: "2026-08-20",
      requestedTime: "13:30",
      requiredVanId: "VAN-2",
      reason: "Drag-and-drop operational move",
      note: "VAN-1 08:30 → VAN-2 13:30",
    },
  }));
  assert.equal(result.status, 200);
  assert.equal(result.body.appointmentId, "APT-REAL-1");
  assert.equal(bookingAvailabilityCalls, 0);
  assert.equal(captured.appointmentId, "APT-REAL-1");
  assert.equal(captured.requestId, "drag-move-12345");
  assert.equal(captured.requestedDate, "2026-08-20");
  assert.equal(captured.requestedTime, "13:30");
  assert.equal(captured.targetVanId, "VAN-2");
  assert.equal(captured.actor.source, "office-scheduling");
  assert.equal(captured.actor.id, "user-1");
});
