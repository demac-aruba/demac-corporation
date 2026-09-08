'use strict';
// Pure cross-layer contract checks. No network, credentials or production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/careers-preview.ts');
const { recoverRevisedDraft } = require('../lib/careers-recovery.ts');
const C = require('../../../functions/careers/core');
const Contract = require('../../../functions/careers/form-contract');
const job = () => ({ ...F.exampleVacancies()[0], questions: [
  { id: 'date', label: 'Start date', kind: 'date', required: true },
  { id: 'url', label: 'Portfolio', kind: 'url', required: true },
  { id: 'yes', label: 'Specialist?', kind: 'yesno', required: true },
  { id: 'choice', label: 'Specialty', kind: 'multiselect', required: true, options: ['A', 'B'] },
] });
const draft = () => ({ ...F.emptyDraft(), givenName: 'Test', familyName: 'Candidate', email: 'test@example.test', phone: '2025550101', dialCode: '+1', nationality: 'AW', applyingFrom: 'AW', city: 'Test', totalExperience: '6', relevantExperience: '2', languages: ['English'], availability: 'Immediately', privacy: true, privacyVersion: 'v1', answers: { date: '2026-09-12', url: 'https://example.test/portfolio', yes: 'Yes', choice: ['A'] } });
const invalid = [
  ['nonexistent date', { answers: { date: '2026-02-30' } }, 1],
  ['unsafe URL scheme', { answers: { url: 'javascript:alert(1)' } }, 1],
  ['non URL', { answers: { url: 'not-a-url' } }, 1],
  ['wrong yes/no shape', { answers: { yes: ['Yes'] } }, 1],
  ['duplicate choices', { answers: { choice: ['A', 'A'] } }, 1],
  ['unknown choice', { answers: { choice: ['C'] } }, 1],
  ['unknown country', { nationality: 'ZZ' }, 0],
  ['country code without plus', { dialCode: '297' }, 0],
  ['long first name', { givenName: 'a'.repeat(81) }, 0],
  ['invalid email', { email: 'bad@example' }, 0],
  ['negative experience', { relevantExperience: '-1' }, 1],
  ['excess relevant years', { relevantExperience: '7' }, 1],
  ['duplicate languages', { languages: ['English', 'English'] }, 1],
  ['overlong optional answer', { answers: { url: 'https://example.test/' + 'a'.repeat(250) } }, 1],
];
for (const [name, patch, step] of invalid) test(`browser/server reject the same ${name}`, () => {
  const raw = { ...draft(), ...patch, answers: { ...draft().answers, ...(patch.answers || {}) } };
  assert.notEqual(Object.keys(F.validateStep(raw, job(), step)).length, 0);
  assert.throws(() => C.profile(raw, job(), { privacyVersion: 'v1' }));
});
test('all supported question kinds have one portable authority contract', () => {
  assert.deepEqual(C.KINDS, Contract.QUESTION_KINDS);
  assert.equal(F.validateStep(draft(), job(), 0).constructor, Object);
  assert.deepEqual(F.validateStep(draft(), job(), 0), {});
  assert.deepEqual(F.validateStep(draft(), job(), 1), {});
  assert.equal(C.profile(draft(), job(), { privacyVersion: 'v1' }).answers.date, '2026-09-12');
});
test('hidden conditional parents cannot activate their descendants', () => {
  const questions = [
    { id: 'parent', label: 'Parent', kind: 'yesno', required: true },
    { id: 'child', label: 'Child', kind: 'yesno', required: true, when: { questionId: 'parent', value: 'Yes' } },
    { id: 'nested', label: 'Nested', kind: 'text', required: true, when: { questionId: 'child', value: 'Yes' } },
  ];
  const answers = { parent: 'No', child: 'Yes', nested: 'Old hidden value' };
  assert.deepEqual(Contract.visibleQuestions(questions, answers).map(q => q.id), ['parent']);
  assert.deepEqual(Contract.validateAnswers(questions, answers), { value: { parent: 'No' }, errors: {} });
});
test('revising a position retains contact/files but does not reinterpret changed questions or consent', () => {
  const before = job(), after = { ...before, version: before.version + 1, questions: before.questions.map(q => q.id === 'date' ? { ...q, label: 'Certificate expiry date' } : q) };
  const photo = { name: 'test.jpg', dataUrl: 'data:image/jpeg;base64,dGVzdA==', size: 4 };
  const raw = { ...draft(), photo, futureTalent: true };
  const restored = recoverRevisedDraft(before, after, raw);
  assert.equal(restored.givenName, raw.givenName);
  assert.equal(restored.photo, photo);
  assert.equal(restored.documents, raw.documents);
  assert.equal(restored.answers.date, undefined);
  assert.equal(restored.answers.url, raw.answers.url);
  assert.equal(restored.privacy, false); assert.equal(restored.futureTalent, false);
});

// Design tokens must remain identical to the existing website, while layout and
// illustration selectors must never become ancestors of Careers application UI.
test('branded chrome uses existing public tokens without the full-page marketing wrapper', () => {
  const fs = require('node:fs'), path = require('node:path');
  const moduleCss = fs.readFileSync(path.join(__dirname, '../components/careers/careers.module.css'), 'utf8');
  const websiteCss = fs.readFileSync(path.join(__dirname, '../app/landing.css'), 'utf8');
  const extract = text => Object.fromEntries([...text.matchAll(/(--public-[a-z0-9-]+)\s*:\s*([^;]+);/g)].map(match => [match[1], match[2].trim()]));
  assert.deepEqual(extract(moduleCss.split('.brandChrome{')[1].split('}')[0]), extract(websiteCss.split('}')[0]));
  const chrome = fs.readFileSync(path.join(__dirname, '../components/careers/careers-chrome.tsx'), 'utf8');
  assert(!/className=.*public-site/.test(chrome));
  assert(!fs.existsSync(path.join(__dirname, '../components/careers/careers-control-compat.css')));
});
