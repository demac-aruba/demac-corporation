'use strict';
/** A transaction fault injector for unit tests, never imported by the runtime.
 * The emulator suite independently tests these cases against actual Firestore.
 */
function transactionStore() {
  const rows = new Map();
  let fault = null;
  const snapshot = ref => ({ exists: rows.has(ref.path), id: ref.id, ref, data: () => structuredClone(rows.get(ref.path)) });
  const collection = name => ({ doc: key => document(`${name}/${key}`) });
  function document(path) {
    return { path, id: path.split('/').pop(), collection: name => collection(`${path}/${name}`),
      get: async () => snapshot(document(path)),
      set: async value => { rows.set(path, structuredClone(value)); },
      delete: async () => rows.delete(path),
    };
  }
  const db = { collection, get: async ref => snapshot(ref), async runTransaction(work) {
    const writes = [];
    const tx = { get: async ref => { if (writes.length) throw Error('read-after-write'); return snapshot(ref); },
      update: (ref, value) => writes.push(['update', ref, value]),
      create: (ref, value) => writes.push(['create', ref, value]),
      set: (ref, value) => writes.push(['set', ref, value]),
      delete: ref => writes.push(['delete', ref]) };
    const result = await work(tx);
    for (const [kind, ref, data] of writes) {
      if (kind === 'delete') { rows.delete(ref.path); continue; }
      if (kind === 'create' && rows.has(ref.path)) throw Error('already-exists');
      if (kind !== 'update') rows.set(ref.path, structuredClone(data));
      else {
        const row = structuredClone(rows.get(ref.path));
        for (const [field, value] of Object.entries(data)) {
          const parts = field.split('.'); let target = row;
          for (const part of parts.slice(0, -1)) { if (!target[part]) target[part] = {}; target = target[part]; }
          target[parts.at(-1)] = structuredClone(value);
        }
        rows.set(ref.path, row);
      }
    }
    if (fault?.(writes)) { fault = null; throw Object.assign(Error('Acknowledgement lost after committed transaction'), { code: 'UNAVAILABLE' }); }
    return result;
  }};
  return { db, rows, failAfterCommitOnce: predicate => { fault = predicate; } };
}
module.exports = { transactionStore };
