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

module.exports.fieldFirestoreData = fieldFirestoreData;
