'use strict';
// Integration, not an in-memory repository: exact service and Firestore/Storage
// adapters, two fresh service instances and an anonymous public snapshot read.
// Guard every endpoint before importing Firebase. No live project is allowed.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST']) {
  assert.match(process.env[key] || '', /^127\.0\.0\.1:\d+$/, `${key}: local emulator required`);
}
const requireTest = createRequire('/tmp/editor-rules/package.json');
const { initializeApp, deleteApp } = requireTest('firebase-admin/app');
const { getFirestore, FieldValue } = requireTest('firebase-admin/firestore');
const { getStorage } = requireTest('firebase-admin/storage');
const { PAGE, defaults, normalizeVrf } = require('./websiteEditorialContract');
const { createWebsiteContentService } = require('./websiteContentService');
const { createWebsiteContentFirebase } = require('./websiteContentFirebase');
const projectId = 'demo-demac-website';
const bucketName = `${projectId}.appspot.com`;
const app = initializeApp({ projectId, storageBucket: bucketName }, 'website-editor-integration');
const db = getFirestore(app), bucket = getStorage(app).bucket();
const actor = { uid: 'editor-persistence-owner' };
const sentinelCollections = ['appointments', 'clients', 'workOrders', 'vans', 'staffProfiles', 'taskRecords'];
let enabled = true;
const adapters = () => createWebsiteContentFirebase({ db, bucket, deleteField: () => FieldValue.delete(), deploymentEnabled: () => enabled });
const instance = () => createWebsiteContentService(adapters());
const command = (action, extra = {}) => ({ pageId: 'vrf', action, ...extra });
const initial = normalizeVrf(defaults);
before(async () => {
  await db.doc(`users/${actor.uid}`).set({ active: true, role: 'admin' });
  await db.doc('users/editor-persistence-office').set({ active: true, role: 'office' });
  await db.doc('businessSettings/website-editor').set({ backendEnabled: true });
  await db.doc(`businessSettings/${PAGE.draftId}`).delete();
  await db.doc(`businessSettings/${PAGE.publishedId}`).delete();
  for (const collection of sentinelCollections) await db.doc(`${collection}/editor-isolation-sentinel`).set({ preserved: true, marker: collection });
  await bucket.file(PAGE.publicPath).save(JSON.stringify(initial), { resumable: false, metadata: { contentType: 'application/json' } });
});
after(async () => { await db.terminate(); await deleteApp(app); });

test('draft survives a new service instance; publish/restore are real emulator transactions', async () => {
  const first = instance();
  const loaded = await first.execute(actor, command('load'));
  const beforePublic = await adapters().media.read();
  const saved = await first.execute(actor, command('save', { expectedRevision: loaded.revision, changes: [{ key: 'hero.title', value: 'Persisted integration draft' }] }));
  assert.equal(saved.revision, loaded.revision + 1);
  assert.deepEqual(await adapters().media.read(), beforePublic, 'Saving a draft must not publish');
  const second = instance();
  const recovered = await second.execute(actor, command('load'));
  assert.equal(recovered.content.hero.title, 'Persisted integration draft');
  assert.equal(recovered.revision, saved.revision);
  const requestId = randomUUID();
  const release = await second.execute(actor, command('publish', { expectedRevision: saved.revision, requestId }));
  assert.equal(release.publicationId, requestId);
  const publicUrl = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(PAGE.publicPath)}?alt=media`;
  const anonymous = await fetch(publicUrl);
  assert.equal(anonymous.status, 200);
  const currentPublic = await anonymous.json();
  assert.equal(currentPublic.publicationId, requestId); assert.equal(currentPublic.hero.title, 'Persisted integration draft');
  const replay = await instance().execute(actor, command('publish', { expectedRevision: saved.revision, requestId }));
  assert.equal(replay.publicationId, requestId);
  const history = await instance().execute(actor, command('history'));
  assert(history.some((entry) => entry.id === requestId));
  const restored = await instance().execute(actor, command('restore', { expectedRevision: saved.revision, revisionId: requestId }));
  assert.equal(restored.content.hero.title, initial.hero.title);
  assert.equal((await adapters().media.read()).content.hero.title, 'Persisted integration draft', 'Restore is draft-only');
});

test('real adapter denies nonowners, protected fields, stale drafts and disabled writes', async () => {
  const service = instance();
  await assert.rejects(service.execute({ uid: 'editor-persistence-office' }, command('load')), { status: 403 });
  const current = await service.execute(actor, command('load'));
  await assert.rejects(service.execute(actor, command('save', { expectedRevision: current.revision, changes: [{ key: 'hero.primaryCta.href', value: '/unapproved' }] })), { status: 400 });
  await assert.rejects(service.execute(actor, command('save', { expectedRevision: current.revision - 1, changes: [{ key: 'hero.title', value: 'Stale' }] })), { status: 409 });
  enabled = false;
  await assert.rejects(service.execute(actor, command('save', { expectedRevision: current.revision, changes: [{ key: 'hero.title', value: 'Disabled' }] })), { status: 503 });
  enabled = true;
});

test('editor persistence leaves operational sentinel documents unchanged', async () => {
  for (const collection of sentinelCollections) {
    assert.deepEqual((await db.doc(`${collection}/editor-isolation-sentinel`).get()).data(), { preserved: true, marker: collection });
  }
});
