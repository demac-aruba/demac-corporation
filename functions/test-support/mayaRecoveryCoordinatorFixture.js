'use strict';
const { fixture, NOW, CONV, PHONE, ACCOUNT } = require('./mayaRecoveryOffersFixture');
const { buildCapacityLocks } = require('../bookingAuthoritySchedulingProvider');
const { createCustomerBookingInterestTools } = require('../demacCustomerBookingInterest');
const { createCustomerInterestRecovery } = require('../demacCustomerInterestRecovery');
const { createMayaRecoveryCoordinator } = require('../mayaRecoveryCoordinator');
const { cancellationGeneration } = require('../mayaRecoveryAutomationPolicy');
const P = require('../mayaRecoveryOfferPolicy');
const SECOND_CONV = `COMM-${'F'.repeat(40)}`;
const SECOND_PHONE = '2975600001';

async function setup(options = {}) {
  const f = await fixture();
  let now = new Date(NOW);
  const clock = () => new Date(now);
  const tasks = []; const analyses = [];
  const quote = f.db.read('whatsappMessages', 'MSG-1').text;
  f.db.patch('communicationConversations', CONV, { recentMessages: [{ id: 'MSG-1', role: 'customer' }] });
  const phones = [PHONE];
  if (options.second) {
    phones.push(SECOND_PHONE);
    const old = f.db.read('appointments', 'APT-1');
    const date = '2026-09-11';
    const candidate = { ...old, id: 'APT-2', appointmentId: 'APT-2', customerId: 'C-2', propertyId: 'P-2', date,
      assignments: old.assignments.map(item => ({ ...item })), workOrderIds: ['WO-APT-2-1'] };
    const locks = buildCapacityLocks({ date, time: candidate.startTime, endTime: candidate.endTime, assignments: candidate.assignments });
    candidate.capacityLockIds = locks.map(lock => lock.id);
    f.db.patch('appointments', 'APT-2', candidate);
    f.db.patch('workOrders', 'WO-APT-2-1', { ...f.db.read('workOrders', 'WO-APT-1-1'), appointmentId: 'APT-2', clientId: 'C-2', propertyId: 'P-2', date });
    for (const lock of locks) f.db.patch('bookingCapacityLocks', lock.id, { ...lock, active: true, appointmentId: 'APT-2' });
    f.db.patch('clients', 'C-2', { active: true, name: 'Second synthetic customer', phone: SECOND_PHONE, whatsapp: SECOND_PHONE });
    f.db.patch('properties', 'P-2', { clientId: 'C-2', active: true, address: 'Wayaca 219', operationalZone: 'Oranjestad Este' });
    f.db.patch('communicationConversations', SECOND_CONV, { ...f.db.read('communicationConversations', CONV),
      phone: SECOND_PHONE, remoteConversationId: `${SECOND_PHONE}@s.whatsapp.net`, recentMessages: [{ id: 'MSG-SECOND', role: 'customer' }] });
    const sourceAt = new Date(NOW.getTime() + (options.secondOlder ? -60000 : 0)).toISOString();
    f.db.patch('whatsappMessages', 'MSG-SECOND', { ...f.db.read('whatsappMessages', 'MSG-1'), conversationId: SECOND_CONV,
      phone: SECOND_PHONE, remoteConversationId: `${SECOND_PHONE}@s.whatsapp.net`, firstIngestedAtIso: sourceAt, whatsappTimestamp: sourceAt });
    f.db.patch('customerAgentInboundQueue', 'Q-SECOND', { conversationId: SECOND_CONV, communicationAccountId: ACCOUNT,
      messageId: 'MSG-SECOND', expectedOwnershipVersion: 2, expectedCustomerInputVersion: 4 });
  }
  f.db.patch('businessSettings', 'customer-agent', {
    autoReplyAllowlist: phones, bookingInterestRecoveryEnabled: true, recoveryOutreachEnabled: true,
    recoveryResponseRoutingEnabled: true, recoveryConfirmationEnabled: true, recoveryAutomationEnabled: true,
    recoveryAutomationPolicy: { version: 1, activeSince: '2026-09-01T00:00:00Z', ranking: 'oldest_verified_request',
      maxConversations: 5, maxCases: 50, maxOffers: 5 },
    recoveryContactPolicy: { version: 1, provider: 'wacli', timezone: 'America/Aruba',
      windows: [{ weekday: 1, start: '07:00', end: '17:00' }, { weekday: 2, start: '07:00', end: '17:00' }],
      cooldownMinutes: 60, minimumRemainingSeconds: 60 },
  });
  if (options.second && !options.secondUnrecorded) await createCustomerBookingInterestTools({ db: f.db, clock }).record({
    action: 'register', kind: 'earlier_appointment', customerId: 'C-2', propertyId: 'P-2', appointmentId: 'APT-2',
    sourceQuote: quote, dateFrom: '', dateTo: '',
  }, { conversationId: SECOND_CONV, inboundMessageId: 'MSG-SECOND' });
  const reviewFactory = ({ db }) => createCustomerInterestRecovery({ db, clock, apiKeyProvider: () => 'offline-test-only',
    analyze: async input => {
      analyses.push(input.context);
      if (options.onReview) await options.onReview(f, input, analyses.length);
      const source = input.context.messages.find(message => message.direction === 'inbound');
      return input.context.appointments.filter(appointment => appointment.status === 'confirmed').map(appointment => {
        const previous = input.context.previousInterests.find(item => item.appointmentId === appointment.id);
        return { caseId: previous?.id || '', kind: 'earlier_appointment', propertyId: appointment.propertyId,
          appointmentId: appointment.id, state: 'waiting', evidenceMessageId: source.id, quote: source.text,
          confidence: 0.99, ambiguous: false, dateFrom: '', dateTo: '' };
      });
    } });
  const taskQueue = { enqueue: async (payload, scheduling) => {
    if (options.onEnqueue) await options.onEnqueue(f, payload, scheduling);
    tasks.push({ payload, scheduling });
  } };
  const coordinator = createMayaRecoveryCoordinator({ db: f.db, clock, taskQueue, reviewFactory,
    ...(options.offerFactory ? { offerFactory: options.offerFactory } : {}),
    ...(options.outboundFactory ? { outboundFactory: options.outboundFactory } : {}) });
  const payload = { cancelledAppointmentId: 'CANCEL-1', generation: cancellationGeneration({ ...f.db.read('appointments', 'CANCEL-1'), id: 'CANCEL-1' }) };
  f.db.writes.length = 0;
  return { ...f, coordinator, payload, tasks, analyses, clock,
    setClock(value) { now = new Date(value); f.setTime(now); },
    offer() { const id = P.recoveryOfferId(ACCOUNT, 'CANCEL-1'); return { ...f.db.read('bookingOffers', id), id }; },
    state() { return f.db.read('appointments', 'CANCEL-1').mayaRecoveryAutomation; },
    outgoing() { return [...f.db.docs].filter(([key]) => key.startsWith('whatsappOutboundQueue/MRO-')); },
  };
}
module.exports = { setup, NOW, CONV, PHONE, ACCOUNT, SECOND_CONV, SECOND_PHONE };
