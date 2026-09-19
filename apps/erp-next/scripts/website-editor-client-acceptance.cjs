/* Actual live repository and anonymous-publication verifier with local ports. */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const contract = require('../../../functions/websiteEditorialContract');
function compile(file, imports, extras = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error, Date, structuredClone, AbortSignal, URL, ...extras, require: (id) => { assert(Object.hasOwn(imports, id), `Unexpected import ${id}`); return imports[id]; } });
  return module.exports;
}
function client(handler, readOverride) {
  const commands = []; let visible = null;
  const verifier = compile('../lib/website-editor/publication-check.ts', { './contract': contract, '@/lib/public-vrf-public': { readPublishedVrfContent: async () => readOverride ? readOverride(visible) : visible } });
  const exports = compile('../lib/website-editor/client.ts', {
    '@/lib/firebase/principal': { loadFirebasePrincipal: async () => ({ active: true, role: 'super_admin', userId: 'owner' }) },
    '@/lib/firebase/session': { requireFirebaseWebSession: async () => ({ idToken: 'local-test-only' }) },
    '@/lib/firebase/client-config': { firebaseClientConfig: { projectId: 'demo-editor' } },
    './media': { uploadWebsiteEditorImage: async () => { throw Error('Unexpected image upload'); } },
    './contract': { ...contract, isReviewBuild: () => false }, './publication-check': verifier,
  }, { fetch: async (_url, options) => {
    const command = JSON.parse(options.body); commands.push(command); const response = await handler(command);
    if (command.action === 'publish' && response.ok) {
      const body = await response.json(); visible = body.result?.content ? { ...body.result.content, publicationId: body.result.publicationId } : null;
      return { ...response, json: async () => body };
    }
    return response;
  } });
  return { repository: exports.createEditorialRepository('owner'), Recovery: exports.PublicationRecoveryRequired, commands };
}
const snapshot = (revision = 3, pendingPublicationId) => ({ content: contract.normalizeVrf(contract.defaults), revision, savedAt: '2026-09-17T12:00:00Z', ...(pendingPublicationId ? { pendingPublicationId } : {}) });
const response = (result) => ({ ok: true, json: async () => ({ ok: true, result }) });

test('uncertain publication freezes ID and revision; retries cannot publish new edits', async () => {
  let count = 0;
  const { repository, Recovery, commands } = client(async () => { if (++count === 1) throw Error('Lost HTTP response'); return response({ ...snapshot(3), publicationId: 'original-request' }); });
  await assert.rejects(repository.publish(3, 'original-request'), (error) => error instanceof Recovery && error.requestId === 'original-request' && error.expectedRevision === 3);
  await assert.rejects(repository.save([{ key: 'hero.title', value: 'Do not save' }], 3), Recovery);
  await assert.rejects(repository.restore('revision', 3), Recovery); await assert.rejects(repository.reset(3), Recovery);
  assert.equal((await repository.publish(4, 'different-request')).publicationId, 'original-request');
  assert.deepEqual(commands, [{ pageId: 'vrf', action: 'publish', requestId: 'original-request', expectedRevision: 3 }, { pageId: 'vrf', action: 'publish', requestId: 'original-request', expectedRevision: 3 }]);
});
test('reload reconciles a rejected preflight without a persisted pending receipt', async () => {
  const { repository, commands } = client(async (command) => command.action === 'publish' ? { ok: false, json: async () => ({ ok: false, message: 'Draft changed', code: 'draft-conflict' }) } : response(snapshot(command.action === 'save' ? 5 : 4)));
  await assert.rejects(repository.publish(3, 'rejected-request'), /Draft changed/);
  assert.equal((await repository.load(contract.defaults)).revision, 4);
  await repository.save([{ key: 'hero.title', value: 'Reviewed current draft' }], 4); assert.equal(commands[2].action, 'save');
});
test('new editing tab recovers the exact pending server receipt', async () => {
  const { repository, commands } = client(async (command) => response(command.action === 'load' ? snapshot(8, 'server-pending') : { ...snapshot(8), publicationId: 'server-pending' }));
  await repository.load(contract.defaults); await repository.publish(100, 'must-not-replace-server-request');
  assert.deepEqual(commands[1], { pageId: 'vrf', action: 'publish', requestId: 'server-pending', expectedRevision: 8 });
});
test('unreadable publish response never claims nothing was published', async () => {
  const { repository } = client(async () => ({ ok: false, json: async () => { throw Error('Malformed response'); } }));
  await assert.rejects(repository.publish(2, 'unknown'), (error) => error.message.includes('could not be verified') && !error.message.includes('Nothing was published'));
});
test('public routes exclude operational routes and preserve approved navigation', () => {
  const allowed = compile('../lib/website-editor/contract.ts', { '../../../../functions/websiteEditorialContract': contract }).isPublicWebsiteRoute;
  for (const route of ['/', '/about/', '/services/vrf-systems/', '/services/commercial', '/contact', '/careers/', '/project-gallery/project-one']) assert.equal(allowed(route), true, route);
  for (const route of ['/login', '/scheduling', '/crm', '/projects', '/work-orders', '/field', '/settings', '/website-manager', '/recruitment', '/careers-preview', '/api', '/contact-admin', '/project-gallery/../../settings']) assert.equal(allowed(route), false, route);
});
test('first save carries the full import token; later saves use only persisted revision', async () => {
  const token = 'a'.repeat(64);
  const { repository, commands } = client(async (command) => response(command.action === 'load' ? { ...snapshot(0), seedToken: token } : snapshot(command.expectedRevision + 1)));
  await repository.load(contract.defaults); await repository.save([], 0); await repository.save([], 1);
  assert.equal(commands[1].expectedSeedToken, token); assert.equal(commands[2].expectedSeedToken, undefined);
});
test('a bad save acknowledgement is not accepted as a durable cloud save', async () => {
  const { repository } = client(async () => response({ content: null, revision: 1 }));
  await assert.rejects(repository.save([], 0), /invalid/);
});
test('public read failure retains exact publication recovery identity', async () => {
  let offline = true;
  const { repository, Recovery, commands } = client(async (command) => response({ ...snapshot(3), publicationId: command.requestId }), (visible) => { if (offline) throw Error('Public read offline'); return visible; });
  await assert.rejects(repository.publish(3, 'public-check'), Recovery); offline = false;
  await repository.publish(99, 'must-not-be-new'); assert.equal(commands[1].requestId, 'public-check'); assert.equal(commands[1].expectedRevision, 3);
});
test('wrong public version or modified public text cannot become verified success', async () => {
  for (const read of [() => null, (v) => ({ ...v, publicationId: 'different' }), (v) => ({ ...v, hero: { ...v.hero, title: 'Not the approved text' } })]) {
    const { repository, Recovery } = client(async () => response({ ...snapshot(3), publicationId: 'expected' }), read);
    await assert.rejects(repository.publish(3, 'expected'), Recovery);
  }
});
test('a reply for a different request is rejected before clearing pending state', async () => {
  const { repository, Recovery } = client(async () => response({ ...snapshot(3), publicationId: 'wrong' }));
  await assert.rejects(repository.publish(3, 'expected'), Recovery); await assert.rejects(repository.save([], 3), Recovery);
});

function mediaAdapter(reply, decodeFails = false) {
  const calls = [], decoded = [];
  const module = compile('../lib/website-editor/media.ts', {
    '@/lib/firebase/client-config': { firebaseClientConfig: { storageBucket: 'demo-editor.appspot.com' } },
    '@/lib/firebase/session': { requireFirebaseWebSession: async () => ({ idToken: 'test-fixture' }) },
    './contract': { PAGE: { id: 'vrf' } },
  }, { Blob, crypto: require('node:crypto').webcrypto, setTimeout, clearTimeout,
    Image: class { naturalWidth = 236; naturalHeight = 159; async decode() { decoded.push(this.src); if (decodeFails) throw Error('Image decoding failed'); } },
    fetch: async (url, options) => { calls.push({ url, options }); return reply(url, options); },
  });
  return { upload: module.uploadWebsiteEditorImage, calls, decoded };
}
test('website image upload preserves metadata, bytes and Firebase auth, then verifies the public URL', async () => {
  const image = new Blob(['original-image-bytes'], { type: 'image/webp' });
  const media = mediaAdapter(async (url, options) => {
    const name = new URL(url).searchParams.get('name');
    assert.equal(options.headers.Authorization, 'Firebase test-fixture');
    assert.equal(options.headers['X-Goog-Upload-Protocol'], 'multipart');
    const body = await options.body.text();
    assert(body.includes('"contentType":"image/webp"')); assert(body.includes('original-image-bytes'));
    return { ok: true, json: async () => ({ name, bucket: 'demo-editor.appspot.com', contentType: image.type, size: image.size }) };
  });
  const result = await media.upload(image);
  assert.equal(media.calls.length, 1); assert.deepEqual(media.decoded, [result]);
  assert.match(result, /public-website%2Fvrf%2Feditor%2F/); assert(!result.includes('token='));
});
test('denied or mismatched image acknowledgement cannot report a successful cloud upload', async () => {
  const image = new Blob(['bytes'], { type: 'image/webp' });
  const denied = mediaAdapter(async () => ({ ok: false, status: 403 }));
  await assert.rejects(denied.upload(image), /not confirmed/); assert.equal(denied.decoded.length, 0);
  const mismatch = mediaAdapter(async () => ({ ok: true, json: async () => ({ name: 'wrong-object' }) }));
  await assert.rejects(mismatch.upload(image), /acknowledgement is invalid/);
  await assert.rejects(mismatch.upload(new Blob(['bad'], { type: 'text/html' })), /JPEG/);
});
