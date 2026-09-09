'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
if (process.env.GCLOUD_PROJECT !== 'demo-demac-careers' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Only explicit local demo emulators are allowed.');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { createService, COLLECTIONS: N } = require('./service');
const { createInfrastructure } = require('./infrastructure');
const app = initializeApp({ projectId: 'demo-demac-careers' }, 'admin-preparation'), db = getFirestore(app);
const infrastructure = createInfrastructure({}, () => { throw Error('Admin preparation must not initialize SMTP.'); });
const files = new Proxy({}, { get() { return () => { throw Error('Admin preparation must not read or upload documents.'); }; } });
const service = createService({ db, files, infrastructure }), other = createService({ db, files, infrastructure });
const uid = 'qa-admin-preparation', id = () => crypto.randomUUID();
const vacancy = () => ({ title: 'QA draft technician', department: 'Technical', location: 'Aruba', contract: 'Test only', summary: 'Synthetic preparation test.', responsibilities: ['Test responsibility'], requirements: ['Test requirement'], status: 'Draft', cvRequired: true, questions: [{ id: 'experience', label: 'Relevant experience?', kind: 'textarea', required: true }], internalNotes: 'Internal test note' });
test.before(async () => {
  assert.equal((await db.collection(N.settings).doc('default').get()).exists, false, 'A fresh emulator is required.');
  await db.collection('users').doc(uid).set({ role: 'admin', active: true, name: 'QA Admin' });
  await db.collection('users').doc('qa-preparation-finance').set({ role: 'finance', active: true });
});
test.after(async () => { await db.terminate(); await deleteApp(app); });
test('admin can inspect setup blockers before sender, scanner or privacy are configured', async () => {
  const result = await service.getSettings(uid);
  assert.equal(result.settings, null); assert.equal(result.backend, 'firestore'); assert(result.blockers.length >= 4);
});
test('draft role and custom questions persist independently without any intake configuration', async () => {
  const key = id(), request = { id: key, requestId: id(), expectedVersion: 0, vacancy: vacancy() };
  const saved = await service.saveVacancy(uid, request);
  assert.equal(saved.version, 1);
  const read = await other.getVacancy(uid, key);
  assert.equal(read.title, request.vacancy.title); assert.equal(read.questions[0].kind, 'textarea'); assert.equal(read.status, 'Draft');
  assert.deepEqual(await other.saveVacancy(uid, request), saved);
});
test('inactive and non-admin identities cannot read drafts or create positions', async () => {
  await assert.rejects(service.list('qa-preparation-finance', 'jobs'), { status: 403 });
  await db.collection('users').doc(uid).update({ active: false });
  await assert.rejects(service.saveVacancy(uid, { id: id(), requestId: id(), expectedVersion: 0, vacancy: vacancy() }), { status: 403 });
  await db.collection('users').doc(uid).update({ active: true });
});
test('opening a vacancy still requires verified live setup and fails without changing the draft', async () => {
  const key = id(); await service.saveVacancy(uid, { id: key, requestId: id(), expectedVersion: 0, vacancy: vacancy() });
  await assert.rejects(service.saveVacancy(uid, { id: key, requestId: id(), expectedVersion: 1, vacancy: { ...vacancy(), status: 'Open' } }), { code: 'setup-required' });
  assert.equal((await other.getVacancy(uid, key)).status, 'Draft');
});
test('public jobs stay unavailable and preparation does not generate applicants, mail or operations records', async () => {
  assert.deepEqual(await service.publicJobs(), { jobs: [], available: false });
  for (const collection of [N.applications, N.sessions, N.mail, 'appointments', 'staffProfiles', 'customers']) {
    assert.equal((await db.collection(collection).limit(1).get()).size, 0);
  }
});
