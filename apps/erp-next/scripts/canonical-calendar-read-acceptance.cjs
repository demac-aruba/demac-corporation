/* Read-only regression for the actual loader. No Firebase connection is used. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/canonical-operations.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loader(calendar, failure) {
  const reads = [];
  const module = { exports: {} };
  const scopedRequire = (id) => {
    if (id === './firebase/firestore-rest') return {
      listFirestoreCollection: async (collection, limit) => { reads.push({ collection, limit }); assert.notEqual(collection, 'businessSettings'); return []; },
      getFirestoreDocument: async (collection, id) => { reads.push({ collection, id }); if (failure) throw failure; return calendar; },
    };
    if (id === './workforce-readiness') return { normalizeWorkforceSkills: () => { throw Error('Calendar loading must not invent workforce data'); } };
    throw Error(`Unexpected loader dependency: ${id}`);
  };
  new vm.Script(`(function(require,module,exports){${compiled}\n})`, { filename: 'canonical-operations.js' }).runInThisContext()(scopedRequire, module, module.exports);
  return { load: module.exports.loadCanonicalOperationsState, reads };
}
test('calendar loader scopes settings access to exact canonical document and preserves calendar values', async () => {
  const calendar = { id: 'business-calendar', closedWeekdays: [0, 6], exceptions: ['owner-configured'], version: 11 };
  const { load, reads } = loader(calendar);
  const result = await load();
  assert.deepEqual(result.businessCalendar, calendar);
  assert.deepEqual(reads.filter((read) => read.collection === 'businessSettings'), [{ collection: 'businessSettings', id: 'business-calendar' }]);
  assert.equal(reads.length, 8, 'The same seven operational collections plus the exact calendar');
});
test('missing calendar retains the existing Sunday default, not a fabricated schedule', async () => {
  const result = await loader(null).load();
  assert.deepEqual(result.businessCalendar, { id: 'business-calendar', closedWeekdays: [0] });
});
test('read denial and connectivity failures propagate, never masquerade as missing calendar', async () => {
  const error = Error('permission/network failure');
  await assert.rejects(loader(null, error).load(), (cause) => cause === error);
});
