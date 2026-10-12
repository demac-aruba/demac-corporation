'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { verifyPreservedScaling } = require('./booking-dwelling-scaling-proof.cjs');
const { configHash, configurationRestorationPlan } = require('./booking-dwelling-release.cjs');
function fixture() {
  const original = { kind: 'Service', metadata: { name: 'notifybookingreferenceupdate', annotations: { 'run.googleapis.com/maxScale': '20' } },
    spec: { template: { metadata: { annotations: {} }, spec: { containerConcurrency: 80, containers: [{ image: 'old', env: [{ name: 'SYNTHETIC', value: 'fixture' }] }] } } } };
  const creation = { timestamp: '2026-10-07T17:27:15.905174Z', protoPayload: { methodName: '/InternalServices.CreateInternalService', response: original } };
  const currentService = structuredClone(original);
  currentService.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'] = '20';
  currentService.spec.template.spec.containers[0].image = 'reviewed-code';
  currentService.status = { traffic: [{ percent: 100 }] };
  return { creation, currentService };
}
test('historical service cap proves the added equal revision cap preserves effective capacity', () => {
  const evidence = fixture();
  assert.equal(verifyPreservedScaling(evidence.creation, evidence.currentService).originalServiceMax, 20);
  const original = { buildConfig: { runtime: 'nodejs22', entryPoint: 'notifyBookingReferenceUpdate' }, serviceConfig: {}, eventTrigger: { retryPolicy: 'RETRY_POLICY_RETRY' } };
  const plan = configurationRestorationPlan('notifyBookingReferenceUpdate', { ...original, serviceConfig: { maxInstanceCount: 20 } }, configHash(original), evidence);
  assert.equal(plan.required, false); assert.equal(plan.representationChanged, true); assert.equal(plan.scalingProof.verified, true);
});
test('another service, creation time or original capacity cannot justify retaining the new field', () => {
  for (const mutate of [e => e.creation.timestamp = '2026-10-12T22:00:00Z',
    e => e.creation.protoPayload.response.metadata.name = 'different-service',
    e => e.creation.protoPayload.response.metadata.annotations['run.googleapis.com/maxScale'] = '100',
    e => delete e.creation.protoPayload.response.metadata.annotations['run.googleapis.com/maxScale'],
    e => e.currentService.metadata.annotations['run.googleapis.com/maxScale'] = '40']) {
    const e = fixture(); mutate(e); assert.throws(() => verifyPreservedScaling(e.creation, e.currentService));
  }
});
test('runtime, concurrency, traffic and other scaling changes remain blocking', () => {
  for (const mutate of [e => e.currentService.spec.template.spec.containerConcurrency = 40,
    e => e.currentService.spec.template.spec.containers[0].env[0].value = 'changed',
    e => e.currentService.status.traffic[0].percent = 50,
    e => e.currentService.spec.template.metadata.annotations['autoscaling.knative.dev/maxScale'] = '10',
    e => e.currentService.spec.template.metadata.annotations['autoscaling.knative.dev/minScale'] = '1']) {
    const e = fixture(); mutate(e); assert.throws(() => verifyPreservedScaling(e.creation, e.currentService));
  }
});
