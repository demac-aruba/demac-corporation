'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/careers-preview.ts');
const Q = require('../lib/careers-form-flow.ts');
const vacancy = () => ({ ...F.exampleVacancies()[0], questions: [
  { id: 'installed', label: 'Installed systems?', kind: 'multiselect', options: ['Split', 'VRF'], required: true },
  { id: 'years', label: 'Years?', kind: 'number', required: true },
  { id: 'parent', label: 'Specialist?', kind: 'yesno', required: true },
  { id: 'child', label: 'Describe specialist work.', kind: 'textarea', required: true, when: { questionId: 'parent', value: 'Yes' } },
] });
const valid = () => ({ ...F.emptyDraft(), givenName: 'Synthetic', familyName: 'Test', email: 'example@example.test', phone: '2025550101', dialCode: '+1', nationality: 'AW', applyingFrom: 'AW', city: 'Test city', totalExperience: '8', relevantExperience: '5', languages: ['English', 'Spanish'], availability: 'Immediately', photo: { dataUrl: 'data:image/jpeg;base64,AA==', name: 'test.jpg', size: 1 }, cv: new File(['%PDF synthetic'], 'test.pdf'), answers: { installed: ['Split'], years: '3.5', parent: 'Yes', child: 'Original español\nMixed English answer.' } });
function normalize(job, draft, target) { return Q.normalizeFormTarget(Q.formScreens(job, draft), target, F.validateApplication(draft, job)); }

test('one descriptor per conceptual question and two explicit summary exceptions', () => {
  const plan = Q.formScreens(vacancy(), valid());
  assert.equal(new Set(plan.map(screen => screen.id)).size, plan.length);
  assert.equal(plan.filter(screen => screen.kind === 'documents').length, 1);
  assert.equal(plan.filter(screen => screen.kind === 'review').length, 1);
  assert.deepEqual(plan.find(screen => screen.id === 'profile:phone').errorKeys, ['dialCode', 'phone']);
  assert.notEqual(plan.findIndex(screen => screen.id === 'role:years'), plan.findIndex(screen => screen.id === 'profile:availability'));
  assert.equal(plan.find(screen => screen.id === 'role:years').question.kind, 'number');
});
test('namespacing keeps a job question distinct from a standard profile question', () => {
  const job = vacancy(); job.questions.push({ id: 'email', label: 'A different question', kind: 'text', required: false });
  const ids = Q.formScreens(job, valid()).map(screen => screen.id);
  assert(ids.includes('profile:email')); assert(ids.includes('role:email'));
});
test('stable question URL follows its ID after reorder, not its previous array index', () => {
  const job = vacancy(), draft = valid();
  const before = normalize(job, draft, { question: 'role:years' });
  job.questions = [job.questions[1], job.questions[0], ...job.questions.slice(2)];
  assert.deepEqual(normalize(job, draft, { question: 'role:years' }), before);
});
test('legacy stage URL still resolves but cannot skip a required question', () => {
  assert.equal(normalize(vacancy(), F.emptyDraft(), { step: 2, reviewing: true }).question, 'profile:givenName');
  assert.equal(normalize(vacancy(), valid(), { step: 1 }).question, 'profile:totalExperience');
});
test('a deep link is redirected to the first earlier invalid question', () => {
  const draft = valid(); draft.email = 'invalid';
  assert.equal(normalize(vacancy(), draft, { question: 'role:years' }).question, 'profile:email');
});
test('invalid question ID recovers to first pending, then review if everything is valid', () => {
  const draft = valid(); draft.answers.years = '-1';
  assert.equal(normalize(vacancy(), draft, { question: 'missing' }).question, 'role:years');
  draft.answers.years = '0';
  assert.equal(normalize(vacancy(), draft, { question: 'missing' }).question, 'review');
});
test('review remains accessible to read and accept consent before submission', () => {
  const draft = valid(); assert.equal(draft.privacy, false);
  assert.equal(normalize(vacancy(), draft, { reviewing: true }).question, 'review');
  assert(F.validateApplication(draft, vacancy(), true).privacy);
});
test('review edits return directly to review instead of walking through every question', () => {
  const draft = valid(), plan = Q.formScreens(vacancy(), draft);
  const edited = plan.find(screen => screen.id === 'role:years');
  const target = normalize(vacancy(), draft, { ...Q.targetFor(edited, true) });
  assert.equal(target.returnToReview, true);
  assert.equal(Q.previousFormTarget(plan, edited, true).question, 'review');
});
test('editing total years revalidates dependent relevant years without changing the answer', () => {
  const draft = valid(); draft.totalExperience = '2';
  assert.equal(normalize(vacancy(), draft, { reviewing: true }).question, 'profile:relevantExperience');
  assert.equal(draft.relevantExperience, '5');
});
test('conditional questions change actual counts; hidden values are not submitted', () => {
  const job = vacancy(), draft = valid(), plan = Q.formScreens(job, draft);
  const before = Q.questionProgress(plan, plan.find(screen => screen.id === 'role:years'));
  draft.answers.parent = 'No';
  const after = Q.formScreens(job, draft);
  assert.equal(after.some(screen => screen.id === 'role:child'), false);
  assert.equal(Q.questionProgress(after, after.find(screen => screen.id === 'role:years')).total, before.total - 1);
  assert.equal(F.copyForSubmission(draft, job).answers.child, undefined);
  assert.equal(draft.answers.child, 'Original español\nMixed English answer.');
});
test('residence is one separate conditional question, never inferred from nationality', () => {
  const job = vacancy(), draft = valid();
  assert.equal(Q.formScreens(job, draft).some(screen => screen.field === 'residence'), false);
  draft.sameResidence = false;
  assert.equal(Q.formScreens(job, draft).filter(screen => screen.field === 'residence').length, 1);
  assert.equal(normalize(job, draft, { reviewing: true }).question, 'profile:residence');
});
test('navigating or reading progress does not mutate draft, files, original text or options', () => {
  const job = vacancy(), draft = valid(), original = JSON.stringify(draft), cv = draft.cv;
  const plan = Q.formScreens(job, draft);
  for (const screen of plan) {
    Q.targetFor(screen); Q.previousFormTarget(plan, screen); Q.questionProgress(plan, screen);
    normalize(job, draft, Q.targetFor(screen));
  }
  assert.equal(JSON.stringify(draft), original); assert.equal(draft.cv, cv);
  assert.deepEqual(draft.answers.installed, ['Split']);
});
test('route target carries only structural IDs and no candidate data', () => {
  const draft = valid(), plan = Q.formScreens(vacancy(), draft);
  const text = JSON.stringify(plan.map(screen => Q.targetFor(screen)));
  for (const value of [draft.email, draft.phone, draft.answers.child, 'data:image', 'test.pdf']) assert(!text.includes(value));
});
test('selected documents are still required and total size cannot bypass the flow', () => {
  const draft = valid(); draft.photo = null;
  assert.equal(normalize(vacancy(), draft, { reviewing: true }).question, 'documents');
  draft.photo = { dataUrl: 'data:image/jpeg;base64,AA==', name: 'test.jpg', size: 31 * 1024 * 1024 };
  assert(F.validateApplication(draft, vacancy()).cv);
  assert.equal(normalize(vacancy(), draft, { reviewing: true }).question, 'documents');
});
test('zero years and multiline original answers retain their actual input type and value', () => {
  const draft = valid(); draft.answers.years = '0';
  const job = vacancy(), plan = Q.formScreens(job, draft);
  assert.deepEqual(Q.screenErrors(plan.find(screen => screen.id === 'role:years'), F.validateApplication(draft, job)), {});
  assert.equal(F.copyForSubmission(draft, job).answers.child, draft.answers.child);
});
