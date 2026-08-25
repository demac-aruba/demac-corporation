const test = require('node:test');
const assert = require('node:assert/strict');
const {
  authorizedWorkflowFromObservation,
  replyPolicyContext,
} = require('./demacCustomerTurnOrchestrator');
const { mayaReplyDecision } = require('./demacCustomerAgentReplyPolicy');

const ACCOUNT_ID = 'demac-wa-corporate';
const PHONE = '2975642625';
const REMOTE_CONVERSATION_ID = `${PHONE}@s.whatsapp.net`;
const message = {
  direction: 'inbound',
  communicationAccountId: ACCOUNT_ID,
  provider: 'wacli',
  channel: 'whatsapp',
  remoteConversationId: REMOTE_CONVERSATION_ID,
  phone: PHONE,
};
const conversation = {
  communicationAccountId: ACCOUNT_ID,
  provider: 'wacli',
  channel: 'whatsapp',
  remoteConversationId: REMOTE_CONVERSATION_ID,
  phone: PHONE,
  aiDisposition: 'ai_active',
};
const communicationSettings = { communicationAccountId: ACCOUNT_ID };

function settings(overrides = {}) {
  return {
    enabled: true,
    autoReplyEnabled: true,
    replyMode: 'pilot',
    autoReplyAllowlist: [],
    newContactAutoReplyEnabled: true,
    cancellationAutoReplyEnabled: true,
    rescheduleAutoReplyEnabled: true,
    ...overrides,
  };
}

function existingParty(clientId = 'client-1') {
  return { status: 'existing', isNewContact: false, ambiguous: false, clientId };
}

function matchedObservation(intent, overrides = {}) {
  return {
    observed: true,
    observation: { intent },
    caseResult: {
      processed: true,
      state: 'APPOINTMENT_MATCHED',
      customerId: 'client-1',
      appointmentId: 'appointment-1',
      attentionReason: '',
      ...overrides,
    },
  };
}

test('existing customer general conversation remains observe-only outside the allowlist', () => {
  const context = replyPolicyContext({
    partyResolution: existingParty(),
    observationResult: { observed: true, observation: { intent: 'general_question' }, caseResult: { processed: false } },
  });
  assert.equal(context.isNewContact, false);
  assert.equal(context.authorizedWorkflow, '');
  const decision = mayaReplyDecision({ message, conversation, settings: settings(), communicationSettings, ...context });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'existing-customer-observe-only');
});

test('existing customer cancellation is communicable only after Case correlates one canonical appointment', () => {
  const context = replyPolicyContext({ partyResolution: existingParty(), observationResult: matchedObservation('cancellation') });
  assert.equal(context.authorizedWorkflow, 'cancellation');
  const decision = mayaReplyDecision({ message, conversation, settings: settings(), communicationSettings, ...context });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'authorized-cancellation-workflow');
});

test('existing customer reschedule is communicable after the same canonical Case correlation', () => {
  const context = replyPolicyContext({ partyResolution: existingParty(), observationResult: matchedObservation('reschedule') });
  assert.equal(context.authorizedWorkflow, 'reschedule');
  const decision = mayaReplyDecision({ message, conversation, settings: settings(), communicationSettings, ...context });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'authorized-reschedule-workflow');
});

test('multiple plausible appointments never authorize an appointment-change workflow', () => {
  const observationResult = matchedObservation('cancellation', {
    state: 'AWAITING_APPOINTMENT_CLARIFICATION',
    appointmentId: '',
    attentionReason: 'multiple-plausible-appointments',
  });
  const context = replyPolicyContext({ partyResolution: existingParty(), observationResult });
  assert.equal(context.authorizedWorkflow, '');
  const decision = mayaReplyDecision({ message, conversation, settings: settings(), communicationSettings, ...context });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'existing-customer-observe-only');
});

test('a Case belonging to a different client cannot authorize a reply', () => {
  const context = replyPolicyContext({
    partyResolution: existingParty('client-1'),
    observationResult: matchedObservation('cancellation', { customerId: 'client-2' }),
  });
  assert.equal(context.authorizedWorkflow, '');
});

test('an ambiguous canonical party cannot authorize an appointment-change workflow', () => {
  const context = replyPolicyContext({
    partyResolution: { status: 'ambiguous', isNewContact: false, ambiguous: true, clientId: '' },
    observationResult: matchedObservation('cancellation'),
  });
  assert.equal(context.isNewContact, false);
  assert.equal(context.authorizedWorkflow, '');
});

test('canonical absence enables the new-contact pilot path for text without pretending to be an existing customer', () => {
  const context = replyPolicyContext({
    partyResolution: { status: 'new_contact', isNewContact: true, ambiguous: false, clientId: '' },
    observationResult: { observed: true, observation: { intent: 'booking_request' }, caseResult: { processed: false } },
  });
  const decision = mayaReplyDecision({ message, conversation, settings: settings(), communicationSettings, ...context });
  assert.equal(context.isNewContact, true);
  assert.equal(context.authorizedWorkflow, '');
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'new-contact-pilot');
});

test('new-contact voice uses the same party policy path; media type does not create a second policy brain', () => {
  const voiceMessage = { ...message, mediaType: 'audio', transcriptionStatus: 'completed', transcriptionText: 'Mi kier haci un cita' };
  const context = replyPolicyContext({
    partyResolution: { status: 'new_contact', isNewContact: true, ambiguous: false, clientId: '' },
    observationResult: { observed: true, observation: { intent: 'booking_request', language: 'pap-aw' }, caseResult: { processed: false } },
  });
  const decision = mayaReplyDecision({ message: voiceMessage, conversation, settings: settings(), communicationSettings, ...context });
  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, 'new-contact-pilot');
});

test('existing-customer general voice remains observe-only', () => {
  const voiceMessage = { ...message, mediaType: 'audio', transcriptionStatus: 'completed', transcriptionText: 'Mi tin un pregunta' };
  const context = replyPolicyContext({
    partyResolution: existingParty(),
    observationResult: { observed: true, observation: { intent: 'general_question', language: 'pap-aw' }, caseResult: { processed: false } },
  });
  const decision = mayaReplyDecision({ message: voiceMessage, conversation, settings: settings(), communicationSettings, ...context });
  assert.equal(decision.allowed, false);
  assert.equal(decision.reason, 'existing-customer-observe-only');
});

test('workflow helper rejects attention-bearing or unprocessed Case results', () => {
  assert.equal(authorizedWorkflowFromObservation(matchedObservation('cancellation', { attentionReason: 'critical-value-ambiguous' }), existingParty()), '');
  assert.equal(authorizedWorkflowFromObservation(matchedObservation('cancellation', { processed: false }), existingParty()), '');
});
