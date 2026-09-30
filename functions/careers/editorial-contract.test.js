'use strict';
// Pure contracts and transaction fault checks. Never call a provider or production.
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./editorial-contract');
const C = require('./core');
const { createService, COLLECTIONS: N } = require('./service');
const { transactionStore } = require('./test-support/transaction-store');
const job = () => ({ title: 'QA Technician', department: 'Technical', location: 'Aruba', contract: 'Full-time',
  summary: 'Synthetic editorial test.', responsibilities: ['Inspect units.'], requirements: ['Work safely.'], desired: [],
  status: 'Draft', cvRequired: true, questions: [
    { id: 'systems', label: 'Which systems?', help: 'Choose all that apply.', kind: 'multiselect', required: true, options: ['Split', 'VRF'] },
    { id: 'yes', label: 'Have you installed units?', kind: 'yesno', required: true },
    { id: 'detail', label: 'Describe your work.', kind: 'textarea', required: true, when: { questionId: 'yes', value: 'Yes' } },
  ] });
const translated = () => ({ ...E.emptyTranslation(job()), status: 'Approved', title: 'Técnico QA', department: 'Técnica', location: 'Aruba', contract: 'Tiempo completo',
  summary: 'Prueba editorial sintética.', responsibilities: ['Inspeccionar equipos.'], requirements: ['Trabajar de forma segura.'],
  questions: [
    { id: 'systems', label: '¿Con cuáles equipos?', help: 'Selecciona todos los que correspondan.', optionLabels: { Split: 'Unidad split', VRF: 'Sistema VRF' } },
    { id: 'yes', label: '¿Has instalado equipos?', help: '', optionLabels: { Yes: 'Sí', No: 'No' } },
    { id: 'detail', label: 'Describe tu trabajo.', help: '', optionLabels: {} },
  ] });
const bilingual = () => ({ ...job(), editorialVersion: 1, translations: { es: translated() } });
function harness({ configured = false } = {}) {
  const store = transactionStore();
  store.rows.set('users/qa-admin', { role: 'admin', active: true, name: 'QA' });
  const infrastructure = { signature: () => 'test', blockers: () => configured ? [] : ['Configure test services.'] };
  if (configured) store.rows.set(`${N.settings}/default`, { intakeEnabled: true, privacyText: 'Test notice', privacyVersion: 'v1', retentionDays: 7, verification: { signature: 'test' } });
  const service = createService({ db: store.db, files: {}, infrastructure, now: () => 1000 });
  const save = (vacancy, expectedVersion = 0, requestId = `save-${expectedVersion}`) => service.saveVacancy('qa-admin', { id: 'qa-vacancy', vacancy, expectedVersion, requestId });
  return { store, service, save, read: () => store.rows.get(`${N.jobs}/qa-vacancy`) };
}
module.exports = { job, translated, bilingual };

test('legacy vacancies remain English-only without requiring any migration', () => {
  assert.deepEqual(E.availableLocales(job()), ['en']);
  const publicJob = C.publicVacancy({ ...C.vacancy(job()), id: 'qa-job', version: 1, internalNotes: 'PRIVATE' });
  assert.equal(publicJob.editorialVersion, 1); assert.deepEqual(publicJob.translations, {});
  assert.equal(publicJob.internalNotes, undefined);
});
test('complete reviewed Spanish publishes labels, not a second vacancy or answer schema', () => {
  const j = bilingual(), original = structuredClone(j);
  assert.deepEqual(E.availableLocales(j), ['en', 'es']); assert.deepEqual(E.translationIssues(j), []);
  const output = C.publicVacancy({ ...j, id: 'single-job', version: 6 });
  assert.equal(output.id, 'single-job'); assert.equal(output.title, j.title);
  assert.deepEqual(output.questions, j.questions); assert.equal(output.translations.es.questions[1].optionLabels.Yes, 'Sí');
  assert.deepEqual(j, original);
});
test('public translation whitelist excludes internal notes and injected content', () => {
  const j = bilingual(); j.translations.es.internalNotes = 'PRIVATE'; j.translations.es.questions[0].scoring = 'PRIVATE';
  assert(!JSON.stringify(E.publicTranslations(j)).includes('PRIVATE'));
  assert.equal(C.vacancy({ ...job(), translations: { es: translated() } }).translations.es.title, 'Técnico QA');
});
test('a blank Spanish draft is parseable but is never exposed as translated content', () => {
  const draft = E.emptyTranslation(job());
  assert.equal(E.parseTranslations({ es: draft }).es.status, 'Draft');
  assert(E.translationIssues({ ...job(), translations: { es: draft } }).length > 5);
  assert.deepEqual(E.publicTranslations({ ...job(), translations: { es: draft } }), {});
});
for (const [name, patch] of [
  ['unreviewed', t => ({ ...t, status: 'Draft' })],
  ['stale revision', t => ({ ...t, sourceVersion: 9 })],
  ['empty title', t => ({ ...t, title: '' })],
  ['missing responsibility', t => ({ ...t, responsibilities: [] })],
  ['blank responsibility', t => ({ ...t, responsibilities: [''] })],
  ['removed question', t => ({ ...t, questions: t.questions.slice(1) })],
  ['stale question', t => ({ ...t, questions: [...t.questions, { id: 'old', label: 'Vieja', optionLabels: {} }] })],
  ['missing help', t => ({ ...t, questions: t.questions.map(q => ({ ...q, help: '' })) })],
  ['translated keys', t => ({ ...t, questions: t.questions.map(q => q.id === 'yes' ? { ...q, optionLabels: { Sí: 'Sí', No: 'No' } } : q) })],
  ['stale option', t => ({ ...t, questions: t.questions.map(q => q.id === 'yes' ? { ...q, optionLabels: { ...q.optionLabels, Old: 'Anterior' } } : q) })],
]) test(`${name} cannot be advertised as an available Spanish version`, () => {
  const j = { ...bilingual(), translations: { es: patch(translated()) } };
  assert(E.translationIssues(j).length); assert.deepEqual(E.availableLocales(j), ['en']); assert.deepEqual(E.publicTranslations(j), {});
});
for (const [name, change] of [
  ['title', j => ({ ...j, title: 'Changed English title' })],
  ['help', j => ({ ...j, questions: j.questions.map(q => ({ ...q, help: 'Changed help' })) })],
  ['question order', j => ({ ...j, questions: [...j.questions].reverse() })],
  ['option key', j => ({ ...j, questions: j.questions.map(q => q.id === 'systems' ? { ...q, options: ['Split', 'Other'] } : q) })],
  ['required', j => ({ ...j, questions: j.questions.map(q => ({ ...q, required: false })) })],
  ['condition', j => ({ ...j, questions: j.questions.map(q => q.when ? { ...q, when: { questionId: 'yes', value: 'No' } } : q) })],
  ['CV policy', j => ({ ...j, cvRequired: false })],
]) test(`a changed English ${name} invalidates the previous Spanish review`, () => {
  const before = bilingual(), next = E.reconcileEditorial(change(before), before);
  assert.equal(next.editorialVersion, 2); assert.equal(next.translations.es.sourceVersion, 1); assert.deepEqual(E.availableLocales(next), ['en']);
});
test('Spanish labels, status, dates, openings and internal notes do not revise the English source', () => {
  const previous = bilingual();
  const next = { ...previous, status: 'Paused', publishFrom: '2026-10-01', openings: 3, internalNotes: 'Changed', translations: { es: { ...translated(), title: 'Otro título' } } };
  assert.equal(E.nextEditorialVersion(next, previous), 1);
  assert.equal(E.nextEditorialVersion({ ...job(), editorialVersion: 999 }), 1);
  assert.equal(E.reconcileEditorial({ ...next, editorialVersion: 999 }, previous).editorialVersion, 1);
});
test('legacy clients preserve translations when omitting the extension; an explicit empty object removes it', () => {
  assert.deepEqual(E.reconcileEditorial(job(), bilingual()).translations, bilingual().translations);
  assert.deepEqual(E.reconcileEditorial({ ...job(), translations: {} }, bilingual()).translations, {});
});
test('aligning is explicit, retains matching labels and does not mutate old snapshots', () => {
  const old = translated(), saved = structuredClone(old), current = job();
  current.questions = [current.questions[0], { id: 'new', label: 'New question', kind: 'text', required: true }];
  current.questions[0].options = ['Split', 'New']; current.editorialVersion = 2;
  const result = E.alignTranslation(current, old);
  assert.deepEqual(result.questions.map(q => q.id), ['systems', 'new']);
  assert.deepEqual(result.questions[0].optionLabels, { Split: 'Unidad split', New: '' });
  assert.equal(result.status, 'Draft'); assert.equal(result.sourceVersion, 2); assert.deepEqual(old, saved);
});
for (const value of [null, [], { fr: {} }, { es: { ...translated(), sourceVersion: 0 } }, { es: { ...translated(), summary: 'x'.repeat(1501) } }, { es: { ...translated(), title: '\u0000' } }, { es: { ...translated(), questions: [translated().questions[0], translated().questions[0]] } }, { es: { ...translated(), questions: [{ id: '__proto__', label: 'Bad', optionLabels: {} }] } }]) {
  test(`reject malformed translation ${JSON.stringify(value).slice(0, 90)}`, () => assert.throws(() => E.parseTranslations(value), { code: 'invalid-translation', status: 400 }));
}
test('English question help is retained and bounded by the canonical validator', () => {
  assert.equal(C.vacancy(job()).questions[0].help, job().questions[0].help);
  assert.throws(() => C.vacancy({ ...job(), questions: [{ ...job().questions[0], help: 'x'.repeat(601) }] }));
});
test('drafts and incomplete Spanish persist without SMTP or antivirus configuration', async () => {
  const h = harness(); await h.save({ ...job(), editorialVersion: 999, translations: { es: E.emptyTranslation(job()) } });
  assert.equal(h.read().editorialVersion, 1); assert.equal(h.read().translations.es.status, 'Draft');
  assert.equal([...h.store.rows.keys()].filter(k => k.startsWith(`${N.mail}/`) || k.startsWith(`${N.applications}/`)).length, 0);
});
test('blocked publication is atomic and an explicit draft retry preserves all translation text', async () => {
  const h = harness(); await h.save(bilingual()); const before = structuredClone(h.read());
  await assert.rejects(h.save({ ...before, status: 'Open' }, 1, 'blocked'), { code: 'setup-required' });
  assert.deepEqual(h.read(), before);
  await h.save({ ...before, title: 'New English title', status: 'Draft' }, 1, 'draft-again');
  assert.equal(h.read().translations.es.title, translated().title); assert.equal(h.read().editorialVersion, 2);
});
test('stale approved Spanish blocks Open even with configured services, but does not block Draft', async () => {
  const h = harness({ configured: true }); await h.save(bilingual());
  await assert.rejects(h.save({ ...h.read(), title: 'New title', status: 'Open' }, 1), { code: 'translation-review-required' });
  assert.equal(h.read().version, 1);
  await h.save({ ...h.read(), title: 'New title', status: 'Draft' }, 1);
  const next = h.read(); await h.save({ ...next, status: 'Open', translations: { es: { ...next.translations.es, sourceVersion: 2, status: 'Approved' } } }, 2);
  assert.equal(h.read().status, 'Open'); assert.deepEqual(E.availableLocales(h.read()), ['en', 'es']);
});
test('an English-only Open vacancy can retain unfinished Spanish without publishing it', async () => {
  const h = harness({ configured: true }); await h.save({ ...job(), status: 'Open', translations: { es: E.emptyTranslation(job()) } });
  assert.equal(h.read().status, 'Open'); assert.deepEqual(C.publicVacancy(h.read()).translations, {});
});
test('optimistic concurrency and exact retry include translation changes', async () => {
  const h = harness(); const request = bilingual(); const saved = await h.save(request);
  assert.deepEqual(await h.save(request), saved);
  await assert.rejects(h.save({ ...request, translations: { es: { ...translated(), title: 'Changed' } } }), { code: 'idempotency-conflict' });
  await assert.rejects(h.save(request, 0, 'other-request'), { code: 'version-conflict' });
  assert.equal(h.read().version, 1);
});
test('editorial metadata does not create a permission bypass', async () => {
  const h = harness(); await h.save(bilingual());
  for (const identity of [{ active: false, role: 'admin' }, { active: true, role: 'finance' }]) {
    h.store.rows.set('users/qa-admin', identity);
    await assert.rejects(h.save(bilingual(), 1), { status: 403 });
    assert.equal(h.read().version, 1);
  }
});
