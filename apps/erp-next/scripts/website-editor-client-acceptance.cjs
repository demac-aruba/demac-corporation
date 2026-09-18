/* Actual repository adapter, transpiled with injected read-only/local test ports.
 * No Firebase endpoint or browser session is contacted by these tests. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const contract = require('../../../functions/websiteEditorialContract');
const source = fs.readFileSync(path.join(__dirname, '../lib/website-editor/client.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function client(handler) {
  const commands = [], module = { exports: {} };
  const imports = {
    '@/lib/firebase/principal': { loadFirebasePrincipal: async () => ({ active: true, role: 'super_admin', userId: 'owner' }) },
    '@/lib/firebase/session': { requireFirebaseWebSession: async () => ({ idToken: 'local-test-only' }) },
    '@/lib/firebase/client-config': { firebaseClientConfig: { projectId: 'demo-editor' } },
    '@/lib/firebase/storage-rest': { uploadPublicWebsiteImage: async () => { throw Error('Unexpected image upload'); } },
    './contract': { ...contract, isReviewBuild: () => false },
  };
  const context = { module, exports: module.exports, Error, Date, structuredClone, AbortSignal, URL,
    require: (id) => { assert(Object.hasOwn(imports, id), `Unexpected adapter import ${id}`); return imports[id]; },
    fetch: async (_url, options) => { const command = JSON.parse(options.body); commands.push(command); return handler(command); },
  };
  vm.runInNewContext(compiled, context);
  return { repository: module.exports.createEditorialRepository('owner'), Recovery: module.exports.PublicationRecoveryRequired, commands };
}
const snapshot = (revision = 3, pendingPublicationId) => ({ content: contract.normalizeVrf(contract.defaults), revision, savedAt: '2026-09-17T12:00:00Z', ...(pendingPublicationId ? { pendingPublicationId } : {}) });
const response = (result) => ({ ok: true, json: async () => ({ ok: true, result }) });

test('an uncertain publication freezes request ID AND revision; retries cannot publish new edits', async () => {
  let count = 0;
  const { repository, Recovery, commands } = client(async () => {
    if (++count === 1) throw Error('Lost HTTP response');
    return response({ ...snapshot(3), publicationId: 'original-request' });
  });
  await assert.rejects(repository.publish(3, 'original-request'), (error) => error instanceof Recovery && error.requestId === 'original-request' && error.expectedRevision === 3);
  await assert.rejects(repository.save([{ key: 'hero.title', value: 'Do not save' }], 3), Recovery);
  await assert.rejects(repository.restore('revision', 3), Recovery);
  await assert.rejects(repository.reset(3), Recovery);
  const result = await repository.publish(4, 'different-request');
  assert.equal(result.publicationId, 'original-request');
  assert.deepEqual(commands, [
    { pageId: 'vrf', action: 'publish', requestId: 'original-request', expectedRevision: 3 },
    { pageId: 'vrf', action: 'publish', requestId: 'original-request', expectedRevision: 3 },
  ]);
});
test('reloading reconciles a rejected preflight with no persisted pending receipt', async () => {
  const { repository, commands } = client(async (command) => {
    if (command.action === 'publish') return { ok: false, json: async () => ({ ok: false, message: 'Draft changed', code: 'draft-conflict' }) };
    return response(snapshot(command.action === 'save' ? 5 : 4));
  });
  await assert.rejects(repository.publish(3, 'rejected-request'), /Draft changed/);
  const loaded = await repository.load(contract.defaults);
  assert.equal(loaded.revision, 4);
  await repository.save([{ key: 'hero.title', value: 'Reviewed current draft' }], 4);
  assert.equal(commands[2].action, 'save');
});
test('new editing tab recovers the server pending receipt with its exact revision', async () => {
  const { repository, commands } = client(async (command) => response(command.action === 'load' ? snapshot(8, 'server-pending') : { ...snapshot(8), publicationId: 'server-pending' }));
  await repository.load(contract.defaults);
  await repository.publish(100, 'must-not-replace-server-request');
  assert.deepEqual(commands[1], { pageId: 'vrf', action: 'publish', requestId: 'server-pending', expectedRevision: 8 });
});
test('unreadable publish response is never described as proof that nothing was published', async () => {
  const { repository } = client(async () => ({ ok: false, json: async () => { throw Error('Malformed response'); } }));
  await assert.rejects(repository.publish(2, 'unknown'), (error) => error.message.includes('could not be verified') && !error.message.includes('Nothing was published'));
});
test('public route boundary excludes every operational route and preserves approved public navigation', () => {
  const source = fs.readFileSync(path.join(__dirname, '../lib/website-editor/contract.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} }; vm.runInNewContext(compiled, { module, exports: module.exports, require: () => contract });
  const allowed = module.exports.isPublicWebsiteRoute;
  for (const route of ['/', '/about/', '/services/vrf-systems/', '/services/commercial', '/contact', '/careers/', '/project-gallery/project-one']) assert.equal(allowed(route), true, route);
  for (const route of ['/login', '/scheduling', '/crm', '/projects', '/work-orders', '/field', '/settings', '/website-manager', '/recruitment', '/careers-preview', '/api', '/contact-admin', '/project-gallery/../../settings']) assert.equal(allowed(route), false, route);
});
