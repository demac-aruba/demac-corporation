const test = require('node:test'), assert = require('node:assert/strict');
const { planTariffs, encoded } = require('./appointment-finance-tariff-plan.cjs');
const { decode, auditTariffs } = require('./appointment-finance-release-audit.cjs');
const decodeFields = fields => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));
test('absent settings plan creates all 15 approved prices only if still absent', () => {
  const plan = planTariffs(null); assert.deepEqual(plan.currentDocument, { exists: false });
  assert.ok(auditTariffs(decodeFields(plan.fields)).every(row => row.matchesApproved));
  assert.equal(plan.fieldPaths.length, 6); assert.equal(decode(plan.fields.version), 1);
});
test('existing settings preserve durations, unknown typed fields and extra BTUs', () => {
  const row = encoded({ btu: 12000, price: 200, durationMinutes: 97, extra: 'preserve' });
  row.mapValue.fields.reviewedAt = { timestampValue: '2026-01-01T00:00:00Z' };
  const document = { updateTime: '2026-10-12T00:00:00.123456Z', fields: { version: encoded(7), unknown: encoded('keep'), standardInstallationAdinaDemac: { arrayValue: { values: [row, encoded({ btu: 60000, price: 999, durationMinutes: 300 })] } } } };
  const before = structuredClone(document), plan = planTariffs(document);
  assert.deepEqual(document, before); assert.deepEqual(plan.currentDocument, { updateTime: document.updateTime });
  assert.ok(!plan.fieldPaths.includes('unknown')); assert.ok(!plan.fieldPaths.includes('currency')); assert.equal(decode(plan.fields.version), 8);
  const rows = plan.fields.standardInstallationAdinaDemac.arrayValue.values;
  assert.deepEqual(rows[0], { mapValue: { fields: { ...row.mapValue.fields, price: encoded(225) } } });
  assert.deepEqual(rows[1], document.fields.standardInstallationAdinaDemac.arrayValue.values[1]);
});
test('already applied tariffs produce no second write or version bump', () => {
  const first = planTariffs(null), second = planTariffs({ fields: first.fields, updateTime: 'synthetic-time' });
  assert.equal(second.changed, false); assert.deepEqual(second.fieldPaths, []);
});
test('ambiguous rows, malformed schema and invalid version fail before any write', () => {
  for (const fields of [
    { standardServiceSplit: encoded([{ btu: 12000, price: 125 }, { btu: 12000, price: 125 }]) },
    { deepCleaningSplit: encoded('not-an-array') },
    { version: encoded('not-a-version') },
  ]) assert.throws(() => planTariffs({ fields, updateTime: 'synthetic-time' }));
  assert.throws(() => planTariffs({ fields: {} }), /precondition/);
});
