const assert = require('node:assert/strict');
class ReferenceDb {
  constructor(seed = {}) { this.records = new Map(Object.entries(seed)); }
  collection(path) {
    const db = this;
    const query = (filters = [], maximum = Infinity, cursor = '') => ({
      where(field, op, expected) { return query([...filters, [field, op, expected]], maximum, cursor); },
      limit(count) { return query(filters, count, cursor); },
      startAfter(document) { return query(filters, maximum, document.id); },
      async get() {
        const values = [...db.records.entries()].filter(([key, data]) => key.startsWith(path + '/') && key.slice(path.length + 1).indexOf('/') < 0
          && key.split('/').pop() > cursor && filters.every(([field, op, expected]) => op === '==' ? data[field] === expected : op === 'in' ? expected.includes(data[field]) : op === '<=' ? data[field] <= expected : false)).sort(([a], [b]) => a.localeCompare(b)).slice(0, maximum);
        return { docs: values.map(([key, data]) => ({ id: key.split('/').pop(), exists: true, data: () => data, ref: db.collection(path).doc(key.split('/').pop()) })) };
      },
      doc(id) {
        const key = path + '/' + id;
        return { id, path: key, collection: child => db.collection(key + '/' + child),
          async get() { return { id, exists: db.records.has(key), data: () => db.records.get(key) }; },
          async create(value) { if (db.records.has(key)) throw Object.assign(new Error('Exists'), { code: 6 }); db.records.set(key, value); },
          async set(value, options) { db.records.set(key, options?.merge ? { ...db.records.get(key), ...value } : value); },
          async delete() { db.records.delete(key); },
        };
      },
    });
    return query();
  }
  async runTransaction(callback) {
    const writes = [];
    const tx = { get: ref => { assert.equal(writes.length, 0, 'Firestore transaction read after write'); return ref.get(); },
      set: (ref, value, options) => writes.push(() => ref.set(value, options)),
      create: (ref, value) => writes.push(() => ref.create(value)), delete: ref => writes.push(() => ref.delete()) };
    const result = await callback(tx);
    for (const write of writes) await write();
    return result;
  }
}
function response() { return { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; } }; }
module.exports = { ReferenceDb, response };
