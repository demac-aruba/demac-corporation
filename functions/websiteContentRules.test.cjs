'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createRequire } = require('node:module');
const requireTest = createRequire('/tmp/editor-rules/package.json');
const { initializeTestEnvironment, assertSucceeds, assertFails } = requireTest('@firebase/rules-unit-testing');
const { doc, setDoc, getDoc, deleteDoc, getDocs, collection } = requireTest('firebase/firestore');
const { ref, uploadBytes, getBytes, deleteObject } = requireTest('firebase/storage');
const projectId = 'demo-demac-website';
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '')) throw Error('Only local demo emulators may run these tests.');
const config = JSON.parse(readFileSync(resolve('website-editor.emulator.json'), 'utf8'));
assert.equal(config.firestore.rules, 'functions/website-editor-review/firestore.rules');
assert.equal(config.storage.rules, 'functions/website-editor-review/storage.rules');
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: readFileSync(resolve(config.firestore.rules), 'utf8'), host: '127.0.0.1', port: 8187 }, storage: { rules: readFileSync(resolve(config.storage.rules), 'utf8'), host: '127.0.0.1', port: 9297 } });
  await env.withSecurityRulesDisabled(async (context) => {
    for (const [id, role, active] of [['owner','admin',true],['office','office',true],['supervisor','supervisor',true],['inactive','admin',false],['tech','technician',true]]) await setDoc(doc(context.firestore(), `users/${id}`), { role, active });
    await setDoc(doc(context.firestore(), 'businessSettings/publicVrfPageDraft'), { title: 'Private draft' });
    await setDoc(doc(context.firestore(), 'businessSettings/publicVrfPagePublished'), { title: 'Audit projection' });
    await setDoc(doc(context.firestore(), 'businessSettings/website-editor'), { backendEnabled: false });
    await setDoc(doc(context.firestore(), 'businessSettings/business-calendar'), { closedWeekdays: [0], source: 'canonical' });
    await uploadBytes(ref(context.storage(), 'public-website/vrf/published.json'), Buffer.from('{"version":1}'), { contentType: 'application/json' });
  });
});
after(async () => { await env?.cleanup(); });
async function gate(enabled) { await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'businessSettings/website-editor'), { backendEnabled: enabled })); }
test('private VRF drafts and receipts are owner-only; activation is never client-writable', async () => {
  await assertSucceeds(getDoc(doc(env.authenticatedContext('owner').firestore(), 'businessSettings/publicVrfPageDraft')));
  for (const id of ['office','supervisor','inactive','tech']) await assertFails(getDoc(doc(env.authenticatedContext(id).firestore(), 'businessSettings/publicVrfPageDraft')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'businessSettings/publicVrfPageDraft')));
  await assertFails(setDoc(doc(env.authenticatedContext('owner').firestore(), 'businessSettings/website-editor'), { backendEnabled: true }));
  await assertFails(setDoc(doc(env.authenticatedContext('owner').firestore(), 'businessSettings/publicVrfPagePublished/editorReleases/forged'), { status: 'published' }));
});
test('legacy owner writer works before activation; active service is sole write path', async () => {
  await gate(false);
  const owner = env.authenticatedContext('owner');
  await assertSucceeds(setDoc(doc(owner.firestore(), 'businessSettings/publicVrfPageDraft'), { title: 'Legacy owner draft' }));
  await assertSucceeds(uploadBytes(ref(owner.storage(), 'public-website/vrf/published.json'), Buffer.from('{"version":2}'), { contentType: 'application/json' }));
  await gate(true);
  await assertFails(setDoc(doc(owner.firestore(), 'businessSettings/publicVrfPageDraft'), { title: 'Bypass' }));
  await assertFails(setDoc(doc(owner.firestore(), 'businessSettings/publicVrfPagePublished'), { title: 'Bypass' }));
  await assertFails(uploadBytes(ref(owner.storage(), 'public-website/vrf/published.json'), Buffer.from('{"version":3}'), { contentType: 'application/json' }));
  await assertFails(deleteObject(ref(owner.storage(), 'public-website/vrf/published.json')));
  await assertFails(deleteDoc(doc(owner.firestore(), 'businessSettings/publicVrfPageDraft')));
  const bytes = await assertSucceeds(getBytes(ref(env.unauthenticatedContext().storage(), 'public-website/vrf/published.json')));
  assert(Buffer.from(bytes).toString().includes('2'), 'Public version remains readable and unchanged');
});
test('recursive media rule cannot recreate protected JSON as an image or delete it', async () => {
  await gate(true);
  await env.withSecurityRulesDisabled((context) => deleteObject(ref(context.storage(), 'public-website/vrf/published.json')));
  const owner = env.authenticatedContext('owner');
  await assertFails(uploadBytes(ref(owner.storage(), 'public-website/vrf/published.json'), Buffer.from('fake'), { contentType: 'image/png' }));
});
test('other business settings, homepage publishing and owner image uploads retain their existing boundaries', async () => {
  const office = env.authenticatedContext('office'), owner = env.authenticatedContext('owner');
  await assertSucceeds(setDoc(doc(office.firestore(), 'businessSettings/editor-regression-fixture'), { test: true }));
  await assertSucceeds(uploadBytes(ref(owner.storage(), 'public-website/config/published.json'), Buffer.from('{}'), { contentType: 'application/json' }));
  await assertSucceeds(uploadBytes(ref(owner.storage(), 'public-website/vrf/editor/review.png'), Buffer.from([137,80,78,71]), { contentType: 'image/png' }));
  await assertFails(uploadBytes(ref(office.storage(), 'public-website/vrf/editor/denied.png'), Buffer.from([137,80,78,71]), { contentType: 'image/png' }));
  await assertFails(setDoc(doc(owner.firestore(), 'businessSettings/publicVrfPagePublished/editorReleases/forged-again'), { status: 'published' }));
});
test('candidate rules require scoped calendar reads before production activation', async () => {
  for (const id of ['office', 'tech', 'supervisor']) {
    const db = env.authenticatedContext(id).firestore();
    const snapshot = await assertSucceeds(getDoc(doc(db, 'businessSettings/business-calendar')));
    assert.deepEqual(snapshot.data().closedWeekdays, [0]);
    await assertFails(getDocs(collection(db, 'businessSettings')));
    await assertFails(getDoc(doc(db, 'businessSettings/publicVrfPageDraft')));
  }
});
test('appointment presets retain their existing source-owned admin-only write gate', async () => {
  const owner = env.authenticatedContext('owner').firestore();
  const office = env.authenticatedContext('office').firestore();
  await assertSucceeds(setDoc(doc(owner, 'businessSettings/appointment-work-presets'), { presets: [] }));
  await assertSucceeds(getDoc(doc(office, 'businessSettings/appointment-work-presets')));
  await assertFails(setDoc(doc(office, 'businessSettings/appointment-work-presets'), { presets: ['unauthorized'] }));
});
