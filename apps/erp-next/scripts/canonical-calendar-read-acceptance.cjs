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

function legacyReader(reply) {
  const sourcePath = path.resolve(__dirname, '../../../src/services/firebase.ts');
  const legacy = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const reads = [];
  const module = { exports: {} };
  const session = JSON.stringify({ uid: 'local-fixture', idToken: 'test-only', expiresAt: Date.now() + 3_600_000 });
  const context = {
    module, exports: module.exports,
    process: { env: { EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-local-calendar' } },
    require: (id) => {
      assert.equal(id, '@react-native-async-storage/async-storage');
      return { getItem: async () => session, setItem: async () => {}, removeItem: async () => {} };
    },
    fetch: async (url, options) => {
      assert.equal(options?.method || 'GET', 'GET', 'Calendar compatibility is read-only');
      reads.push(new URL(url).pathname);
      return reply(url, reads.length);
    },
  };
  vm.runInNewContext(legacy, context, { filename: sourcePath });
  return { list: module.exports.listFirestoreCollection, reads };
}
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
test('Legacy calendar requests exact documents and retains decoded values and array shape', async () => {
  const { list, reads } = legacyReader((url) => response(200, { fields: { label: { stringValue: new URL(url).pathname.endsWith('business-calendar') ? 'Calendar' : 'Presets' }, active: { booleanValue: true } } }));
  const result = await list('businessSettings', ['business-calendar', 'appointment-work-presets', 'business-calendar']);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [ { label: 'Calendar', active: true, id: 'business-calendar' }, { label: 'Presets', active: true, id: 'appointment-work-presets' } ]);
  assert.equal(reads.length, 2);
  assert(reads.every((url) => /\/businessSettings\/(business-calendar|appointment-work-presets)$/.test(url)));
  const calendarSource = fs.readFileSync(path.resolve(__dirname, '../../../src/state/CalendarState.tsx'), 'utf8');
  assert(calendarSource.includes("listFirestoreCollection<BusinessCalendarSettings>('businessSettings', ['business-calendar', 'appointment-work-presets'])"));
});
test('Legacy selected reads omit missing documents but propagate permission and network failures', async () => {
  assert.equal((await legacyReader(() => response(404, {})).list('businessSettings', ['business-calendar'])).length, 0);
  await assert.rejects(legacyReader(() => response(403, { error: { message: 'denied fixture' } })).list('businessSettings', ['business-calendar']), /denied fixture/);
  await assert.rejects(legacyReader(() => { throw Error('offline fixture'); }).list('businessSettings', ['business-calendar']), /offline fixture/);
});
test('Legacy unrelated collection pagination keeps its original behavior', async () => {
  const { list, reads } = legacyReader((url, index) => response(200, { documents: [{ name: `documents/vans/v${index}`, fields: { active: { booleanValue: true } } }], ...(index === 1 ? { nextPageToken: 'page-two' } : {}) }));
  const result = await list('vans');
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [{ active: true, id: 'v1' }, { active: true, id: 'v2' }]);
  assert.equal(reads.length, 2);
});
test('source-owned appointment preset authority remains explicit before the legacy patch pipeline', () => {
  const rules = fs.readFileSync(path.resolve(__dirname, '../../../firestore.rules'), 'utf8');
  assert(rules.includes('APPOINTMENT_SETTINGS_V11'));
  assert(rules.includes("settingId == 'appointment-work-presets' ? adminRole() : operationsRole()"));
});
