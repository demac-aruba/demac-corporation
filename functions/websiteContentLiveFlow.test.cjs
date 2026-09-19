'use strict';
// Real Auth/Firestore/Storage emulators, deployed HTTP handler and LIVE client.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
for (const key of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_STORAGE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) assert.match(process.env[key] || '', /^127\.0\.0\.1:\d+$/, key);
const projectId = 'demo-demac-website', bucketName = `${projectId}.appspot.com`, origin = 'https://demac-aruba.com';
const tools = createRequire('/tmp/editor-rules/package.json');
const { initializeTestEnvironment, assertSucceeds, assertFails } = tools('@firebase/rules-unit-testing');
const { doc, getDoc, getDocs, setDoc, collection } = tools('firebase/firestore');
const { ref, uploadBytes, getBytes } = tools('firebase/storage');
const { initializeApp, deleteApp } = tools('firebase-admin/app');
const { getFirestore, FieldValue } = tools('firebase-admin/firestore');
const { getStorage } = tools('firebase-admin/storage');
const { getAuth } = tools('firebase-admin/auth');
const ts = tools('typescript');
const C = require('./websiteEditorialContract');
const { createWebsiteContentService } = require('./websiteContentService');
const { createWebsiteContentFirebase, PATHS } = require('./websiteContentFirebase');
const { createWebsiteContentHttp } = require('./websiteContentHttp');
const app = initializeApp({ projectId, storageBucket: bucketName }, 'website-live-http-flow');
const db = getFirestore(app), bucket = getStorage(app).bucket(), auth = getAuth(app);
const adapters = () => createWebsiteContentFirebase({ db, bucket, deleteField: () => FieldValue.delete(), deploymentEnabled: () => true });
let env, server, endpoint, owner, office, service, lastSaved, legacyBefore;
const initial = C.normalizeVrf(C.defaults);
const sentinelCollections = ['appointments', 'clients', 'workOrders', 'vans', 'staffProfiles', 'taskRecords'];
const publicURL = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(C.PAGE.publicPath)}?alt=media`;
async function account(role) {
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${randomUUID()}@example.test`, password: randomUUID(), returnSecureToken: true }) });
  assert.equal(response.status, 200); const result = await response.json();
  await db.doc(`users/${result.localId}`).set({ active: true, role }); return { uid: result.localId, token: result.idToken };
}
async function rpc(action, extra = {}, options = {}) {
  const response = await fetch(endpoint, { method: 'POST', headers: { Origin: options.origin || origin, 'Content-Type': 'application/json', ...(options.token === null ? {} : { Authorization: `Bearer ${options.token || owner.token}` }) }, body: JSON.stringify({ pageId: 'vrf', action, ...extra }) });
  return { status: response.status, body: await response.json() };
}
function compile(file, imports, extras = {}) {
  const module = { exports: {} }, filename = path.resolve('apps/erp-next/lib', file);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, Error, Date, structuredClone, AbortSignal, URL, ...extras, require: (id) => { assert(Object.hasOwn(imports, id), id); return imports[id]; } }); return module.exports;
}
function liveClient() {
  const publicReader = compile('public-vrf-public.ts', {
    './firebase/client-config': { isFirebaseClientConfigured: true, firebaseClientConfig: { storageBucket: bucketName } },
    './public-vrf-content': { defaultPublicVrfContent: initial, normalizePublicVrfContent: C.normalizeVrf, PUBLIC_VRF_CONFIG_PATH: C.PAGE.publicPath, VRF_PUBLISHED_ID: C.PAGE.publishedId },
  }, { fetch: async (url, options) => { assert.equal(new URL(url).hostname, 'firebasestorage.googleapis.com'); assert.equal(options?.headers?.Authorization, undefined); return fetch(publicURL, options); } });
  const verifier = compile('website-editor/publication-check.ts', { './contract': C, '@/lib/public-vrf-public': publicReader });
  const client = compile('website-editor/client.ts', {
    '@/lib/firebase/principal': { loadFirebasePrincipal: async () => ({ active: (await db.doc(`users/${owner.uid}`).get()).data().active, role: 'super_admin', userId: owner.uid }) },
    '@/lib/firebase/session': { requireFirebaseWebSession: async () => ({ idToken: owner.token }) },
    '@/lib/firebase/client-config': { firebaseClientConfig: { projectId, storageBucket: bucketName } },
    '@/lib/firebase/storage-rest': { uploadPublicWebsiteImage: async () => { throw Error('Image rules are exercised separately'); } },
    './contract': { ...C, isReviewBuild: () => false }, './publication-check': verifier,
  }, { fetch: (url, options) => { assert.equal(url, `https://us-central1-${projectId}.cloudfunctions.net/websiteContentApi`); return fetch(endpoint, { ...options, headers: { ...options.headers, Origin: origin } }); } });
  return client.createEditorialRepository(owner.uid);
}
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: Number(process.env.FIRESTORE_EMULATOR_HOST.split(':')[1]), rules: fs.readFileSync('firestore.rules', 'utf8') }, storage: { host: '127.0.0.1', port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')[1]), rules: fs.readFileSync('storage.rules', 'utf8') } });
  await env.clearFirestore(); // Hardcoded demo project; all hosts guarded above.
  owner = await account('admin'); office = await account('office');
  await db.doc('businessSettings/business-calendar').set({ closedWeekdays: [0], preserved: true });
  await db.doc(`businessSettings/${C.PAGE.publishedId}`).set(initial);
  const legacy = structuredClone(initial); legacy.hero.title = 'Existing Website Manager draft'; legacy.hero.primaryCta.href = '/legacy-link-not-editable';
  await db.doc(`businessSettings/${C.PAGE.draftId}`).set(legacy);
  for (const name of sentinelCollections) await db.doc(`${name}/website-isolation-sentinel`).set({ preserved: true, domain: name });
  await bucket.file(C.PAGE.publicPath).save(JSON.stringify(initial), { resumable: false, metadata: { contentType: 'application/json' } });
  service = createWebsiteContentService(adapters());
  const handler = createWebsiteContentHttp({ service: { execute: (...args) => service.execute(...args) }, verifyToken: (token, revoked) => auth.verifyIdToken(token, revoked), allowedOrigins: [origin] });
  server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 600_000) { response.writeHead(413); response.end(); return; } }
    request.get = (name) => request.headers[name.toLowerCase()];
    try { request.body = body ? JSON.parse(body) : null; } catch { request.body = null; }
    const reply = { set: (key, value) => { response.setHeader(key, value); return reply; }, status: (code) => { response.statusCode = code; return reply; }, json: (value) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); }, send: (value) => response.end(value) };
    await handler(request, reply);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); endpoint = `http://127.0.0.1:${server.address().port}/websiteContentApi`;
});
after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); await env?.cleanup(); await db.terminate(); await deleteApp(app); });

test('real tokens, origins and roles protect HTTP; status/load are read-only', async () => {
  assert.equal((await rpc('status')).status, 200);
  assert.equal((await rpc('load', {}, { token: null })).status, 401);
  assert.equal((await rpc('load', {}, { token: 'invalid-token' })).status, 401);
  assert.equal((await rpc('load', {}, { token: office.token })).status, 403);
  assert.equal((await rpc('load', {}, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await rpc('load', { pageId: 'careers' })).status, 403);
  const loaded = await liveClient().load(initial);
  assert.equal(loaded.content.hero.title, 'Existing Website Manager draft'); assert.match(loaded.seedToken, /^[a-f0-9]{64}$/);
  assert.equal(loaded.content.hero.primaryCta.href, initial.hero.primaryCta.href);
  assert.equal((await db.doc(PATHS.draft).get()).exists, false); assert.equal((await db.doc(PATHS.archive).get()).exists, false);
});
test('first save rejects stale import, archives atomically and leaves public data unchanged', async () => {
  const client = liveClient(), old = await client.load(initial), legacyRef = db.doc(`businessSettings/${C.PAGE.draftId}`);
  await legacyRef.update({ 'hero.title': 'Legacy edit after Load' });
  await assert.rejects(client.save([{ key: 'hero.title', value: 'Stale import' }], old.revision), /changed before import/);
  const reviewed = await client.load(initial); legacyBefore = (await legacyRef.get()).data();
  lastSaved = await client.save([{ key: 'hero.title', value: 'Persisted through the live HTTP client' }], reviewed.revision);
  assert.equal(lastSaved.revision, 1); assert.equal(lastSaved.seedToken, undefined);
  assert.equal((await db.doc(PATHS.draft).get()).data().hero.title, lastSaved.content.hero.title);
  assert.deepEqual((await db.doc(PATHS.archive).get()).data().content, legacyBefore);
  assert.deepEqual((await legacyRef.get()).data(), legacyBefore);
  assert.equal((await (await fetch(publicURL)).json()).hero.title, initial.hero.title);
});
test('fresh service/client recover cloud draft, publish with anonymous proof and restore draft only', async () => {
  service = createWebsiteContentService(adapters());
  const client = liveClient(), loaded = await client.load(initial);
  assert.equal(loaded.content.hero.title, lastSaved.content.hero.title);
  const requestId = randomUUID(), published = await client.publish(loaded.revision, requestId);
  assert.equal(published.publicationId, requestId);
  const visible = await (await fetch(publicURL)).json(); assert.equal(visible.publicationId, requestId); assert.equal(visible.hero.title, loaded.content.hero.title);
  assert.equal((await liveClient().publish(loaded.revision, requestId)).publicationId, requestId);
  assert((await client.history()).some((entry) => entry.id === requestId));
  const restored = await client.restore(requestId, loaded.revision); assert.equal(restored.content.hero.title, initial.hero.title);
  assert.equal((await (await fetch(publicURL)).json()).hero.title, loaded.content.hero.title);
});
test('unchanged production rules preserve ERP settings reads and deny direct private draft/lock/history access', async () => {
  for (const uid of [owner.uid, office.uid]) {
    const database = env.authenticatedContext(uid).firestore();
    await assertSucceeds(getDocs(collection(database, 'businessSettings')));
    await assertSucceeds(getDoc(doc(database, 'businessSettings/business-calendar')));
    for (const p of [PATHS.draft, PATHS.control, PATHS.archive, `${PATHS.releases}/forged`]) {
      await assertFails(getDoc(doc(database, p))); await assertFails(setDoc(doc(database, p), { forged: true }));
    }
  }
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), PATHS.draft)));
});
test('existing media rules allow owner upload/anonymous bytes, never office upload', async () => {
  const bytes = fs.readFileSync('apps/erp-next/public/website/vrf/indoor-cassette-approved.webp'), target = `public-website/vrf/editor/${randomUUID()}.webp`;
  await assertSucceeds(uploadBytes(ref(env.authenticatedContext(owner.uid).storage(), target), bytes, { contentType: 'image/webp' }));
  assert.deepEqual(Buffer.from(await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(), target)))), bytes);
  await assertFails(uploadBytes(ref(env.authenticatedContext(office.uid).storage(), `${target}-denied.webp`), bytes, { contentType: 'image/webp' }));
});
test('protected fields, stale versions, disabled writer and operational isolation stay enforced', async () => {
  const client = liveClient(), loaded = await client.load(initial);
  await assert.rejects(client.save([{ key: 'hero.primaryCta.href', value: '/bad' }], loaded.revision), /not editable/);
  await assert.rejects(client.save([{ key: 'hero.title', value: 'Stale' }], loaded.revision - 1), /changed/);
  await db.doc(PATHS.control).set({ disabled: true }, { merge: true });
  assert.equal((await rpc('save', { expectedRevision: loaded.revision, changes: [] })).status, 503);
  await db.doc(PATHS.control).set({ disabled: false }, { merge: true });
  for (const name of sentinelCollections) assert.deepEqual((await db.doc(`${name}/website-isolation-sentinel`).get()).data(), { preserved: true, domain: name });
  assert.deepEqual((await db.doc('businessSettings/business-calendar').get()).data(), { closedWeekdays: [0], preserved: true });
  assert.deepEqual((await db.doc(`businessSettings/${C.PAGE.draftId}`).get()).data(), legacyBefore);
});


test('a late legacy-tab edit blocks silent publication and reset archives the exact reviewed revision', async () => {
  const client = liveClient(), legacyRef = db.doc(`businessSettings/${C.PAGE.draftId}`);
  const beforePublic = await (await fetch(publicURL)).json();
  const beforePrivate = (await db.doc(PATHS.draft).get()).data();
  await legacyRef.update({ 'hero.title': 'Late legacy tab edit, preserved' });
  const loaded = await client.load(initial);
  assert.equal(loaded.legacyDraftChanged, true); assert.match(loaded.legacyConflictToken, /^[a-f0-9]{64}$/);
  await assert.rejects(client.save([{ key: 'hero.title', value: 'Must not override' }], loaded.revision), /older Website Manager/);
  await assert.rejects(client.publish(loaded.revision, randomUUID()), /older Website Manager/);
  assert.deepEqual((await db.doc(PATHS.draft).get()).data(), beforePrivate);
  assert.deepEqual(await (await fetch(publicURL)).json(), beforePublic);
  // A reset acknowledges only what was read. Concurrent legacy changes require
  // another explicit load; they cannot be silently marked as already reviewed.
  await client.load(initial);
  await legacyRef.update({ 'hero.title': 'Second late legacy edit, also preserved' });
  await assert.rejects(client.reset(loaded.revision), /changed again/);
  const reviewed = await client.load(initial), legacy = (await legacyRef.get()).data();
  const reset = await client.reset(reviewed.revision);
  assert.equal(reset.content.hero.title, beforePublic.hero.title);
  assert.equal(reset.publishedContent.hero.title, beforePublic.hero.title);
  assert.deepEqual((await legacyRef.get()).data(), legacy);
  const archivePath = PATHS.draft.replace(/\/draft$/, `/legacy-reviewed-${reviewed.legacyConflictToken}`);
  assert.deepEqual((await db.doc(archivePath).get()).data().content, legacy);
  assert.equal((await client.load(initial)).legacyDraftChanged, false);
  assert.deepEqual(await (await fetch(publicURL)).json(), beforePublic);
});
