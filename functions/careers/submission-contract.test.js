'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./submission-contract');
const C = require('./core');
const { createService, COLLECTIONS: N } = require('./service');
const { transactionStore } = require('./test-support/transaction-store');
const policy = { text: 'Synthetic original policy.\nNot a production policy.', version: 'qa-v1' };
function job() {
  const questions = [
    { id: 'skills', label: 'Installed systems?', kind: 'multiselect', required: true, options: ['Split', 'VRF'] },
    { id: 'licensed', label: 'Qualified?', kind: 'yesno', required: true },
    { id: 'project', label: 'Describe your work.', help: 'Use your own words.', kind: 'textarea', required: false },
    { id: 'hidden', label: 'Hidden follow-up', kind: 'text', required: false, when: { questionId: 'licensed', value: 'No' } },
    { id: 'date', label: 'Date?', kind: 'date', required: true },
  ];
  const base = { id: 'qa-job', version: 1, editorialVersion: 1, status: 'Open', title: 'QA Technician',
    department: 'Technical', location: 'Aruba', contract: 'Test only', summary: 'Synthetic vacancy.',
    responsibilities: ['Test safely.'], requirements: ['Test only.'], desired: [], cvRequired: true, photoRequired: true, questions, internalNotes: 'SECRET INTERNAL NOTE' };
  base.translations = { es: { status: 'Approved', sourceVersion: 1, title: 'Técnico de prueba', department: 'Técnica',
    location: 'Aruba', contract: 'Solo prueba', summary: 'Puesto sintético.', responsibilities: ['Probar con seguridad.'],
    requirements: ['Solo pruebas.'], desired: [], questions: questions.map(q => ({ id: q.id,
      label: `ES ${q.label}`, help: q.help ? 'Usa tus propias palabras.' : '', optionLabels: Object.fromEntries((q.options || (q.kind === 'yesno' ? ['Yes','No'] : [])).map(v => [v, `ES ${v}`])) })) } };
  return base;
}
function rawProfile() {
  return { givenName: '  María  ', familyName: ' Test Candidate ', email: ' QA@EXAMPLE.TEST ', dialCode: '+297',
    phone: '564-0000', whatsapp: true, nationality: 'CO', applyingFrom: 'AW', sameResidence: true, residence: 'AW',
    city: '  Santa Cruz ', totalExperience: '06.0', relevantExperience: '3', languages: ['Spanish','English'],
    availability: 'Within 2 weeks', privacy: true, privacyVersion: policy.version, futureTalent: false, noCv: false,
    answers: { skills: ['VRF','Split'], licensed: 'Yes', project: '  Trabajé con equipos.\nI also repaired VRF.  <b>not HTML</b>  ',
      hidden: 'MUST NOT BE SAVED', date: '2026-10-01', unknown: 'UNCONFIGURED' }, administrativeNote: 'NOT ALLOWED' };
}
function snapshot(j = job(), raw = rawProfile(), locale = 'es', version = S.PRESENTATION_VERSION) {
  return S.createSubmissionSnapshot(j, raw, C.profile(raw, j, { privacyVersion: policy.version }), locale, version, policy);
}
test('snapshot preserves exact mixed original values and canonical profile remains compatible', () => {
  const raw = rawProfile(), j = job(), canonical = C.profile(raw, j, {privacyVersion:policy.version}), result = snapshot(j, raw);
  assert.equal(canonical.givenName, 'María'); assert.equal(canonical.email, 'qa@example.test');
  assert.equal(result.fields.find(f => f.id === 'profile:givenName').value, raw.givenName);
  assert.equal(result.fields.find(f => f.id === 'profile:email').value, raw.email);
  assert.equal(result.fields.find(f => f.id === 'profile:totalExperience').value, '06.0');
  assert.equal(result.questions.find(q => q.questionId === 'project').value, raw.answers.project);
  assert.equal(result.questions.find(q => q.questionId === 'project').help, 'Usa tus propias palabras.');
  assert.equal(S.submittedAnswerText(result.questions.find(q => q.questionId === 'project')), raw.answers.project);
  assert.deepEqual(result.fields.find(f => f.id === 'profile:phone').value, ['+297','564-0000']);
});
test('stable IDs, order and translated labels are frozen without translating option values', () => {
  const result = snapshot();
  assert.equal(result.localeAtSubmit, 'es'); assert.equal(result.contentLocale, 'es');
  assert.equal(result.title, 'Técnico de prueba'); assert.equal(result.fields[0].label, '¿Cuál es tu nombre?');
  assert.deepEqual(result.questions[0].value, ['VRF','Split']);
  assert.equal(S.submittedAnswerText(result.questions[0]), 'ES VRF, ES Split');
  assert.equal(S.submittedAnswerText(result.fields.find(f => f.id === 'profile:whatsapp')), 'Sí');
  assert.equal(S.submittedAnswerText(result.fields.find(f => f.id === 'profile:languages')), 'Español, Inglés');
  assert.equal(S.submittedAnswerText(result.fields.find(f => f.id === 'profile:availability')), 'Dentro de 2 semanas');
});
test('snapshot excludes hidden/unconfigured answers and administrative fields', () => {
  const serialized = JSON.stringify(snapshot());
  for (const secret of ['MUST NOT BE SAVED','UNCONFIGURED','NOT ALLOWED','SECRET INTERNAL NOTE']) assert(!serialized.includes(secret));
  assert(!snapshot().fields.some(f => f.id === 'profile:residence'), 'dependent standard question was not shown');
  const raw = rawProfile(); raw.sameResidence = false; raw.residence = 'CW';
  assert.equal(snapshot(job(), raw).fields.find(f => f.id === 'profile:residence').value, 'CW');
});
for (const state of ['missing','draft','stale','incomplete']) test(`English-only fallback is explicit for ${state} Spanish`, () => {
  const j = job();
  if (state === 'missing') delete j.translations;
  if (state === 'draft') j.translations.es.status = 'Draft';
  if (state === 'stale') j.translations.es.sourceVersion = 2;
  if (state === 'incomplete') j.translations.es.questions[0].label = '';
  const result = snapshot(j);
  assert.equal(result.localeAtSubmit,'es'); assert.equal(result.contentLocale,'en');
  assert.equal(result.questions[0].label,'Installed systems?'); assert.equal(result.title,'QA Technician');
  assert.equal(result.fields[0].label,'¿Cuál es tu nombre?');
});
test('snapshot does not reference mutable job, arrays or candidate data', () => {
  const j = job(), raw = rawProfile(), result = snapshot(j, raw), before = JSON.stringify(result);
  j.translations.es.title = 'Changed'; j.translations.es.questions[0].optionLabels.VRF = 'Changed';
  raw.answers.skills.push('bad'); raw.languages.push('Other'); raw.answers.project = 'Changed';
  assert.equal(JSON.stringify(result), before);
  assert.equal(result.privacy.contentLocale, null); assert.equal(result.privacy.text, policy.text);
  assert.equal(result.privacy.futureTalent, false);
});
test('unsupported locale and stale client presentation reject rather than guessing', () => {
  for (const locale of [null, undefined, 'nl', {}, 'ES', 'es-VE']) {
    assert.throws(() => S.createSubmissionSnapshot(job(),rawProfile(),{},locale,S.PRESENTATION_VERSION,policy), {code:'invalid-input'});
  }
  assert.throws(() => snapshot(job(),rawProfile(),'es','old-version'), {code:'presentation-version'});
});
test('oversized original whitespace is rejected even if canonical trim passed', () => {
  const raw = rawProfile(); raw.answers.project = ' '.repeat(1200) + 'x';
  assert.equal(C.profile(raw,job(),{privacyVersion:policy.version}).answers.project,'x');
  assert.throws(() => snapshot(job(),raw), {code:'invalid-input'});
});
test('optional blank answer is retained without inventing an answer or language', () => {
  const raw = rawProfile(); raw.answers.project = ' \n ';
  const q = snapshot(job(),raw).questions.find(q => q.questionId === 'project');
  assert.equal(S.submittedAnswerText(q), ' \n ');
  delete raw.answers.project;
  assert.equal(snapshot(job(),raw).questions.find(q => q.questionId === 'project').value, null);
});
function setup() {
  const store = transactionStore(), j = job(), token = 'a'.repeat(64), sessionId = 'qa-session';
  store.rows.set(`${N.jobs}/${j.id}`,j);
  store.rows.set('users/qa-admin',{active:true,role:'admin'});
  store.rows.set(`${N.settings}/default`,{intakeEnabled:true,privacyText:policy.text,privacyVersion:policy.version,
    retentionDays:30,talentRetentionDays:30,verification:{signature:'test'}});
  store.rows.set(`${N.sessions}/${sessionId}`,{id:sessionId,secretHash:C.digest(token),expiresAt:900000000,
    jobId:j.id,jobVersion:j.version,status:'draft',files:{p:{id:'p',kind:'photo',status:'clean'},c:{id:'c',kind:'cv',status:'clean'}}});
  const service = createService({db:store.db,files:{publicFile:v=>v},infrastructure:{blockers:()=>[],signature:()=> 'test'},now:()=>1000});
  const request = {sessionId,token,profile:rawProfile(),localeAtSubmit:'es',presentationVersion:S.PRESENTATION_VERSION};
  return {store,service,request,j};
}
test('server persists one original snapshot atomically and ignores a spoofed client snapshot', async () => {
  const {store,service,request} = setup();
  const receipt = await service.submit({...request, submissionSnapshot:{title:'SPOOF'}});
  const saved = store.rows.get(`${N.applications}/${receipt.id}`);
  assert.equal(saved.submissionSnapshot.title, 'Técnico de prueba');
  assert.equal(saved.submissionSnapshot.questions.find(q => q.questionId === 'project').value, request.profile.answers.project);
  assert.equal(receipt.localeAtSubmit,'es');
  assert.equal((await service.sessionStatus(request)).receipt.localeAtSubmit,'es');
  assert.equal([...store.rows.keys()].filter(k=>k.startsWith(`${N.mail}/`)).length,1,'mail expansion is a separate block');
});
test('post-commit interruption replays the original snapshot even after the vacancy changes', async () => {
  const {store,service,request,j} = setup();
  store.failAfterCommitOnce(writes=>writes.some(([kind,r])=>kind==='create' && r.path.startsWith(`${N.applications}/`)));
  await assert.rejects(service.submit(request),{code:'UNAVAILABLE'});
  const before = JSON.stringify(store.rows.get(`${N.applications}/${request.sessionId}`));
  store.rows.set(`${N.jobs}/${j.id}`,{...j,version:2,title:'Changed',translations:{}});
  const receipt = await service.submit(request);
  assert.equal(receipt.jobTitle,'Técnico de prueba'); assert.equal(receipt.localeAtSubmit,'es');
  assert.equal(JSON.stringify(store.rows.get(`${N.applications}/${request.sessionId}`)),before);
  await assert.rejects(service.submit({...request,localeAtSubmit:'en'}),{code:'already-submitted'});
  await assert.rejects(service.submit({...request,profile:{...request.profile,givenName:'Different'}}),{code:'already-submitted'});
  assert.equal([...store.rows.keys()].filter(k=>/^careersApplications\/[^/]+$/.test(k)).length,1);
});
test('wrong form version, invalid locale, stale vacancy and expired session do not partially write', async () => {
  for (const state of ['version','locale','vacancy','session','oversize']) {
    const {store,service,request} = setup();
    if(state==='version')request.presentationVersion='stale';
    if(state==='locale')request.localeAtSubmit='invalid';
    if(state==='vacancy')store.rows.get(`${N.jobs}/qa-job`).version=2;
    if(state==='session')request.token='b'.repeat(64);
    if(state==='oversize')request.profile.answers.project=' '.repeat(1200)+'x';
    await assert.rejects(service.submit(request));
    assert(!store.rows.has(`${N.applications}/${request.sessionId}`)); assert(!store.rows.has(`${N.mail}/${request.sessionId}`));
    assert.equal(store.rows.get(`${N.sessions}/${request.sessionId}`).status,'draft');
  }
});
test('legacy request stays replayable and does not receive an inferred language', async () => {
  const {store,service,request} = setup(); delete request.localeAtSubmit; delete request.presentationVersion;
  const receipt = await service.submit(request);
  assert.equal(store.rows.get(`${N.applications}/${receipt.id}`).submissionSnapshot,undefined);
  assert.equal(receipt.localeAtSubmit,undefined);
  assert.deepEqual(await service.submit(request),receipt);
});
test('stage/notes cannot overwrite evidence and inactive admins remain denied', async () => {
  const {store,service,request} = setup(), receipt = await service.submit(request);
  const path = `${N.applications}/${receipt.id}`, before = JSON.stringify(store.rows.get(path).submissionSnapshot);
  await service.updateApplication('qa-admin',{id:receipt.id,requestId:'stage',expectedVersion:1,stage:'In review',submissionSnapshot:{title:'MALICIOUS'}});
  assert.equal(JSON.stringify(store.rows.get(path).submissionSnapshot),before);
  store.rows.set('users/qa-admin',{active:false,role:'admin'});
  await assert.rejects(service.updateApplication('qa-admin',{id:receipt.id,requestId:'stage',expectedVersion:1,stage:'In review'}),{status:403});
});
