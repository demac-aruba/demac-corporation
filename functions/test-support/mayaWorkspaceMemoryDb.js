const assert = require('node:assert/strict');
class Snapshot {
  constructor(ref, value) { this.ref = ref; this.id = ref.id; this.value = value; this.exists = value !== undefined; }
  data() { return this.exists ? { ...this.value } : undefined; }
}
class Ref {
  constructor(db, collectionName, id) { this.db = db; this.collectionName = collectionName; this.id = id; this.path = `${collectionName}/${id}`; }
  get() { return Promise.resolve(this.db.snapshot(this)); }
}
class Query {
  constructor(db, name, filters = [], order = null, max = Infinity, cursor = null) {
    this.db = db; this.collectionName = name; this.filters = filters; this.order = order; this.max = max; this.cursor = cursor;
  }
  doc(id) { return new Ref(this.db, this.collectionName, id); }
  where(field, operator, value) { return new Query(this.db, this.collectionName, [...this.filters, [field, operator, value]], this.order, this.max, this.cursor); }
  limit(max) { return new Query(this.db, this.collectionName, this.filters, this.order, max, this.cursor); }
  orderBy(field, direction = 'asc') { return new Query(this.db, this.collectionName, this.filters, [field, direction], this.max, this.cursor); }
  startAfter(cursor) { return new Query(this.db, this.collectionName, this.filters, this.order, this.max, cursor); }
  get() { return Promise.resolve(this.db.query(this)); }
}
class MemoryDb {
  constructor(seed = {}) {
    this.docs = new Map(); this.writes = []; this.queries = []; this.reads = []; this.failCommit = false;
    for (const [name, values] of Object.entries(seed)) for (const value of values) {
      const { id, ...rest } = value; this.docs.set(`${name}/${id}`, rest);
    }
  }
  collection(name) { return new Query(this, name); }
  snapshot(ref) { this.reads.push(ref.path); return new Snapshot(ref, this.docs.get(ref.path)); }
  query(query) {
    this.queries.push(query);
    let values = [...this.docs].filter(([path]) => path.startsWith(`${query.collectionName}/`))
      .map(([path, value]) => new Snapshot(new Ref(this, query.collectionName, path.split('/')[1]), value));
    values = values.filter(snapshot => query.filters.every(([field, operator, expected]) => {
      const actual = snapshot.data()[field];
      if (operator === '==') return actual === expected;
      if (operator === '>=') return actual >= expected;
      if (operator === '<') return actual < expected;
      if (operator === '<=') return actual <= expected;
      throw new Error(`Unsupported fixture operator ${operator}`);
    }));
    const compare = (a, b) => {
      const [field, direction] = query.order || ['__name__', 'asc'];
      const av = field === '__name__' ? a.id : a.data()[field];
      const bv = field === '__name__' ? b.id : b.data()[field];
      const sign = direction === 'desc' ? -1 : 1;
      return av === bv ? sign * a.id.localeCompare(b.id) : sign * (av < bv ? -1 : 1);
    };
    values.sort(compare);
    if (query.cursor) values = values.filter(value => compare(value, query.cursor) > 0);
    return { docs: values.slice(0, query.max), empty: !values.length };
  }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async target => {
        assert.equal(writes.length, 0, 'Firestore requires every transaction read before writes');
        return target instanceof Query ? this.query(target) : this.snapshot(target);
      },
      set: (ref, value, options = {}) => writes.push({ ref, value, merge: options.merge === true }),
    };
    const result = await callback(transaction);
    if (this.failCommit) throw new Error('Simulated atomic commit failure');
    for (const write of writes) this.docs.set(write.ref.path, write.merge ? { ...this.docs.get(write.ref.path), ...write.value } : write.value);
    this.writes.push(...writes.map(write => write.ref.path));
    return result;
  }
  read(collection, id) { return this.docs.get(`${collection}/${id}`); }
  patch(collection, id, value) { this.docs.set(`${collection}/${id}`, { ...this.read(collection, id), ...value }); }
}
module.exports = { MemoryDb };
