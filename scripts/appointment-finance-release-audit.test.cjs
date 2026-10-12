const test = require('node:test');
const assert = require('node:assert/strict');
const { auditTariffs, decode } = require('./appointment-finance-release-audit.cjs');
const { DEFAULT_SERVICE_PRICING_RULES } = require('../functions/demacServicePricingRules');
test('all 15 owner approved prices match independently defined audit', () => {
  const result = auditTariffs(DEFAULT_SERVICE_PRICING_RULES);
  assert.equal(result.length, 15); assert.ok(result.every(row => row.matchesApproved));
});
test('missing, null, duplicate and stale prices cannot pass live tariff audit', () => {
  for (const mutate of [
    d => { delete d.standardServiceSplit; },
    d => { d.deepCleaningSplit[4].price = 225; },
    d => { d.standardInstallationAdinaDemac[1].price = null; },
    d => { d.standardServiceSplit.push(d.standardServiceSplit[0]); },
  ]) { const data = structuredClone(DEFAULT_SERVICE_PRICING_RULES); mutate(data); assert.ok(auditTariffs(data).some(row => !row.matchesApproved)); }
});
test('Firestore numeric decoding keeps null distinct from zero', () => {
  assert.equal(decode({ nullValue: null }), null);
  assert.equal(decode({ integerValue: '0' }), 0);
  assert.deepEqual(decode({ arrayValue: { values: [{ mapValue: { fields: { price: { doubleValue: 125.5 } } } }] } }), [{ price: 125.5 }]);
});
