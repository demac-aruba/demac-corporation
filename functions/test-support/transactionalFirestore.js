'use strict';
// Synthetic MVCC store: snapshot reads, all-reads-before-writes, atomic commits,
// optimistic conflicts and transaction retries. No production connectivity.
const clone = value => value === undefined ? undefined : structuredClone(value);
class Snapshot {
  constructor(path, value) { this.id = path.split('/').at(-1); this.exists = value !== undefined; this.value = clone(value); }
  data() { return clone(this.value); }
}
class Query {
  constructor(db, path, filters = [], count = Infinity, sort = null) { Object.assign(this, { db, path, filters, count, sort }); }
  doc(id) { return new Ref(this.db, `${this.path}/${id}`); }
  where(field, operator, value) { return new Query(this.db, this.path, [...this.filters, [field, operator, value]], this.count, this.sort); }
  limit(count) { return new Query(this.db, this.path, this.filters, count, this.sort); }
  orderBy(field, direction) { return new Query(this.db, this.path, this.filters, this.count, [field, direction]); }
  snapshot(store) {
    let docs = [...store].filter(([path, value]) => path.startsWith(`${this.path}/`) && path.split('/').length === this.path.split('/').length + 1 && this.filters.every(([field, operator, match]) => {
      if (operator === '==') return value[field] === match;
      if (operator === '>=') return value[field] >= match;
      if (operator === '<=') return value[field] <= match;
      throw Error('Unsupported test query');
    })).map(([path, value]) => new Snapshot(path, value));
    if (this.sort) { const [field, direction] = this.sort; docs.sort((a,b) => String(a.data()[field]).localeCompare(String(b.data()[field])) * (direction === 'desc' ? -1 : 1)); }
    docs = docs.slice(0, this.count); return { docs, empty: !docs.length, size: docs.length };
  }
  async get() { return this.snapshot(this.db.store); }
}
class Ref {
  constructor(db, path) { Object.assign(this, { db, path, id: path.split('/').at(-1) }); }
  collection(name) { return new Query(this.db, `${this.path}/${name}`); }
  snapshot(store) { return new Snapshot(this.path, store.get(this.path)); }
  async get() { return this.snapshot(this.db.store); }
  async set(value, options) { this.db.write(this.path, options?.merge ? { ...this.db.read(this.path), ...value } : value); }
  async update(value) { if (!this.db.store.has(this.path)) throw Error('Not found'); this.db.write(this.path, { ...this.db.read(this.path), ...value }); }
}
class TransactionalFirestore {
  constructor(seed = {}) { this.store = new Map(Object.entries(clone(seed))); this.revision = 0; this.retries = 0; }
  collection(name) { return new Query(this, name); }
  read(path) { return clone(this.store.get(path)); }
  write(path, value) { this.store.set(path, clone(value)); this.revision++; }
  async runTransaction(fn) {
    for (let attempt = 0; attempt < 10; attempt++) {
      const revision = this.revision, snapshot = new Map([...this.store].map(([key,value]) => [key,clone(value)])), writes = [];
      const tx = {
        get: async ref => { if (writes.length) throw Error('Transaction read after write'); return ref.snapshot(snapshot); },
        set: (ref, value, options) => writes.push({ ref, value: clone(value), merge: options?.merge }),
        update: (ref, value) => { if (!snapshot.has(ref.path)) throw Error('Update missing document'); writes.push({ ref, value: clone(value), merge: true }); },
        delete: ref => writes.push({ ref, remove: true }),
      };
      const result = await fn(tx);
      if (revision !== this.revision) { this.retries++; continue; }
      for (const { ref, value, merge, remove } of writes) {
        if (remove) this.store.delete(ref.path);
        else this.store.set(ref.path, merge ? { ...this.store.get(ref.path), ...value } : value);
      }
      if (writes.length) this.revision++;
      return result;
    }
    throw Error('Synthetic transaction retry limit');
  }
}
module.exports = { TransactionalFirestore };
