'use strict';
const assert = require('node:assert/strict');
const scaling = resource => Object.fromEntries(Object.entries(resource?.metadata?.annotations || {})
  .filter(([key]) => key.startsWith('autoscaling.knative.dev/') || /^run\.googleapis\.com\/(minScale|maxScale|scalingMode|manualInstanceCount)$/.test(key)));
const runtime = service => {
  const spec = structuredClone(service.spec.template.spec);
  for (const container of spec.containers || []) delete container.image;
  return spec;
};
function verifyPreservedScaling(entry, current) {
  assert.equal(entry.timestamp, '2026-10-07T17:27:15.905174Z', 'Missing original service creation evidence');
  assert.equal(entry.protoPayload?.methodName, '/InternalServices.CreateInternalService');
  assert.equal(entry.protoPayload.status?.code || 0, 0);
  const original = entry.protoPayload.response;
  for (const service of [original, current]) {
    assert.equal(service.kind, 'Service');
    assert.equal(service.metadata.name, 'notifybookingreferenceupdate');
    assert.equal(service.metadata.annotations['run.googleapis.com/maxScale'], '20');
    assert.equal(service.spec.template.spec.containerConcurrency, 80);
  }
  assert.deepEqual(scaling(current), scaling(original), 'Service-level scaling changed');
  const originalRevision = scaling(original.spec.template), currentRevision = scaling(current.spec.template);
  assert.equal(originalRevision['autoscaling.knative.dev/maxScale'], undefined);
  assert.equal(currentRevision['autoscaling.knative.dev/maxScale'], '20');
  delete currentRevision['autoscaling.knative.dev/maxScale'];
  assert.deepEqual(currentRevision, originalRevision, 'Other revision scaling changed');
  assert.deepEqual(runtime(current), runtime(original), 'Runtime changed beyond the code image');
  assert.equal(current.status.traffic.length, 1);
  assert.equal(current.status.traffic[0].percent, 100);
  return { verified: true, originalServiceMax: 20, currentServiceMax: 20, currentRevisionMax: 20,
    concurrency: 80, originalEvidenceTimestamp: entry.timestamp };
}
module.exports = { verifyPreservedScaling };
