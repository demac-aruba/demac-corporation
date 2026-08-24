const assert = require('node:assert/strict');
const test = require('node:test');
const { profileVanFallbackAllowed } = require('./fieldOperationsAuthorityCore');
const { projectCanonicalWorkVisit } = require('./fieldOperationsAuthorityWorkVisit');

test('any dated staff assignment suppresses stale profile-Van fallback even when its Van id is unresolved', () => {
  const identity = { staffId: 'staff-moved', vanId: 'VAN-1' };
  const context = {
    dailyAssignments: [{
      id: 'malformed-override',
      date: '2026-08-24',
      vanId: 'historical-van-that-is-not-in-catalog',
      driverStaffId: 'staff-moved',
    }],
    memberships: [],
    vanAliases: new Map(),
  };
  assert.equal(profileVanFallbackAllowed(identity, context), false);
});

test('Legacy WorkVisit projection may fill validated structural ids without inventing historical planned work', () => {
  const projected = projectCanonicalWorkVisit({
    id: 'legacy-visit',
    workOrderId: 'WO-1',
    clientId: 'CLIENT-1',
    status: 'not_started',
    participatingStaffIds: ['staff-tech'],
    requiresSecondVisit: false,
    scheduledScopeSnapshot: {
      estimatedUnitCount: 1,
      problemDescription: 'Legacy scope text',
    },
    createdAt: '2026-08-20T10:00:00Z',
    createdByUserId: 'legacy-user',
    updatedAt: '2026-08-20T10:00:00Z',
    updatedByUserId: 'legacy-user',
    version: 1,
  }, {
    appointmentId: 'APT-1',
    propertyId: 'PROPERTY-1',
  });

  assert.equal(projected.appointmentId, 'APT-1');
  assert.equal(projected.propertyId, 'PROPERTY-1');
  assert.equal(projected.scheduledScopeSnapshot.appointmentId, 'APT-1');
  assert.deepEqual(projected.scheduledScopeSnapshot.workLines, []);
  assert.equal(projected.scheduledScopeSnapshot.customerFacingDescription, 'Legacy scope text');
});
