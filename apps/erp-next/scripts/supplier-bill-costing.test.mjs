import test from 'node:test';
import assert from 'node:assert/strict';
import { blankBill, blankLine, changeRate, purchaseCost, saleQuote, openDraft, evaluateLine } from '../lib/supplier-bill-draft.ts';
import { totalSupplierCostInput } from '../lib/supplier-cost-input.ts';

const bill = { ...blankBill(), generalImport: '50' };
const ac = { ...blankLine(), description: 'Split', quantity: '4', unitCost: '250', marketing: '5', profit: '15', operations: '22', finalPrice: '1199' };
const bracket = { ...ac, description: 'Bracket', quantity: '10', unitCost: '20', importOverride: '30', marketing: '4', profit: '18', operations: '20', finalPrice: '110' };
test('supplier price additions resolve exactly before currency conversion and preserve the final sale price', () => {
  const unitCost = totalSupplierCostInput('299.55+500.80');
  assert.equal(unitCost, '800.35');
  assert.equal(totalSupplierCostInput(' 299,55 + 500,80 + 10 '), '810.35');
  assert.equal(totalSupplierCostInput('0.10+0.20+0.70'), '1.00');
  assert.equal(totalSupplierCostInput('0+0'), '0.00');
  assert.equal(totalSupplierCostInput('999999999.98+0.01'), '999999999.99');
  const line = { ...ac, unitCost, quantity: '2' };
  const cost = purchaseCost(bill, line);
  assert.equal(cost.cost, 80035n);
  assert.equal(cost.converted, 144063n);
  assert.equal(cost.wire, 2881n);
  assert.equal(cost.shipping, 73472n);
  assert.equal(cost.landed, 220416n);
  assert.equal(cost.supplierTotal, 160070n);
  assert.equal(saleQuote(cost.landed, line).allocation.price, 119900n);
  assert.equal(purchaseCost({ ...bill, currency: 'AWG' }, line).landed, 80035n);
  assert.equal(openDraft(JSON.stringify({ ...bill, lines: [line] })).lines[0].unitCost, '800.35');
});
test('supplier additions reject incomplete, unsupported or overflowing expressions without partial totals', () => {
  for (const raw of ['299.55+', '+500.80', '1++2', '1+ ', '1+-2', '1+2*3', '1+1e2', '1+NaN', '1+Infinity', '1+(2)', '1+0.001', '1,000.00+2', '1+alert(1)', '999999999.99+0.01', '1+'.repeat(121) + '1']) {
    assert.throws(() => totalSupplierCostInput(raw), undefined, raw);
  }
  for (const raw of ['', '0', '299.55', ' 299,55 ', 'invalid']) assert.equal(totalSupplierCostInput(raw), raw);
});
test('approved mixed bill: manual import per unit, rounding, price and balanced funds', () => {
  for (const [line, cost, suggestion, residual] of [[ac, 68850n, 135000n, 18677n], [bracket, 4774n, 9361n, 3036n]]) {
    const calculated = purchaseCost(bill, line);
    assert.equal(calculated.landed, cost);
    const quote = saleQuote(cost, line);
    assert.equal(quote.recommended, suggestion);
    const a = quote.allocation;
    assert.equal(a.operations, residual);
    assert.equal(a.restock + a.taxes + a.marketing + a.profit + a.operations, a.price);
  }
  assert.equal(purchaseCost(bill, bracket).landedTotal, 47740n);
});
test('change of general rate preserves explicit overrides, including zero; origin is descriptive', () => {
  const free = { ...bracket, importOverride: '0', confirmed: true };
  const changed = changeRate({ ...bill, lines: [{ ...ac, confirmed: true }, free] }, '45');
  assert.deepEqual(changed.lines.map(x => x.confirmed), [false, true]);
  assert.equal(purchaseCost(changed, ac).landed, 66555n);
  assert.equal(purchaseCost({ ...changed, origin: 'USA' }, free).shipping, 0n);
  assert.throws(() => purchaseCost(blankBill(), free));
  assert.throws(() => purchaseCost(bill, { ...free, importOverride: '' }));
});
test('local goods and non-sale lines use their purchase cost only; quantities follow item use', () => {
  const local = { ...blankBill(), currency: 'AWG' };
  const tape = { ...blankLine(), use: 'consumable', quantity: '2,5', unitCost: '10' };
  assert.equal(purchaseCost(local, tape).landedTotal, 2500n);
  assert.equal(saleQuote(1000n, tape), null);
  assert.equal(saleQuote(1000n, { ...tape, use: 'tool' }), null);
  for (const quantity of ['0', '-3', '1.5', '1e2', 'NaN']) assert.throws(() => purchaseCost(bill, { ...ac, quantity }));
});
test('invalid or missing inputs remain distinct from explicit zero and from confirmed sale price', () => {
  assert.equal(saleQuote(68850n, { ...ac, finalPrice: '' }).allocation, null);
  assert.ok(saleQuote(68850n, { ...ac, finalPrice: '500' }).allocation.operations < 0n);
  for (const values of [{ profit: '93' }, { marketing: '' }, { marketing: '-1' }, { finalPrice: '1.999' }]) {
    const invalid = evaluateLine(bill, { ...ac, ...values });
    assert.equal(invalid.cost.landed, 68850n);
    assert.ok(invalid.error);
  }
});
test('draft import validates version and types, keeps input and requires renewed confirmation', () => {
  const saved = { ...bill, lines: [{ ...bracket, confirmed: true }] };
  assert.deepEqual(openDraft(JSON.stringify(saved)), { ...bill, lines: [{ ...bracket, confirmed: false }] });
  for (const data of [{ ...bill, version: 2 }, { ...bill, currency: ['USD'] }, { ...bill, lines: [{ ...ac, use: ['product'] }] }, { ...bill, lines: [] }, { ...bill, lines: Array(101).fill(ac) },
    { ...bill, lines: [{ ...ac, unitCost: 12 }] }, { ...bill, lines: [{ ...ac, importOverride: {} }] }]) {
    assert.throws(() => openDraft(JSON.stringify(data)));
  }
});

