'use strict';
const { test } = require('node:test'); const assert = require('node:assert/strict');
const { movementRow } = require('./registry-materials');
const order = { id: 'WO-ONE', status: 'Confirmada' };
const data = () => ({ id: 'MOV-ONE', version: 1, type: 'issue_to_work_order', workOrderId: order.id,
  itemKind: 'material', itemId: 'M-ONE', itemName: 'Synthetic piping', quantity: 2.125, sourceLocationId: 'VAN-ONE', occurredAt: '2026-09-19T12:00:00.000Z' });
const snapshot = value => ({ id: 'MOV-ONE', data: () => value });
test('recorded quantity and identity are read without inventing a historical price', () => {
  const value = data(); const before = structuredClone(value); const row = movementRow(snapshot(value), order);
  assert.equal(row.quantity, 2.125); assert.equal(row.itemId, value.itemId); assert.equal(row.unitCost, null); assert.equal(row.totalCost, null); assert.deepEqual(value, before);
});
test('current catalog cost or unrelated monetary fields cannot become actual Project costs', () => {
  const row = movementRow(snapshot({ ...data(), cost: 900, unitCost: 999, totalCost: 10000, currency: 'USD' }), order);
  assert.equal(row.totalCost, null); assert.equal(row.unitCost, null);
});
test('transfer adjustments and unsupported types are not silently counted as materials used', () => {
  for (const type of ['transfer', 'set_stock_level', 'unknown', 'return_to_stock']) assert.throws(() => movementRow(snapshot({ ...data(), type }), order));
});
test('wrong movement identity, version or Work Order is rejected', () => {
  for (const patch of [{ id: 'OTHER' }, { version: 2 }, { workOrderId: 'OTHER' }, { itemKind: 'tool' }, { itemId: 'a/b' }]) assert.throws(() => movementRow(snapshot({ ...data(), ...patch }), order));
});
test('invalid, negative or overprecise quantities fail instead of rounding into real usage', () => {
  for (const quantity of [0, -1, NaN, Infinity, '2', 0.0001, Number.MAX_SAFE_INTEGER]) assert.throws(() => movementRow(snapshot({ ...data(), quantity }), order));
});
test('products require whole quantities and cancelled jobs do not erase movement history', () => {
  assert.throws(() => movementRow(snapshot({ ...data(), itemKind: 'product' }), order));
  const row = movementRow(snapshot({ ...data(), quantity: 2, itemKind: 'product' }), { ...order, status: 'Cancelada' });
  assert.equal(row.quantity, 2); assert.equal(row.workOrderStatus, 'Cancelada');
});
test('missing source time or location stays an evidence error', () => {
  for (const patch of [{ occurredAt: 'yesterday' }, { sourceLocationId: '' }]) assert.throws(() => movementRow(snapshot({ ...data(), ...patch }), order));
});
