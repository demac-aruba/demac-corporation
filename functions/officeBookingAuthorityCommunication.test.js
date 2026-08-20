const assert = require("node:assert/strict");
const test = require("node:test");
const {
  OFFICE_BOOKING_ACTIONS,
  createOfficeBookingApi,
} = require("./officeBookingAuthority");

function documentSnapshot(id, store, reference) {
  const exists = Object.prototype.hasOwnProperty.call(store, id);
  return {
    id,
    exists,
    data: () => exists ? store[id] : undefined,
    ref: reference,
  };
}

function createCommunicationDb() {
  const workOrders = {
    "WO-APT-1-1": {
      appointmentId: "APT-1",
      appointmentAssignmentRole: "primary",
      clientId: "client-1",
      whatsappNotificationsEnabled: true,
      notificationRecipients: [{
        id: "client-client-1",
        sourceId: "client-1",
        name: "Mitch Bermudez",
        whatsapp: "+2975600000",
        preferredLanguage: "English",
        sendConfirmation: true,
        sendReminder: true,
      }],
      confirmationNotifications: { queueIds: ["confirmation-1"] },
      reminderNotifications: { queueIds: ["reminder-1"] },
    },
  };
  const queues = {
    "confirmation-1": { status: "sent" },
    "reminder-1": { status: "queued" },
  };

  function mutableReference(store, id) {
    return {
      async get() {
        return documentSnapshot(id, store, mutableReference(store, id));
      },
      async set(changes, options = {}) {
        store[id] = options.merge ? { ...(store[id] || {}), ...changes } : { ...changes };
      },
    };
  }

  return {
    workOrders,
    queues,
    collection(name) {
      if (name === "workOrders") {
        return {
          where(field, operator, value) {
            assert.equal(field, "appointmentId");
            assert.equal(operator, "==");
            return {
              async get() {
                const docs = Object.entries(workOrders)
                  .filter(([, item]) => item.appointmentId === value)
                  .map(([id]) => documentSnapshot(id, workOrders, mutableReference(workOrders, id)));
                return { docs };
              },
            };
          },
          doc(id) {
            return mutableReference(workOrders, id);
          },
        };
      }
      if (name === "whatsappOutboundQueue") {
        return {
          doc(id) {
            return mutableReference(queues, id);
          },
        };
      }
      if (name === "users") {
        return {
          doc(id) {
            return {
              async get() {
                return { exists: true, data: () => ({ id, role: "office", active: true, name: "Office User" }) };
              },
            };
          },
        };
      }
      if (name === "clients") {
        return {
          doc(id) {
            return {
              async get() {
                return { exists: id === "client-1", id, data: () => ({ name: "Mitch Bermudez", whatsapp: "+2975600000" }) };
              },
            };
          },
        };
      }
      if (name === "services") {
        return { async get() { return { docs: [] }; } };
      }
      if (name === "businessSettings") {
        return {
          doc() {
            return { async get() { return { exists: false, data: () => undefined }; } };
          },
        };
      }
      return {
        async get() { return { docs: [] }; },
        doc() { return { async get() { return { exists: false, data: () => undefined }; } }; },
      };
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

const verifyIdToken = async () => ({ uid: "user-1", email: "office@demac.test" });
const bookingAuthority = {
  async checkAvailability() { return { success: true, available: false, offer: null, options: [] }; },
  async createAppointment() { return { success: true, appointmentId: "APT-1" }; },
  async getAppointment(id) { return { appointmentId: id }; },
};

test("appointment communication reads existing Work Order notification policy and outbound queue state", async () => {
  const db = createCommunicationDb();
  const api = createOfficeBookingApi({ db, verifyIdToken, bookingAuthority, schedulingProvider: {} });
  const response = await api.handle(request(OFFICE_BOOKING_ACTIONS.GET_APPOINTMENT_COMMUNICATION, { appointmentId: "APT-1" }));

  assert.equal(response.status, 200);
  assert.equal(response.body.workOrderId, "WO-APT-1-1");
  assert.equal(response.body.confirmation.enabled, true);
  assert.equal(response.body.confirmation.state, "sent");
  assert.equal(response.body.reminder.enabled, true);
  assert.equal(response.body.reminder.state, "queued");
  assert.equal(response.body.recipients[0].name, "Mitch Bermudez");
});

test("turning reminder off updates the existing recipient preference and cancels only a still-queued reminder", async () => {
  const db = createCommunicationDb();
  const api = createOfficeBookingApi({ db, verifyIdToken, bookingAuthority, schedulingProvider: {} });
  const response = await api.handle(request(OFFICE_BOOKING_ACTIONS.UPDATE_APPOINTMENT_COMMUNICATION, {
    appointmentId: "APT-1",
    requestId: "reminder-toggle-123",
    sendReminder: false,
  }));

  assert.equal(response.status, 200);
  assert.equal(db.workOrders["WO-APT-1-1"].notificationRecipients[0].sendReminder, false);
  assert.equal(db.queues["reminder-1"].status, "cancelled");
  assert.equal(db.queues["confirmation-1"].status, "sent");
  assert.equal(response.body.reminder.enabled, false);
  assert.equal(response.body.reminder.state, "cancelled");
});
