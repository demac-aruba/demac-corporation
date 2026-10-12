'use strict';
// A bounded, idempotent settings plan. Applying it belongs to the audited release,
// using Firestore's document updateTime (or exists:false) precondition.
const assert = require('node:assert/strict');
const { DEFAULT_SERVICE_PRICING_RULES } = require('../functions/demacServicePricingRules');
const { auditTariffs, decode } = require('./appointment-finance-release-audit.cjs');
const GROUPS = ['standardServiceSplit', 'deepCleaningSplit', 'standardInstallationAdinaDemac'];
function encoded(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encoded) } };
  if (value && typeof value === 'object') return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encoded(item)])) } };
  throw Error('Unsupported new pricing field');
}
function planTariffs(document) {
  const current = document?.fields || {};
  if (document) assert.ok(document.updateTime, 'Existing settings require an updateTime precondition');
  const decoded = Object.fromEntries(Object.entries(current).map(([key, value]) => [key, decode(value)]));
  const rows = auditTariffs(decoded);
  if (rows.every(row => row.matchesApproved)) return { changed: false, rows, fields: {}, fieldPaths: [] };
  const fields = {};
  for (const group of GROUPS) {
    const existing = current[group];
    assert.ok(!existing || existing.arrayValue, 'Unrecognized pricing array; do not overwrite');
    const values = structuredClone(existing?.arrayValue?.values || []);
    for (const approved of DEFAULT_SERVICE_PRICING_RULES[group]) {
      const matches = values.filter(row => Number(decode(row)?.btu) === approved.btu);
      assert.ok(matches.length < 2, 'Duplicate pricing rows require reconciliation');
      if (matches.length) matches[0].mapValue.fields.price = encoded(approved.price);
      else values.push(encoded(approved));
    }
    fields[group] = { arrayValue: { values } };
  }
  const version = decoded.version === undefined ? 0 : decoded.version;
  assert.ok(Number.isSafeInteger(version) && version >= 0 && version < Number.MAX_SAFE_INTEGER, 'Invalid settings version');
  fields.version = encoded(version + 1);
  if (!document) { fields.id = encoded(DEFAULT_SERVICE_PRICING_RULES.id); fields.currency = encoded(DEFAULT_SERVICE_PRICING_RULES.currency); }
  return { changed: true, rows, fields, fieldPaths: Object.keys(fields),
    currentDocument: document ? { updateTime: document.updateTime } : { exists: false } };
}
module.exports = { planTariffs, encoded };
