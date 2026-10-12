'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { recoveryRequest } = require('./booking-dwelling-scaling-recovery.cjs');
test('configuration rollback patches only the original maximum-instance field on the one reviewed function', () => {
  const request = recoveryRequest();
  assert.equal(request.method, 'PATCH');
  assert.equal(request.url, 'https://cloudfunctions.googleapis.com/v2/projects/demac-corporation/locations/us-central1/functions/notifyBookingReferenceUpdate?updateMask=serviceConfig.maxInstanceCount');
  assert.deepEqual(request.body, { name: 'projects/demac-corporation/locations/us-central1/functions/notifyBookingReferenceUpdate', serviceConfig: { maxInstanceCount: 0 } });
});
