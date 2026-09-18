/* Regression for the retained operational readers, not a new calendar design.
 * The scoped-reader refactor was withdrawn from this UI release. These tests
 * exercise the actual unchanged readers, including mixed settings and outages. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../lib/canonical-operations.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function loader(settings, failure) {
  const reads = [];
  const module = { exports: {} };
  const scopedRequire = (id) => {
    if (id === './firebase/firestore-rest') return {
      listFirestoreCollection: async (collection, limit) => {
        reads.push({ collection, limit });
        if (failure && collection === 'businessSettings') throw failure;
        return collection === 'businessSettings' ? settings : [];
      },
    };
    if (id === './workforce-readiness') return { normalizeWorkforceSkills: () => { throw Error('Calendar loading must not invent workforce data'); } };
    throw Error(`Unexpected operational dependency: ${id}`);
  };
  new vm.Script(`(function(require,module,exports){${compiled}\n})`, { filename: 'canonical-operations.js' }).runInThisContext()(scopedRequire, module, module.exports);
  return { load: module.exports.loadCanonicalOperationsState, reads };
}
test('unchanged calendar reader preserves canonical values among unrelated website settings', async () => {
  const calendar = { id: 'business-calendar', closedWeekdays: [0, 6], exceptions: ['owner-configured'], version: 11 };
  const { load, reads } = loader([{ id: 'publicVrfPageDraft', closedWeekdays: [1] }, calendar, { id: 'publicVrfPagePublished', version: 500 }]);
  assert.deepEqual((await load()).businessCalendar, calendar);
  assert.equal(reads.length, 8);
  assert.equal(reads.filter((read) => read.collection === 'businessSettings').length, 1);
});
test('missing calendar retains the existing Sunday default', async () => {
  assert.deepEqual((await loader([]).load()).businessCalendar, { id: 'business-calendar', closedWeekdays: [0] });
});
test('permission and network errors are not converted into a fabricated calendar', async () => {
  for (const reason of ['permission denied', 'network offline']) {
    const error = Error(reason); await assert.rejects(loader([], error).load(), (cause) => cause === error);
  }
});
function legacyReader(reply) {
  const sourcePath = path.resolve(__dirname, '../../../src/services/firebase.ts');
  const legacy = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const reads = [], module = { exports: {} };
  const session = JSON.stringify({ uid: 'local-fixture', idToken: 'test-only', expiresAt: Date.now() + 3_600_000 });
  vm.runInNewContext(legacy, {
    module, exports: module.exports,
    process: { env: { EXPO_PUBLIC_FIREBASE_PROJECT_ID: 'demo-local-calendar' } },
    require: (id) => { assert.equal(id, '@react-native-async-storage/async-storage'); return { getItem: async () => session, setItem: async () => {}, removeItem: async () => {} }; },
    fetch: async (url, options) => { assert.equal(options?.method || 'GET', 'GET'); reads.push(url); return reply(url, reads.length); },
  }, { filename: sourcePath });
  return { list: module.exports.listFirestoreCollection, reads };
}
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
test('Legacy retains its original paginated collection read and decoded document identities', async () => {
  const { list, reads } = legacyReader((url, index) => response(200, { documents: [{ name: `documents/businessSettings/${index === 1 ? 'business-calendar' : 'appointment-work-presets'}`, fields: { active: { booleanValue: true } } }], ...(index === 1 ? { nextPageToken: 'page-two' } : {}) }));
  assert.deepEqual(JSON.parse(JSON.stringify(await list('businessSettings'))), [{ active: true, id: 'business-calendar' }, { active: true, id: 'appointment-work-presets' }]);
  assert.equal(reads.length, 2); assert(reads[1].includes('pageToken=page-two'));
});
test('Legacy permission and network errors remain visible to callers', async () => {
  await assert.rejects(legacyReader(() => response(403, { error: { message: 'denied fixture' } })).list('businessSettings'), /denied fixture/);
  await assert.rejects(legacyReader(() => { throw Error('offline fixture'); }).list('businessSettings'), /offline fixture/);
});
test('editor is not imported into operational calendar readers or the deployed function entry', () => {
  const root = path.resolve(__dirname, '../../..');
  for (const file of ['src/state/CalendarState.tsx', 'src/services/firebase.ts', 'apps/erp-next/lib/canonical-operations.ts', 'functions/bootstrap.js']) {
    assert(!/website-editor|websiteContentApi|websiteContentService/.test(fs.readFileSync(path.join(root, file), 'utf8')), file);
  }
});
test('candidate security rules remain separate from the production deployment configuration', () => {
  const root = path.resolve(__dirname, '../../..');
  const production = JSON.parse(fs.readFileSync(path.join(root, 'firebase.json'), 'utf8'));
  const emulated = JSON.parse(fs.readFileSync(path.join(root, 'website-editor.emulator.json'), 'utf8'));
  assert.equal(production.firestore.rules, 'firestore.rules'); assert.equal(production.storage.rules, 'storage.rules');
  assert.notEqual(emulated.firestore.rules, production.firestore.rules); assert.notEqual(emulated.storage.rules, production.storage.rules);
  for (const filename of ['firestore.rules', 'storage.rules']) assert(!fs.readFileSync(path.join(root, filename), 'utf8').includes('websiteEditorEnabled'));
});
