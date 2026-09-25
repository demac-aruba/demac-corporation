'use strict';
// Pure config/consumer regressions. No accounts, network or production writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const W = require('../lib/public-website-content.ts');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

test('old published website content acquires compatible bundled Careers defaults', () => {
  const legacy = structuredClone(W.defaultPublicWebsiteContent);
  delete legacy.careers;
  const restored = W.normalizePublicWebsiteContent(legacy, W.WEBSITE_PUBLISHED_ID);
  assert.deepEqual(restored.careers, W.defaultCareersContent);
  // Existing normalizer explicitly adds absent optional image fields as undefined.
  assert.deepEqual(JSON.parse(JSON.stringify(restored.hero)), legacy.hero);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.contact)), legacy.contact);
});
test('Careers editorial content survives existing draft and publish normalization', () => {
  const careers = { ...W.defaultCareersContent, title: 'Careers test', imageUrl: '/approved/careers.webp', roleImageUrl: 'https://example.test/approved-role.webp' };
  const draft = W.normalizePublicWebsiteContent({ ...W.defaultPublicWebsiteContent, careers }, W.WEBSITE_DRAFT_ID);
  const published = W.normalizePublicWebsiteContent(draft, W.WEBSITE_PUBLISHED_ID);
  assert.deepEqual(published.careers, careers);
});
test('editorial image inputs reject scripts, inline candidate data and credentials', () => {
  for (const imageUrl of ['javascript:alert(1)', 'data:image/png;base64,AAAA', '//example.test/a', 'http://example.test/a', 'https://person:secret@example.test/a', '\\evil.test/a', 'relative.webp']) {
    assert.equal(W.normalizeCareersContent({ imageUrl }).imageUrl, W.defaultCareersContent.imageUrl);
  }
});
test('normalization does not mutate the source or accept arbitrary fields', () => {
  const raw = { title: '  Careers  ', notASetting: 'private', imageUrl: '/ok.webp' };
  const before = structuredClone(raw), normalized = W.normalizeCareersContent(raw);
  assert.deepEqual(raw, before); assert.equal(normalized.title, 'Careers');
  assert.equal(normalized.notASetting, undefined);
});
test('public and preview reuse the same candidate page components', () => {
  for (const file of ['careers-public.tsx', 'careers-preview.tsx']) {
    const source = read(`components/careers/${file}`);
    for (const component of ['VacancyCatalogue', 'VacancyProfile', 'ApplicationReceipt']) assert(source.includes(`<${component}`));
    assert(source.includes('<ApplicationFunnel'));
  }
  assert(!read('components/careers/careers-preview.tsx').includes('loadPublishedWebsiteContent'));
  assert(read('components/careers/careers-public.tsx').includes('loadPublishedWebsiteContent'));
});
test('receipt cannot offer recruiter controls as candidate actions', () => {
  const source = read('components/careers/careers-pages.tsx');
  assert(!source.includes('Review this candidate'));
  assert(!source.includes("view: 'admin'"));
  assert(source.includes('{reference}')); assert(source.includes('{email}'));
  assert(!source.includes('candidate@email.com')); assert(!source.includes('DEMAC-2026-0147'));
});
test('Website Manager edits unnormalized input and retains its existing save/publish path', () => {
  const source = read('components/website-manager-workspace.tsx');
  assert(source.includes('defaultCareersContent)[key]'));
  assert(!source.includes('value={normalizeCareersContent'));
  assert(source.includes('saveWebsiteDraft')); assert(source.includes('publishWebsiteContent'));
});
test('only a configured experience value can add a fourth public fact', () => {
  const source = read('components/careers/careers-visuals.tsx');
  assert(source.includes('...(experience ?'));
  assert(!source.includes("experience || 'See requirements'"));
});

test('global Careers Spanish is configured, reviewed and invalidated by changed original',()=>{
 const original=W.normalizeCareersContent(W.defaultCareersContent);
 const es=W.careersContentFor(original,'es');assert.equal(es.contentLocale,'es');assert.equal(es.content.title,'Trabaja con nosotros');
 assert.equal(W.careersContentFor({...original,title:'New title'},'es').contentLocale,'en');
 assert.equal(W.careersContentFor({...original,spanish:{...original.spanish,status:'Draft'}},'es').contentLocale,'en');
 const raw={...original,spanish:{...original.spanish,title:'Nueva página',source:W.careersCopySignature(original)}};
 const saved=W.normalizePublicWebsiteContent({...W.defaultPublicWebsiteContent,careers:raw},W.WEBSITE_PUBLISHED_ID);
 assert.equal(W.careersContentFor(saved.careers,'es').content.title,'Nueva página');
 assert.equal(W.careersContentFor(W.normalizeCareersContent({...original,spanish:{bad:'unreviewed'}}),'es').contentLocale,'en');
});
