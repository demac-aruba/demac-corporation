'use strict';

function fieldFirestoreData(value, path = 'field') {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') return value;

  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new Error(`Field Firestore data cannot contain undefined array values at ${path}[${index}].`);
      }
      return fieldFirestoreData(item, `${path}[${index}]`);
    });
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    // Firestore-native values (Timestamp, GeoPoint, FieldValue, DocumentReference, etc.)
    // must retain their prototype and are passed through unchanged.
    return value;
  }

  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    result[key] = fieldFirestoreData(item, `${path}.${key}`);
  }
  return result;
}

function fieldSnapshotRecord(document) {
  if (!document || typeof document.data !== 'function') {
    throw new Error('Field Firestore snapshot record requires a document with data().');
  }
  const id = String(document.id ?? '').trim();
  if (!id) throw new Error('Field Firestore snapshot record requires a document id.');
  const data = document.data();
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Field Firestore snapshot record requires object document data.');
  }
  // Firestore document identity is authoritative. A redundant persisted `id` field may be
  // useful for compatibility, but it must never override the actual document id on reads.
  return { ...data, id };
}

module.exports.fieldFirestoreData = fieldFirestoreData;
module.exports.fieldSnapshotRecord = fieldSnapshotRecord;
