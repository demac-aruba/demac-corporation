'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const C = require('./websiteEditorialContract');
const { createWebsiteContentService } = require('./websiteContentService');
const copy = (v) => v == null ? v : structuredClone(v);
function setup() {
  const state = { draft: null, published: null, pending: null, releases: new Map(), profiles: { owner: { role: 'admin', active: true }, office: { role: 'office', active: true }, inactive: { role: 'admin', active: false } }, enabled: true };
  let publicState = { generation: '1', content: C.normalizeVrf(C.defaults) }, writes = 0, afterWrite = null, readFailure = null, queue = Promise.resolve();
  const store = {
    profile: async (uid) => copy(state.profiles[uid]), enabled: async () => state.enabled,
    read: async () => copy({ draft: state.draft, pending: state.pending, published: state.published }),
    release: async (id) => copy(state.releases.get(id)), history: async () => [...state.releases.values()].reverse().map(copy),
    transaction: (work, uid, id) => {
      const run = queue.then(async () => {
        if (!state.enabled) throw Object.assign(Error('disabled'), { status: 503 });
        const result = await work(copy({ draft: state.draft, published: state.published, pending: state.pending, profile: state.profiles[uid], release: state.releases.get(id) }));
        if (result.draft) state.draft = copy(result.draft);
        if (result.published) state.published = copy(result.published);
        if ('pending' in result) state.pending = copy(result.pending);
        if (result.release) state.releases.set(result.release.id, copy(result.release));
        return copy(result.result);
      });
      queue = run.catch(() => {}); return run;
    },
  };
  const media = {
    read: async () => { if (readFailure) throw readFailure; return copy(publicState); },
    compareAndWrite: async (content, expected) => {
      if ((publicState?.generation || '0') !== expected) throw Object.assign(Error('precondition'), { code: 412 });
      writes++; publicState = { generation: String(Number(expected) + 1), content: copy(content) };
      if (afterWrite) await afterWrite(); return publicState.generation;
    },
  };
  const service = createWebsiteContentService({ store, media });
  const execute = (action, args = {}, uid = 'owner') => service.execute({ uid }, { action, pageId: 'vrf', ...args });
  return { state, execute, media, service, store, current: () => copy(publicState), writes: () => writes,
    externallyPublish: (content) => { publicState = { generation: String(Number(publicState?.generation || 0) + 1), content: copy(content) }; },
    afterWrite: (hook) => { afterWrite = hook; }, readFailure: (error) => { readFailure = error; } };
}
const change = (value) => [{ key: 'hero.title', value }];

test('editor allowlist has unique stable fields and excludes behavior, forms and structure', () => {
  const base = C.normalizeVrf(C.defaults), fields = C.descriptors(base), before = JSON.stringify(base);
  assert.equal(new Set(fields.map((f) => f.key)).size, fields.length);
  assert(fields.length > 100);
  for (const key of ['hero.primaryCta.href', 'hero.primaryCta.label', 'hero.style', 'careers.roles', '__proto__.polluted', 'solutions.0.title', 'indoorUnits.__proto__.title']) assert.throws(() => C.applyChanges(base, [{ key, value: 'unsafe' }]));
  const edited = C.applyChanges(base, change('New owner-approved heading'));
  assert.equal(edited.hero.title, 'New owner-approved heading');
  assert.equal(JSON.stringify(base), before, 'No mutation of original content');
  assert.deepEqual(edited.hero.primaryCta, base.hero.primaryCta);
  assert.throws(() => C.applyChanges(base, [...change('A'), ...change('B')]));
  assert.throws(() => C.applyChanges(base, change('a'.repeat(241))));
  assert.throws(() => C.applyChanges(base, [{ key: 'hero.imagePosition', value: 'url(javascript:bad)' }]));
  assert.equal({}.polluted, undefined);
});
test('image paths are safe; local preview blobs cannot enter production writes', () => {
  const base = C.normalizeVrf(C.defaults);
  for (const value of ['javascript:alert(1)', 'http://site.test/a.png', '//site.test/a.png', '/\\site.test/a.png', '/a/../b.png', 'data:text/html,bad', 'https://u:p@site.test/a.png', 'blob:http://localhost/test']) assert.throws(() => C.applyChanges(base, [{ key: 'hero.imageUrl', value }]));
  assert.equal(C.applyChanges(base, [{ key: 'hero.imageUrl', value: 'blob:http://localhost/test' }], { allowPreviewImages: true }).hero.imageUrl, 'blob:http://localhost/test');
  assert.equal(C.applyChanges(base, [{ key: 'hero.imageUrl', value: '/website/vrf/test.webp' }]).hero.imageUrl, '/website/vrf/test.webp');
});
test('legacy six-unit content normalizes idempotently and preserves operator text', () => {
  const input = { indoorUnits: [{ id: 'split-unit', title: 'Split Units' }, { id: 'wall-mounted', title: 'Custom title', description: 'Custom description', detail: '' }] };
  const once = C.normalizeVrf(input);
  assert.equal(once.indoorUnits.length, 5); assert.equal(once.indoorUnits[4].id, 'mini-split');
  assert.equal(once.indoorUnits[4].title, 'Custom title'); assert.equal(once.indoorUnits[4].detail, '');
  assert.deepEqual(C.normalizeVrf(once), once);
});
test('all read and write commands recheck provisioned active owner and activation', async () => {
  const env = setup();
  for (const action of ['load', 'save', 'publish', 'history', 'restore', 'reset']) for (const uid of ['office', 'inactive', 'missing']) await assert.rejects(env.execute(action, {}, uid), { status: 403 });
  await assert.rejects(env.service.execute({}, { pageId: 'vrf', action: 'load' }), { status: 401 });
  env.state.enabled = false; await assert.rejects(env.execute('load'), { status: 503 });
  env.state.enabled = true; await assert.rejects(env.execute('load', { pageId: 'careers' }), { status: 403 });
  assert.equal(env.writes(), 0);
});
test('drafts persist between service instances; saving never updates published data', async () => {
  const env = setup(), original = env.current();
  const initial = await env.execute('load'); assert.equal(initial.revision, 0);
  const saved = await env.execute('save', { changes: change('Cloud draft'), expectedRevision: 0 });
  assert.equal(saved.revision, 1); assert.equal(saved.content.hero.title, 'Cloud draft');
  const other = createWebsiteContentService({ store: env.store, media: env.media });
  assert.equal((await other.execute({ uid: 'owner' }, { action: 'load', pageId: 'vrf' })).content.hero.title, 'Cloud draft');
  assert.deepEqual(env.current(), original); assert.equal(env.writes(), 0);
});
test('optimistic version prevents lost concurrent updates and illegal fields fail closed', async () => {
  const env = setup();
  const results = await Promise.allSettled(['First', 'Second'].map((value) => env.execute('save', { changes: change(value), expectedRevision: 0 })));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.status, 409);
  await assert.rejects(env.execute('save', { changes: [{ key: 'hero.primaryCta.href', value: '/bad' }], expectedRevision: 1 }), { status: 400 });
  assert.equal(env.state.draft.editorRevision, 1);
});
test('publication freezes exact revision, verifies bytes and replays idempotently', async () => {
  const env = setup(); await env.execute('save', { changes: change('Published title'), expectedRevision: 0 });
  const requestId = randomUUID(), args = { requestId, expectedRevision: 1 };
  const result = await env.execute('publish', args);
  assert.equal(result.publicationId, requestId); assert.equal(env.current().content.hero.title, 'Published title');
  assert.equal(env.state.pending, null); assert.equal(env.writes(), 1);
  assert.equal((await env.execute('publish', args)).publicationId, requestId); assert.equal(env.writes(), 1);
  await assert.rejects(env.execute('publish', { ...args, expectedRevision: 99 }), { status: 409 });
  assert.equal((await env.execute('history')).length, 1);
});
test('concurrent exact publication retries produce one Storage write and one receipt', async () => {
  const env = setup(); await env.execute('save', { changes: change('Single publication'), expectedRevision: 0 });
  const args = { requestId: randomUUID(), expectedRevision: 1 };
  const results = await Promise.all([env.execute('publish', args), env.execute('publish', args)]);
  assert.equal(results[0].publicationId, results[1].publicationId);
  assert.equal(env.writes(), 1); assert.equal(env.state.releases.size, 1);
});
test('uncertain Storage response recovers using the same request and exact digest', async () => {
  const env = setup(); await env.execute('save', { changes: change('Recovered write'), expectedRevision: 0 });
  const args = { requestId: randomUUID(), expectedRevision: 1 };
  env.afterWrite(async () => { env.readFailure(Error('network')); throw Error('lost response'); });
  await assert.rejects(env.execute('publish', args), { code: 'publication-uncertain' });
  assert.equal(env.state.pending.id, args.requestId); assert.equal(env.writes(), 1);
  env.readFailure(null); env.afterWrite(null);
  await assert.rejects(env.execute('save', { changes: change('No overwrite during uncertainty'), expectedRevision: 1 }), { status: 409 });
  assert.equal((await env.execute('load')).pendingPublicationId, args.requestId);
  const result = await env.execute('publish', args); assert.equal(result.publicationId, args.requestId);
  assert.equal(env.writes(), 1); assert.equal(env.state.pending, null);
});
test('failed read never converts a real outage into an absent or default publication', async () => {
  const env = setup(); env.readFailure(Error('Storage unavailable'));
  await assert.rejects(env.execute('load'), /unavailable/); assert.equal(env.writes(), 0);
});
test('external publication cannot be overwritten by a stale draft; explicit reset reconciles', async () => {
  const env = setup(); await env.execute('save', { changes: change('Old draft'), expectedRevision: 0 });
  const next = C.applyChanges(env.current().content, change('Newer external version')); env.externallyPublish(next);
  await assert.rejects(env.execute('publish', { requestId: randomUUID(), expectedRevision: 1 }), { code: 'published-version-conflict' });
  assert.equal(env.current().content.hero.title, 'Newer external version'); assert.equal(env.writes(), 0);
  const reset = await env.execute('reset', { expectedRevision: 1 }); assert.equal(reset.revision, 2); assert.equal(reset.content.hero.title, 'Newer external version');
});
test('restore creates a new draft only and cannot revert current protected CTA links', async () => {
  const env = setup(), original = env.current().content;
  const requestId = randomUUID(); await env.execute('save', { changes: change('Revision 1'), expectedRevision: 0 }); await env.execute('publish', { requestId, expectedRevision: 1 });
  const published = env.current();
  env.state.releases.get(requestId).previousContent.hero.primaryCta.href = '/historical-link-must-not-restore';
  const restored = await env.execute('restore', { revisionId: requestId, expectedRevision: 1 });
  assert.equal(restored.content.hero.title, original.hero.title); assert.equal(restored.content.hero.primaryCta.href, published.content.hero.primaryCta.href);
  assert.deepEqual(env.current(), published); assert.equal(restored.revision, 2);
});
test('a legacy draft cannot smuggle structural or action changes through visual publication', async () => {
  const env = setup(); env.state.draft = C.normalizeVrf(C.defaults); env.state.draft.hero.primaryCta.href = '/different-action';
  await env.execute('save', { changes: change('Editorial only'), expectedRevision: 0 }); await env.execute('publish', { requestId: randomUUID(), expectedRevision: 1 });
  assert.equal(env.current().content.hero.primaryCta.href, C.defaults.hero.primaryCta.href);
});
test('revoked owner cannot recover or replay an earlier authorized publication', async () => {
  const env = setup(); const requestId = randomUUID(); await env.execute('publish', { requestId, expectedRevision: 0 });
  env.state.profiles.owner.active = false;
  await assert.rejects(env.execute('publish', { requestId, expectedRevision: 0 }), { status: 403 }); assert.equal(env.writes(), 1);
});
test('replaying a superseded publication never republishes historical content', async () => {
  const env = setup(), first = { requestId: randomUUID(), expectedRevision: 0 }; await env.execute('publish', first);
  await env.execute('save', { changes: change('Later'), expectedRevision: 0 }); await env.execute('publish', { requestId: randomUUID(), expectedRevision: 1 });
  await assert.rejects(env.execute('publish', first), { code: 'publication-superseded' }); assert.equal(env.current().content.hero.title, 'Later'); assert.equal(env.writes(), 2);
});
