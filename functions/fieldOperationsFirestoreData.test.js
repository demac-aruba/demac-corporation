const assert = require('node:assert/strict');
const test = require('node:test');
const { fieldFirestoreData, fieldSnapshotRecord } = require('./fieldOperationsFirestoreData');

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

test('Firestore snapshot document id overrides any redundant persisted id field', () => {
  const result = fieldSnapshotRecord({
    id: 'canonical-document-id',
    data: () => ({ id: 'corrupted-payload-id', visitId: 'visit-1' }),
  });

  assert.deepEqual(result, { id: 'canonical-document-id', visitId: 'visit-1' });
});

test('Firestore snapshot adapter fails closed on missing identity or malformed data', () => {
  assert.throws(() => fieldSnapshotRecord(null), /requires a document with data/);
  assert.throws(() => fieldSnapshotRecord({ id: '', data: () => ({}) }), /requires a document id/);
  assert.throws(() => fieldSnapshotRecord({ id: 'doc-1', data: () => null }), /requires object document data/);
  assert.throws(() => fieldSnapshotRecord({ id: 'doc-1', data: () => [] }), /requires object document data/);
});
