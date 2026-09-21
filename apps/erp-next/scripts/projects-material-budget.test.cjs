'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { materialBudgetInput, parseMaterialBudget, materialBudgetLabel } = require('../lib/projects/material-budget.ts');

test('optional budget remains unknown, not certified zero', () => {
  assert.equal(parseMaterialBudget(''), null);
  assert.equal(parseMaterialBudget('  '), null);
});
test('preserve every cent throughout supported bounds and metadata edits', () => {
  for (const amountMinor of [1, 10, 29, 100, 120035, Number.MAX_SAFE_INTEGER - 1, Number.MAX_SAFE_INTEGER]) {
    assert.deepEqual(parseMaterialBudget(materialBudgetInput(amountMinor)), { currency: 'AWG', amountMinor });
  }
  assert.equal(materialBudgetInput(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  assert.equal(materialBudgetLabel({ currency: 'AWG', amountMinor: Number.MAX_SAFE_INTEGER }), 'AWG 90,071,992,547,409.91');
});
test('reject zero, rounding, exponent, negative and unsupported magnitudes', () => {
  for (const raw of ['0', '0.00', '-1', '1.001', '90071992547409.92', '1e3', 'Infinity', 'NaN', '1,000', '1'.repeat(33)]) {
    assert.throws(() => parseMaterialBudget(raw), undefined, raw);
  }
  for (const value of [0, -1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => materialBudgetInput(value));
});
