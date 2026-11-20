import test from 'node:test';
import assert from 'node:assert/strict';
import { blankBill, blankLine, changeRate, compareMarket, percentOf, purchaseCost, saleQuote, openDraft, evaluateLine, summarizeBill } from '../lib/supplier-bill-draft.ts';
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

function cassetteBill() {
  const lines = [
    ['TCL Cassette 36K', '3', '800.35'],
    ['Adina Air Handler 36K', '1', '1013.61'],
    ['Adina Air Handler 60K', '1', '1298.02'],
    ['Adina Cassette 60K', '2', '1070.38'],
  ].map(([description, quantity, unitCost]) => ({
    ...blankLine(), description, quantity, unitCost, marketing: '2', profit: '20', operations: '5',
  }));
  lines[0].importOverride = '50';
  return { ...bill, invoiceNumber: 'Cassette y manejadoras', lines };
}

test('batch projection for seven units matches the four supplier lines and survives reopening', () => {
  const draft = cassetteBill();
  const summary = summarizeBill(draft);
  assert.deepEqual(summary.totals, {
    sales: 2859753n, restock: 1887437n, taxes: 200182n, marketing: 57195n, profit: 571952n, operations: 142987n,
  });
  assert.equal(summary.finalCount, 0);
  assert.equal(summary.suggestedCount, 4);
  assert.deepEqual(summary.pendingLines, []);
  assert.equal(draft.lines.reduce((sum, line) => sum + purchaseCost(draft, line).supplierTotal, 0n), 685344n);
  assert.deepEqual(summarizeBill(openDraft(JSON.stringify(draft))), summary);
});

test('mixed batch uses each line’s own rates and price and reports excluded lines', () => {
  const suggested = { ...blankLine(), unitCost: '58', marketing: '5', profit: '20', operations: '10' };
  const final = { ...suggested, unitCost: '10', quantity: '2', finalPrice: '80', marketing: '10', profit: '25' };
  const internal = [{ ...suggested, use: 'tool' }, { ...final, use: 'consumable' }];
  const draft = { ...blankBill(), currency: 'AWG', lines: [
    suggested, final, { ...final, finalPrice: '80.001' }, ...internal, { ...suggested, quantity: '' },
  ] };
  const summary = summarizeBill(draft);
  assert.deepEqual(summary.totals, {
    sales: 26000n, restock: 7800n, taxes: 1820n, marketing: 2100n, profit: 6000n, operations: 8280n,
  });
  assert.equal(summary.finalCount, 1);
  assert.equal(summary.suggestedCount, 1);
  assert.equal(summary.internalCount, 2);
  assert.deepEqual(summary.pendingLines, [3, 6]);
  assert.deepEqual(summarizeBill(openDraft(JSON.stringify(draft))), summary);
  const internalOnly = summarizeBill({ ...draft, lines: internal });
  assert.equal(internalOnly.internalCount, 2);
  assert.equal(internalOnly.finalCount + internalOnly.suggestedCount, 0);
  assert.deepEqual(internalOnly.pendingLines, []);
  assert.ok(Object.values(internalOnly.totals).every(value => value === 0n));
});

test('fractional material rounds line amounts and balances operations; a zero final price remains explicit', () => {
  const material = {
    ...blankLine(), use: 'material', quantity: '0,5', unitCost: '0.03', marketing: '10', profit: '10',
    operations: '20', finalPrice: '0.10',
  };
  const local = { ...blankBill(), currency: 'AWG', lines: [material] };
  assert.deepEqual(summarizeBill(local).totals, {
    sales: 5n, restock: 2n, taxes: 1n, marketing: 1n, profit: 1n, operations: 0n,
  });
  const free = summarizeBill({ ...local, lines: [{ ...material, unitCost: '0.44', finalPrice: '0' }] });
  assert.equal(free.finalCount, 1);
  assert.equal(free.suggestedCount, 0);
  assert.deepEqual(free.totals, {
    sales: 0n, restock: 22n, taxes: 0n, marketing: 0n, profit: 0n, operations: -22n,
  });
});

test('the seven-unit financial review shows the actual batch margin, purchase components and operations gap', () => {
  const draft = cassetteBill();
  const finalPrices = ['', '3899', '4799', '4679'];
  draft.lines = draft.lines.map((line, i) => ({ ...line, finalPrice: finalPrices[i] }));
  const { analysis, totals, finalCount, suggestedCount } = summarizeBill(draft);
  assert.equal(finalCount, 3);
  assert.equal(suggestedCount, 1);
  assert.equal(analysis.productUnits, 7n);
  assert.deepEqual(totals, {
    sales: 2807492n, restock: 1887437n, taxes: 196523n, marketing: 56149n, profit: 561499n, operations: 105884n,
  });
  assert.deepEqual(analysis.purchase, {
    supplier: 685344n, converted: 1233619n, wire: 24671n, shipping: 629147n, landed: 1887437n, rounding: 0n,
  });
  assert.equal(analysis.recommendedSales, 2859753n);
  assert.equal(analysis.grossMargin, 920055n);
  assert.equal(percentOf(analysis.grossMargin, totals.sales), 3277n);
  assert.equal(percentOf(totals.operations, totals.sales), 377n);
  assert.equal(analysis.operationsTarget, 140375n);
  assert.equal(analysis.operationsShortfall, 34491n);
  assert.deepEqual(analysis.negativeOperationsLines, [2, 3]);
  assert.deepEqual(analysis.purchasePendingLines, []);
});

test('local purchases and sales have separate coverage; operations targets are weighted by valid line revenue', () => {
  const first = { ...blankLine(), unitCost: '100', quantity: '2', finalPrice: '120', marketing: '10', profit: '5', operations: '20' };
  const second = { ...first, unitCost: '30', quantity: '1', finalPrice: '200', marketing: '5', profit: '10', operations: '5' };
  const draft = { ...blankBill(), currency: 'AWG', lines: [
    first, second, { ...blankLine(), use: 'tool', unitCost: '15' },
    { ...second, unitCost: '20', finalPrice: 'broken' }, { ...second, unitCost: '' },
  ] };
  const { totals, analysis, pendingLines } = summarizeBill(draft);
  assert.equal(analysis.productUnits, null);
  assert.deepEqual(pendingLines, [4, 5]);
  assert.deepEqual(analysis.purchasePendingLines, [5]);
  assert.deepEqual(analysis.purchase, { supplier: 26500n, converted: 26500n, wire: 0n, shipping: 0n, landed: 26500n, rounding: 0n });
  assert.equal(totals.restock, 23000n);
  assert.equal(totals.sales, 44000n);
  assert.equal(analysis.grossMargin, 21000n);
  assert.equal(totals.operations, 11320n);
  assert.equal(analysis.operationsTarget, 5800n); // (240 × 20%) + (200 × 5%).
  assert.equal(percentOf(analysis.operationsTarget, totals.sales), 1318n);
  assert.equal(analysis.operationsShortfall, 0n);
  assert.deepEqual(analysis.negativeOperationsLines, [1]);
  const tenCents = { ...second, unitCost: '0', finalPrice: '0.10', operations: '5' };
  const tinyBatch = summarizeBill({ ...draft, lines: [tenCents, tenCents] });
  assert.equal(tinyBatch.analysis.operationsTarget, 1n); // Two half-cent targets round once for the batch.
});

test('product unit count can be shown before costs are entered, only with valid whole quantities', () => {
  const products = [blankLine(), { ...blankLine(), quantity: '4' }];
  assert.equal(summarizeBill({ ...bill, lines: products }).analysis.productUnits, 5n);
  for (const quantity of ['', '0', '1.5', '3x']) {
    assert.equal(summarizeBill({ ...bill, lines: [{ ...blankLine(), quantity }] }).analysis.productUnits, null);
  }
  assert.equal(summarizeBill({ ...bill, lines: [] }).analysis.productUnits, null);
});

test('fractional imports reconcile independently rounded purchase components and signed percentages', () => {
  const line = { ...blankLine(), use: 'material', unitCost: '0.03', quantity: '0.5', finalPrice: '0',
    marketing: '0', profit: '0', operations: '5' };
  const { analysis, totals } = summarizeBill({ ...bill, lines: [line] });
  assert.deepEqual(analysis.purchase, { supplier: 2n, converted: 3n, wire: 0n, shipping: 2n, landed: 4n, rounding: -1n });
  assert.equal(analysis.grossMargin, -4n);
  assert.equal(totals.operations, -4n);
  assert.equal(analysis.operationsTarget, 0n);
  assert.equal(analysis.operationsShortfall, 4n);
  assert.deepEqual(analysis.negativeOperationsLines, [1]);
  assert.equal(percentOf(analysis.grossMargin, totals.sales), null);
  assert.equal(percentOf(-1n, 32n), -313n);
  assert.equal(percentOf(1n, 32n), 313n);
});

test('dated market quotes compare prices in Afl per unit and explicitly distinguish simulations and invalid references', () => {
  const localQuote = { price: '4850', source: 'Cotización local', date: '2026-11-20' };
  const expected = { status: 'compared', referencePrice: 485000n, difference: -17100n, differenceBps: -353n, position: 'below' };
  assert.deepEqual(compareMarket(467900n, localQuote), expected);
  assert.deepEqual(compareMarket(467900n, { ...localQuote, simulated: true }), { ...expected, status: 'simulated' });
  assert.equal(compareMarket(485000n, localQuote).position, 'equal');
  assert.equal(compareMarket(500000n, localQuote).position, 'above');
  assert.equal(compareMarket(0n, localQuote).differenceBps, -10000n);
  assert.equal(compareMarket(467900n).status, 'missing');
  assert.equal(compareMarket(467900n, { ...localQuote, source: '' }).status, 'incomplete');
  for (const change of [{ price: '0' }, { price: '99.999' }, { date: '2026-02-29' }]) {
    assert.equal(compareMarket(467900n, { ...localQuote, ...change }).status, 'invalid');
  }
});

test('version-one drafts round-trip old lines and real, simulated or unfinished market references', () => {
  const draft = cassetteBill();
  assert.ok(openDraft(JSON.stringify(draft)).lines.every(line => line.market === undefined));
  const localQuote = { price: '4850', source: 'Cotización local', date: '2026-11-20' };
  draft.lines[1].market = localQuote;
  draft.lines[2].market = { ...localQuote, simulated: true };
  draft.lines[3].market = { price: '', source: 'Pendiente', date: '' };
  const reopened = openDraft(JSON.stringify(draft));
  assert.deepEqual(reopened, draft);
  assert.deepEqual(summarizeBill(reopened), summarizeBill(draft));
  for (const market of [{ ...localQuote, price: 4850 }, { ...localQuote, simulated: 'false' }, { ...localQuote, source: 'x'.repeat(241) }, { price: '4850' }]) {
    assert.throws(() => openDraft(JSON.stringify({ ...draft, lines: [{ ...draft.lines[0], market }] })));
  }
});

