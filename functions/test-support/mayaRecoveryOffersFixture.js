'use strict';
const { MemoryDb } = require('./mayaWorkspaceMemoryDb');
const { buildCapacityLocks } = require('../bookingAuthoritySchedulingProvider');
const { createCustomerBookingInterestTools } = require('../demacCustomerBookingInterest');
const { createMayaRecoveryOfferService } = require('../mayaRecoveryOfferService');
const NOW = new Date('2026-09-07T11:00:00.000Z');
const CONV = `COMM-${'E'.repeat(40)}`;
const PHONE = '2975600000';
const ACCOUNT = 'demac-wa-corporate';
const QUOTE = 'Can you come earlier?';
const WORK = [{ id: 'work-1', presetId: 'standard_service', serviceId: 's1', quantity: 1,
  customerFacingDescription: 'Service one unit', technicianInstructions: 'Keep recorded instructions' }];
function option(date) {
  return { date, time: '09:30', endTime: '10:30', assignments: [{ vanId: 'VAN-1', vanName: 'Van 1',
    role: 'primary', time: '09:30', endTime: '10:30', slots: 1, quantity: 1,
    durationMinutes: 60, technicianIds: ['driver-1'] }] };
}
async function fixture() {
  let time = new Date(NOW);
  const target = option('2026-09-08'); const original = option('2026-09-10');
  const targetLocks = buildCapacityLocks(target); const originalLocks = buildCapacityLocks(original);
  const comms = { communicationAccountId: ACCOUNT, provider: 'wacli', channel: 'whatsapp',
    phone: PHONE, remoteConversationId: `${PHONE}@s.whatsapp.net` };
  const db = new MemoryDb({
    businessSettings: [{ id: 'whatsapp', communicationAccountId: ACCOUNT },
      { id: 'customer-agent', enabled: true, autoReplyEnabled: true, replyMode: 'allowlist', autoReplyAllowlist: [PHONE],
        bookingInterestEnabled: true, recoveryOffersEnabled: true, recoveryOfferTtlMinutes: 30, autoRescheduleEnabled: true },
      { id: 'business-calendar', closedWeekdays: [0] }],
    communicationConversations: [{ id: CONV, ...comms, language: 'en', aiDisposition: 'ai_active', ownershipVersion: 2, customerInputVersion: 4 }],
    whatsappMessages: [{ id: 'MSG-1', ...comms, conversationId: CONV, direction: 'inbound', text: QUOTE, customerInputVersion: 4,
      firstIngestedAtIso: NOW.toISOString(), whatsappTimestamp: NOW.toISOString() }],
    customerAgentInboundQueue: [{ id: 'Q-1', communicationAccountId: ACCOUNT, conversationId: CONV,
      messageId: 'MSG-1', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 4 }],
    clients: [{ id: 'C-1', active: true, name: 'Synthetic customer', phone: PHONE, whatsapp: PHONE }],
    properties: [{ id: 'P-1', clientId: 'C-1', active: true, address: 'Wayaca 217', operationalZone: 'Oranjestad Este' }],
    appointments: [
      { id: 'CANCEL-1', status: 'cancelled', cancelledAtIso: '2026-09-07T10:00:00.000Z', ...target,
        startTime: target.time, capacityLockIds: targetLocks.map(lock => lock.id), workOrderIds: ['WO-CANCEL'] },
      { id: 'APT-1', appointmentId: 'APT-1', customerId: 'C-1', propertyId: 'P-1', status: 'confirmed', ...original,
        startTime: original.time, workLines: WORK, workOrderIds: ['WO-APT-1-1'], capacityLockIds: originalLocks.map(lock => lock.id) }],
    workOrders: [
      { id: 'WO-CANCEL', appointmentId: 'CANCEL-1', status: 'Cancelada', date: target.date, time: target.time, vanId: 'VAN-1', scheduledSlots: 1 },
      { id: 'WO-APT-1-1', appointmentId: 'APT-1', clientId: 'C-1', propertyId: 'P-1', status: 'Confirmada', date: original.date,
        time: original.time, vanId: 'VAN-1', scheduledSlots: 1, appointmentDurationMinutes: 60, amount: 125, paid: 50,
        notificationRecipients: [{ id: 'existing-recipient', sendReminder: true }], reportReference: 'preserve-report' }],
    bookingCapacityLocks: [...targetLocks.map(lock => ({ ...lock, active: false, appointmentId: 'CANCEL-1' })),
      ...originalLocks.map(lock => ({ ...lock, active: true, appointmentId: 'APT-1' }))],
    services: [{ id: 's1', name: 'Servicio estándar', itemType: 'Servicio', active: true, featured: true, durationMinutes: 60,
      serviceDefinition: { version: 1, bookingCode: 'standard_service', duration: { minutes: 60 } } }],
    vans: [{ id: 'VAN-1', name: 'Van 1', active: true, responsibleStaffId: 'driver-1' }],
    staffProfiles: [{ id: 'driver-1', active: true, availability: 'Disponible', canDriveVan: true }],
    dailyVanAssignments: [], staffAbsences: [], calendarClosures: [], vanHalfDaySchedules: [],
  });
  const registered = await createCustomerBookingInterestTools({ db, clock: () => time }).record({ action: 'register', kind: 'earlier_appointment',
    customerId: 'C-1', propertyId: 'P-1', appointmentId: 'APT-1', sourceQuote: QUOTE, dateFrom: '', dateTo: '' },
  { conversationId: CONV, inboundMessageId: 'MSG-1' });
  const service = createMayaRecoveryOfferService({ db, clock: () => time });
  const prepare = () => service.prepare({ cancelledAppointmentId: 'CANCEL-1', caseId: registered.caseId });
  async function delivered(prepared) {
    time = new Date(NOW.getTime() + 60_000);
    const stored = db.read('bookingOffers', prepared.offerId);
    const message = { id: 'OUT-1', ...comms, conversationId: CONV, direction: 'outbound', providerMessageId: 'provider-out-1',
      text: prepared.messageText, firstIngestedAtIso: time.toISOString(), whatsappTimestamp: time.toISOString() };
    db.patch('whatsappMessages', 'OUT-1', message);
    db.patch('whatsappOutboundQueue', 'QUEUE-OUT-1', { provider: 'wacli', outboundClass: 'conversation_maya', status: 'sent',
      conversationId: CONV, communicationAccountId: ACCOUNT, expectedOwnershipVersion: 2, expectedCustomerInputVersion: 4,
      recoveryOfferId: prepared.offerId, recoveryOfferVersion: prepared.offerVersion,
      recoveryOfferFingerprint: stored.recovery.fingerprint, text: prepared.messageText, messageId: 'provider-out-1' });
    db.patch('communicationConversations', CONV, { recentMessages: [{ id: 'OUT-1', role: 'ai', text: prepared.messageText }] });
    return service.bindDelivery({ offerId: prepared.offerId, offerVersion: prepared.offerVersion, queueId: 'QUEUE-OUT-1', outboundMessageId: 'OUT-1' });
  }
  function inbound(text = 'Yes, please move it to Tuesday.') {
    time = new Date(NOW.getTime() + 2 * 60_000);
    db.patch('whatsappMessages', 'MSG-2', { ...comms, conversationId: CONV, direction: 'inbound', customerInputVersion: 5,
      text, firstIngestedAtIso: time.toISOString(), whatsappTimestamp: time.toISOString() });
    db.patch('communicationConversations', CONV, { customerInputVersion: 5 });
    db.patch('customerAgentInboundQueue', 'Q-2', { communicationAccountId: ACCOUNT, conversationId: CONV,
      messageId: 'MSG-2', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 5 });
    return text;
  }
  const respond = (prepared, decision = 'accept', sourceQuote = 'Yes, please move it to Tuesday.') => service.respond({
    offerId: prepared.offerId, offerVersion: prepared.offerVersion, decision, sourceQuote }, { conversationId: CONV, inboundMessageId: 'MSG-2' });
  db.writes.length = 0;
  return { db, service, prepare, delivered, inbound, respond, caseId: registered.caseId,
    setTime: value => { time = new Date(value); }, targetLocks, originalLocks };
}
module.exports = { fixture, NOW, CONV, PHONE, ACCOUNT };
