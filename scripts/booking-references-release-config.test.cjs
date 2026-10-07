const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalFunctionConfig: config } = require('./booking-references-release-config.cjs');
const sample = () => ({ buildConfig: { runtime: 'nodejs22', entryPoint: 'queueAppointmentConfirmation' },
  serviceConfig: { revision: 'old-revision', uri: 'synthetic-uri', service: 'synthetic-service',
    availableMemory: '256Mi', timeoutSeconds: 60, serviceAccountEmail: 'synthetic-runtime', environmentVariables: { TEST_ONLY: 'synthetic' } },
  eventTrigger: { eventType: 'google.cloud.firestore.document.v1.written', retryPolicy: 'RETRY_POLICY_DO_NOT_RETRY',
    triggerRegion: 'nam5', trigger: 'synthetic-trigger', pubsubTopic: 'synthetic-topic', serviceAccountEmail: 'synthetic-invoker',
    eventFilters: [{ attribute: 'database', value: '(default)' }, { attribute: 'namespace', value: '(default)' },
      { attribute: 'document', operator: 'match-path-pattern', value: 'workOrders/{workOrderId}' }] } });
test('same event filters in another API response order preserve configuration', () => {
  const before = sample(), after = sample(); after.eventTrigger.eventFilters.reverse(); after.serviceConfig.revision = 'new-revision';
  assert.deepEqual(config(after), config(before));
  assert.equal(after.eventTrigger.eventFilters[0].attribute, 'document', 'Normalization must not mutate response');
});
test('changing an event path, operator, database, policy or identity still fails comparison', () => {
  for (const mutate of [
    fn => { fn.eventTrigger.eventFilters[2].value = 'appointments/{appointmentId}'; },
    fn => { fn.eventTrigger.eventFilters[2].operator = 'different-operator'; },
    fn => { fn.eventTrigger.eventFilters[0].value = 'other-database'; },
    fn => { fn.eventTrigger.retryPolicy = 'RETRY_POLICY_RETRY'; },
    fn => { fn.eventTrigger.serviceAccountEmail = 'another-invoker'; },
    fn => { fn.eventTrigger.eventFilters.pop(); },
  ]) { const after = sample(); mutate(after); assert.notDeepEqual(config(after), config(sample())); }
});
test('runtime, credentials binding, memory, timeout and environment remain strict', () => {
  for (const mutate of [
    fn => { fn.buildConfig.runtime = 'nodejs24'; },
    fn => { fn.serviceConfig.serviceAccountEmail = 'another-runtime'; },
    fn => { fn.serviceConfig.availableMemory = '512Mi'; },
    fn => { fn.serviceConfig.timeoutSeconds = 120; },
    fn => { fn.serviceConfig.environmentVariables.TEST_ONLY = 'different'; },
  ]) { const after = sample(); mutate(after); assert.notDeepEqual(config(after), config(sample())); }
});
