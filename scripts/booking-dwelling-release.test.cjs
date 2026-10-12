'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { safePaths, deployArgs, verifyDelta, validateRecoveredLock } = require('./booking-dwelling-release.cjs');
test('source archives reject traversal and absolute paths', () => {
  safePaths(['bootstrap.js', 'data/vocabulary.json']);
  for (const file of ['/etc/passwd', '../outside', 'a/../../outside', 'a\\..\\outside']) assert.throws(() => safePaths([file]));
  assert.throws(() => safePaths([]));
});
test('a recovered image lock must pin the deployed direct dependencies with package integrity', () => {
  const manifest = { dependencies: { 'synthetic-package': '^1.0.0' } };
  const lock = { lockfileVersion: 3, packages: { '': { dependencies: manifest.dependencies },
    'node_modules/synthetic-package': { version: '1.2.0', integrity: 'sha512-synthetic' } } };
  assert.equal(validateRecoveredLock(JSON.stringify(lock), manifest).lockfileVersion, 3);
  assert.throws(() => validateRecoveredLock(JSON.stringify(lock), { dependencies: { other: '^2' } }));
  assert.throws(() => validateRecoveredLock(JSON.stringify({ ...lock, packages: { '': lock.packages[''] } }), manifest));
  assert.throws(() => validateRecoveredLock('{}', manifest));
});
test('deployment is limited to the five approved source targets and has no configuration/IAM/migration flags', () => {
  for (const name of ['officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate']) {
    const args = deployArgs(name, '/tmp/reviewed-source');
    assert.deepEqual(args, ['functions', 'deploy', name, '--project=demac-corporation', '--region=us-central1', '--gen2', '--source=/tmp/reviewed-source', '--quiet', '--format=value(state)']);
  }
  assert.throws(() => deployArgs('projectAuthority', '/tmp/source'));
  assert.throws(() => deployArgs('officeBookingAuthority', 'relative'));
});
test('patch preserves every unrelated file and the deployed dependency lock; exact replay is allowed', () => {
  const before = { 'package.json': 'manifest', 'package-lock.json': 'lock', 'bootstrap.js': 'bootstrap', 'technicianDailyScheduleService.js': 'old' };
  const after = { ...before, 'technicianDailyScheduleService.js': 'new', 'bookingLocationDisplay.js': 'helper' };
  assert.deepEqual(verifyDelta(before, after, 'helper').sort(), ['bookingLocationDisplay.js', 'technicianDailyScheduleService.js']);
  assert.deepEqual(verifyDelta(after, after, 'helper'), []);
  for (const key of ['bootstrap.js', 'package.json', 'package-lock.json']) assert.throws(() => verifyDelta(before, { ...after, [key]: 'changed' }, 'helper'));
  assert.throws(() => verifyDelta(before, { ...after, 'unrelated.js': 'new' }, 'helper'));
  assert.throws(() => verifyDelta(before, { ...after, 'bookingLocationDisplay.js': 'wrong' }, 'helper'));
});
