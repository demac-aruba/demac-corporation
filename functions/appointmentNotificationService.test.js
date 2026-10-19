const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createAppointmentNotificationService,
  nextOpenBusinessDate,
  notificationQueueIds,
  reminderEligible,
  selectedRecipients,
} = require("./appointmentNotificationService");
const { ReferenceDb } = require('./test-support/referenceDb.cjs');
const { bookingLocationLabel, bookingMessageAddress, bookingMessageAddressLines } = require('./bookingLocationDisplay');

const dwellingSnapshot = {
  propertyId: 'synthetic-property', dwellingId: 'synthetic-unit-4',
  locationLabel: 'Complejo de prueba · Apartamento 4',
  dwellingName: 'Apartamento 4', dwellingCode: 'A-04',
  accessInstructions: 'PRIVATE-ACCESS-CODE',
  accessContact: { name: 'PRIVATE-ACCESS-CONTACT', phone: 'PRIVATE-PHONE' },
};

test('saved dwelling label uses only destination fields and never assigns a legacy booking to a unit', () => {
  const order = { propertyId: dwellingSnapshot.propertyId, dwellingId: dwellingSnapshot.dwellingId,
    address: 'Dirección de prueba 10', locationSnapshot: dwellingSnapshot };
  assert.equal(bookingMessageAddress(order), 'Dirección de prueba 10 · Complejo de prueba · Apartment 4');
  assert.equal(bookingLocationLabel({ ...order, locationSnapshot: { ...dwellingSnapshot, areaName: 'Sala' } }),
    'Complejo de prueba · Apartamento 4 · Sala');
  assert.equal(bookingMessageAddress({ address: 'Dirección de prueba 10' }), 'Dirección de prueba 10');
  assert.equal(bookingMessageAddress({}, 'Client fallback'), 'Client fallback');
  assert.equal(bookingLocationLabel({ ...order, locationSnapshot: { ...dwellingSnapshot, propertyId: 'neighbor' } }), '');
  assert.equal(bookingLocationLabel({ ...order, locationSnapshot: { ...dwellingSnapshot, dwellingId: 'neighbor-unit' } }), '');
  assert.equal(bookingLocationLabel({ dwellingId: 'unknown-unit' }), '', 'Never display an internal ID as an apartment');
  assert.equal(bookingMessageAddress({ ...order, locationSnapshot: { ...dwellingSnapshot,
    locationLabel: 'Dirección de prueba 10 · Apartamento 4' } }), 'Dirección de prueba 10 · Apartment 4');
});

test('message address separates the selected dwelling and omits generic property labels and redundant codes', () => {
  const snapshot = { ...dwellingSnapshot, locationLabel: 'Propiedad principal · Apartamento 4' };
  const order = { propertyId: snapshot.propertyId, dwellingId: snapshot.dwellingId,
    address: 'Synthetic Residence 10', locationSnapshot: snapshot };
  assert.deepEqual(bookingMessageAddressLines(order), ['Synthetic Residence 10', 'Apartment 4']);
  assert.deepEqual(bookingMessageAddressLines({ ...order, locationSnapshot: { ...snapshot,
    dwellingName: 'Casa', locationLabel: 'Propiedad principal · Casa' } }), ['Synthetic Residence 10', 'Casa']);
  assert.deepEqual(bookingMessageAddressLines({ ...order, locationSnapshot: { ...snapshot,
    dwellingName: 'Villa Azul', locationLabel: 'Propiedad principal · Villa Azul', areaName: 'Patio' } }),
  ['Synthetic Residence 10', 'Villa Azul · Patio']);
  assert.deepEqual(bookingMessageAddressLines({ ...order, locationSnapshot: { ...snapshot,
    dwellingName: '', locationLabel: 'Propiedad principal' } }), ['Synthetic Residence 10', 'A-04']);
  assert.deepEqual(bookingMessageAddressLines({ address: order.address }), ['Synthetic Residence 10']);
  assert.deepEqual(bookingMessageAddressLines({ ...order, locationSnapshot: { ...snapshot, dwellingId: 'neighbor' } }),
    ['Synthetic Residence 10']);
});

test('legacy addresses keep the existing coercion and fallback in prepared notifications', async () => {
  for (const [address, fallback, expected] of [[123, 'Billing address', '123'], ['', 456, '456'], ['   ', 'Billing address', '']]) {
    const order = { id: 'legacy-order', clientId: 'legacy-client', status: 'Confirmada',
      date: '2026-10-13', time: '08:30', address, problem: 'Standard Service',
      notificationRecipients: [{ id: 'selected', whatsapp: '+2975600000', sendConfirmation: true, sendReminder: true }] };
    const db = new ReferenceDb({ 'clients/legacy-client': { name: 'Synthetic owner', address: fallback },
      'workOrders/legacy-order': order,
      'businessSettings/whatsapp': { transactionalProvider: 'meta', phoneNumberId: '1234567890' } });
    const notifications = createAppointmentNotificationService({ db });
    for (const method of ['queueConfirmationForOrder', 'queueReminderForOrder']) {
      await notifications[method]({ order, eventId: 'legacy-test', reason: 'test-only' });
    }
    const queue = [...db.records.entries()].filter(([key]) => key.startsWith('whatsappOutboundQueue/')).map(([, value]) => value);
    assert.equal(queue.length, 2);
    for (const message of queue) assert.equal(message.bodyParameters[3], expected);
    assert.equal(bookingMessageAddress(order, fallback), expected);
  }
});

for (const provider of ['wacli', 'meta']) {
  for (const language of ['es', 'en', 'nl', 'pap']) {
    test(`${provider}/${language}: confirmation and reminder retain the booked apartment, recipients and exact retries`, async () => {
      const order = { id: 'synthetic-order', clientId: 'synthetic-client', propertyId: dwellingSnapshot.propertyId,
        dwellingId: dwellingSnapshot.dwellingId, locationSnapshot: dwellingSnapshot, status: 'Confirmada',
        date: '2026-10-13', time: '08:30', address: 'Dirección de prueba 10', problem: 'Standard Service',
        technicianInstructions: 'PRIVATE-TECHNICIAN-INSTRUCTIONS',
        notificationRecipients: [{ id: 'selected-recipient', name: 'Synthetic recipient', whatsapp: '+2975600000',
          preferredLanguage: language, sendConfirmation: true, sendReminder: true },
        { id: 'other-apartment', name: 'DO-NOT-CONTACT', whatsapp: '+2975611111', sendConfirmation: false, sendReminder: false }],
      };
      const db = new ReferenceDb({ 'clients/synthetic-client': { name: 'Synthetic owner', address: 'Owner billing address' },
        'workOrders/synthetic-order': order,
        'businessSettings/whatsapp': { transactionalProvider: provider, phoneNumberId: '1234567890' } });
      const notifications = createAppointmentNotificationService({ db });
      for (const method of ['queueConfirmationForOrder', 'queueReminderForOrder']) {
        const args = { order, eventId: 'synthetic-event', reason: 'test-only' };
        assert.equal((await notifications[method](args)).notifications.length, 1);
        assert.equal((await notifications[method](args)).notifications[0].created, false);
      }
      const queue = [...db.records.entries()].filter(([path]) => path.startsWith('whatsappOutboundQueue/')).map(([, value]) => value);
      assert.equal(queue.length, 2);
      for (const message of queue) {
        const body = provider === 'meta' ? message.bodyParameters[3] : message.text;
        const unit = { en: 'Apartment 4', es: 'Apartamento 4', nl: 'Appartement 4', pap: 'Apartamento 4' }[language];
        const label = language === 'en' ? 'Address' : language === 'es' ? 'Dirección' : 'Adres';
        if (provider === 'meta') {
          assert.equal(body, `Dirección de prueba 10 · Complejo de prueba · ${unit}`);
          assert.doesNotMatch(body, /[\r\n]/, 'Approved Meta parameters remain single-line');
        } else {
          assert.ok(body.includes(`*${label}:* Dirección de prueba 10\n*${label}:* Complejo de prueba · ${unit}`));
          if (language === 'en') assert.match(body, /We’re happy to help!/);
        }
        assert.doesNotMatch(body, /PRIVATE-|DO-NOT-CONTACT|Owner billing address|A-04/);
        assert.equal(message.recipientId, 'selected-recipient');
        assert.equal(message.languageCode, language);
        assert.equal(message.to, '2975600000');
        if (provider === 'meta') assert.equal(message.bodyParameters.length, 5, 'Approved template shape is preserved');
      }
      assert.deepEqual(db.records.get('workOrders/synthetic-order').locationSnapshot, dwellingSnapshot);
    });
  }
}

test("Saturday reminder run targets Monday when Sunday is closed", () => {
  assert.equal(nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(),
  }), "2026-08-24");
});

test("Saturday reminder run skips Sunday and a Monday holiday", () => {
  assert.equal(nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(["2026-08-24"]),
  }), "2026-08-25");
});

test("next open business day is independent from whether that day has appointments", () => {
  const targetDate = nextOpenBusinessDate({
    runDate: "2026-08-22",
    closedWeekdays: [0],
    closedDates: new Set(),
  });
  assert.equal(targetDate, "2026-08-24");
});

test("communication status can prefer the latest reminder attempt while preserving history", () => {
  const value = {
    queueIds: ["old-failed", "latest-1"],
    latestQueueIds: ["latest-1"],
  };
  assert.deepEqual(notificationQueueIds(value), ["old-failed", "latest-1"]);
  assert.deepEqual(notificationQueueIds(value, { preferLatest: true }), ["latest-1"]);
});

test("reminder eligibility respects the existing Work Order recipient policy", () => {
  assert.equal(reminderEligible({
    status: "Programada",
    whatsappNotificationsEnabled: true,
    notificationRecipients: [{ sendReminder: true }],
  }), true);
  assert.equal(reminderEligible({
    status: "Programada",
    whatsappNotificationsEnabled: true,
    notificationRecipients: [{ sendReminder: false }],
  }), false);
  assert.equal(reminderEligible({
    status: "Cancelada",
    whatsappNotificationsEnabled: true,
    notificationRecipients: [{ sendReminder: true }],
  }), false);
});

test("recipient resolution deduplicates the same WhatsApp number", () => {
  const recipients = selectedRecipients({
    notificationRecipients: [
      { id: "a", whatsapp: "+2975600000", sendReminder: true },
      { id: "b", phone: "2975600000", sendReminder: true },
      { id: "c", whatsapp: "+2975611111", sendReminder: false },
    ],
  }, { id: "client-1" }, "reminder");
  assert.deepEqual(recipients.map((item) => item.id), ["a"]);
});
