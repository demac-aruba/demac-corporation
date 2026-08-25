const assert = require('node:assert/strict');
const test = require('node:test');
const { fieldFirestoreData } = require('./fieldOperationsFirestoreData');

function containsUndefined(value) {
  if (value === undefined) return true;
  if (Array.isArray(value)) return value.some(containsUndefined);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.values(value).some(containsUndefined);
  }
  return false;
}

test('drops undefined optional object properties recursively without changing valid values', () => {
  const source = {
    id: 'visit-1',
    leadTechnicianStaffId: undefined,
    nested: { kept: 'yes', omitted: undefined, zero: 0, no: false, empty: '' },
    rows: [{ id: 'row-1', optional: undefined }, { id: 'row-2', value: null }],
  };
  const result = fieldFirestoreData(source);

  assert.deepEqual(result, {
    id: 'visit-1',
    nested: { kept: 'yes', zero: 0, no: false, empty: '' },
    rows: [{ id: 'row-1' }, { id: 'row-2', value: null }],
  });
  assert.equal(containsUndefined(result), false);
});

test('rejects undefined array entries instead of silently changing positional meaning', () => {
  assert.throws(
    () => fieldFirestoreData({ values: ['a', undefined, 'b'] }),
    /cannot contain undefined array values at field\.values\[1\]/,
  );
});

test('preserves Firestore-native style object instances instead of flattening prototypes', () => {
  class NativeValue { constructor(value) { this.value = value; } }
  const native = new NativeValue('timestamp-like');
  const result = fieldFirestoreData({ native });
  assert.equal(result.native, native);
});
