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

// LANG-02: presentation only; canonical drafts, option values and validators remain authoritative.
const { questionPresentation, careersTemplate, careersFormErrors, careersIssue, careersIssueText } = require('../lib/careers-locale.ts');
const { formScreens } = require('../lib/careers-form-flow.ts');
const { emptyDraft } = require('../lib/careers-preview.ts');
const Form = require('../../../functions/careers/form-contract.js');
test('all standard form screens have Spanish labels without translating role prose',()=>{
 const job=exampleVacancies()[0],draft=emptyDraft();draft.sameResidence=false;
 for(const screen of formScreens(job,draft).filter(s=>!s.question)) assert.notEqual(careersText('es',screen.label),screen.label,screen.id);
 assert.equal(careersText('en','What is your first name?'),'What is your first name?');
});
test('reviewed question labels and help are projections, not rewritten definitions',()=>{
 const job=exampleVacancies()[0];job.questions[0].help='Choose all installed types.';job.translations.es.questions[0].help='Elige todos los tipos instalados.';
 const before=JSON.stringify(job),display=questionPresentation(job,job.questions[0],'es');
 assert.equal(display.contentLocale,'es');assert.equal(display.label,'¿Con qué sistemas has trabajado?');
 assert.equal(display.help,'Elige todos los tipos instalados.');
 assert.deepEqual(display.options.map(o=>o.value),job.questions[0].options);
 assert.equal(display.options[0].label,'Unidades split');assert.equal(JSON.stringify(job),before);
});
for(const state of ['missing','Draft','stale','incomplete'])test(`question presentation rejects ${state} Spanish`,()=>{
 const job=exampleVacancies()[0];
 if(state==='missing')delete job.translations;
 if(state==='Draft')job.translations.es.status='Draft';
 if(state==='stale')job.editorialVersion=2;
 if(state==='incomplete')job.translations.es.questions[0].optionLabels={};
 job.availableLocales=['en','es'];const display=questionPresentation(job,job.questions[0],'es');
 assert.equal(display.contentLocale,'en');assert.equal(display.label,job.questions[0].label);
 assert.deepEqual(display.options,job.questions[0].options.map(value=>({value,label:value})));
});
test('English-only employer text matching UI copy is never translated as UI',()=>{
 const job=exampleVacancies()[1],q={id:'literal',label:'Continue',kind:'text',required:false,help:'Select CV'};
 job.questions.push(q);const display=questionPresentation(job,q,'es');
 assert.equal(display.label,'Continue');assert.equal(display.help,'Select CV');assert.equal(display.contentLocale,'en');
});
test('Yes/No and conditional visibility use original values in both presentations',()=>{
 const job=exampleVacancies()[0],parent=job.questions[1];
 job.questions.push({id:'followup',label:'Describe the work',kind:'textarea',required:true,when:{questionId:parent.id,value:'Yes'}});
 job.translations.es.questions.push({id:'followup',label:'Describe el trabajo',help:'',optionLabels:{}});
 assert.deepEqual(questionPresentation(job,parent,'es').options,[{value:'Yes',label:'Sí'},{value:'No',label:'No'}]);
 assert.equal(Form.visibleQuestions(job.questions,{drawings:'Yes'}).some(q=>q.id==='followup'),true);
 assert.equal(Form.visibleQuestions(job.questions,{drawings:'No'}).some(q=>q.id==='followup'),false);
 assert.equal(Form.visibleQuestions(job.questions,{drawings:'Sí'}).some(q=>q.id==='followup'),false);
});
test('every client validation message in representative invalid input is localized without changing keys',()=>{
 const job=exampleVacancies()[0],draft=emptyDraft();
 const errors={...Form.validateDetails(draft).errors,...Form.validateExperience(draft,job.questions).errors};
 const translated=careersFormErrors('es',errors,job);
 assert.deepEqual(Object.keys(translated),Object.keys(errors));
 for(const key of Object.keys(errors))assert.notEqual(translated[key],errors[key],key);
 assert.equal(translated['q-systems'],'Responde: ¿Con qué sistemas has trabajado?');
 assert.deepEqual(careersFormErrors('en',errors,job),errors);
});
for(const [message,expected] of [
 ['Enter a valid calendar date.','Escribe una fecha válida.'],
 ['Enter a valid http or https web address.','Escribe una dirección web válida que comience por http o https.'],
 ['Choose valid options from the list.','Elige opciones válidas de la lista.'],
 ['The combined files must be smaller than 30 MB.','El tamaño total de los archivos debe ser menor de 30 MB.'],
 ['Choose a file smaller than 10 MB.','Elige un archivo de menos de 10 MB.'],
])test(`Spanish validation: ${message}`,()=>assert.equal(careersText('es',message),expected));
test('live and preview privacy acknowledgements do not mislabel one another',()=>{
 const errors={privacy:'Read the preview privacy information and acknowledge it.'},job=exampleVacancies()[0];
 assert.equal(careersFormErrors('es',errors,job,true).privacy,'Lee y acepta el aviso de privacidad de reclutamiento.');
 assert.equal(careersFormErrors('es',errors,job,false).privacy,'Lee y acepta la información de privacidad de esta vista previa.');
});
test('file names and template values are substituted once and never translated',()=>{
 assert.equal(careersTemplate('es','Remove {name}',{name:'Select CV {name}.pdf'}),'Eliminar Select CV {name}.pdf');
 assert.equal(careersIssueText('es',{message:'This file is empty. Please choose another file.',fileName:'Continue.pdf'}),'Continue.pdf: Este archivo está vacío. Elige otro archivo.');
 assert.equal(careersTemplate('en','Step {step}: {label}',{step:1,label:'Your details'}),'Step 1: Your details');
});
test('server code selects Spanish recovery instructions while English preserves the actual error',()=>{
 const issue=careersIssue(Object.assign(new Error('Connection interrupted after saving. Please retry.'),{code:'connection-error'}));
 assert.equal(issue.code,'connection-error');assert.match(careersIssueText('es',issue),/no se duplicará/);
 assert.equal(careersIssueText('en',issue),'Connection interrupted after saving. Please retry.');
 const unexpected=careersIssue(Object.assign(new Error('untrusted arbitrary service text'),{code:'unexpected'}));
 assert.equal(careersIssueText('es',unexpected).includes('untrusted'),false);
});
test('Spanish UI cannot change the stored answer schema, required state or field types',()=>{
 const job=exampleVacancies()[0],draft=emptyDraft();draft.answers={systems:['VRF / VRV'],drawings:'Yes',project:'  Trabajé 4 años.\nI repaired VRF.  '};
 const before=JSON.stringify({job,draft});const screens=formScreens(job,draft);
 for(const q of job.questions)questionPresentation(job,q,'es');
 const after=formScreens(job,draft);
 assert.deepEqual(after,screens);assert.equal(JSON.stringify({job,draft}),before);
 assert.equal(draft.answers.project,'  Trabajé 4 años.\nI repaired VRF.  ');
});
