'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { resolveCareersLocale, localeUrl, vacancyPresentation, careersText } = require('../lib/careers-locale.ts');
const { withSpanishPreview } = require('../lib/careers-preview-locales.ts');
const exampleVacancies = () => withSpanishPreview(require('../lib/careers-preview.ts').exampleVacancies());
const { availableLocales } = require('../../../functions/careers/editorial-contract.js');
const choices = [
 ['en','es',['es-VE'],'en'], ['es','en',['en-US'],'es'], [null,'es',['en'],'es'], [null,'en',['es'],'en'],
 [null,null,['nl-NL','es-VE','en-US'],'es'], [null,null,['pap','EN-us','es'],'en'], ['xx','es',['en'],'es'],
 ['ES',null,['en'],'en'], [null,'xx',['fr','de'],'en'], [null,null,[],'en'],
];
choices.forEach(([query,saved,languages,expected],index)=>test(`locale precedence ${index+1}`,()=>assert.equal(resolveCareersLocale(query,saved,languages),expected)));
test('locale replacement preserves structural route, campaign params and fragment',()=>{
 const input='https://preview.invalid/careers/?role=hvac-technician&step=experience&question=role%3Asystems&returnTo=review&lang=en&utm_source=test#selection';
 const result=new URL(localeUrl(input,'es'),'https://preview.invalid');
 assert.equal(result.searchParams.get('lang'),'es');assert.equal(result.searchParams.getAll('lang').length,1);
 for(const key of ['role','step','question','returnTo','utm_source'])assert.equal(result.searchParams.get(key),new URL(input).searchParams.get(key));
 assert.equal(result.hash,'#selection');
});
test('reviewed Spanish presentation preserves canonical identity, questions and option values',()=>{
 const source=exampleVacancies()[0],before=JSON.stringify(source),presented=vacancyPresentation(source,'es');
 assert.deepEqual(availableLocales(source),['en','es']);assert.equal(presented.contentLocale,'es');assert.equal(presented.job.title,'Técnico HVAC');
 for(const key of ['id','status','version','cvRequired','questions'])assert.deepEqual(presented.job[key],source[key]);
 assert.equal(JSON.stringify(source),before);
});
for(const status of ['missing','Draft','stale','incomplete'])test(`${status} translation stays English, never manufactured`,()=>{
 const job=exampleVacancies()[0];
 if(status==='missing')delete job.translations;
 if(status==='Draft')job.translations.es.status='Draft';
 if(status==='stale')job.editorialVersion=2;
 if(status==='incomplete')job.translations.es.questions[0].optionLabels={};
 job.availableLocales=['en','es'];
 assert.equal(vacancyPresentation(job,'es').contentLocale,'en');assert.equal(vacancyPresentation(job,'es').job,job);
});
test('only fixed UI copy is translated, not arbitrary employer/candidate prose',()=>{
 assert.equal(careersText('es','View position'),'Ver puesto');assert.equal(careersText('en','View position'),'View position');
 assert.equal(careersText('es','Yo trabajé 4 años\nI also repaired VRF.'),'Yo trabajé 4 años\nI also repaired VRF.');
});
