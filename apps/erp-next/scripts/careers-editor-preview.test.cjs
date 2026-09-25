'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {editorPreviewState}=require('../lib/careers-editor-preview.ts');
const {exampleVacancies,validateVacancy}=require('../lib/careers-preview.ts');
const {withSpanishPreview}=require('../lib/careers-preview-locales.ts');
const {vacancyPresentation,questionPresentation}=require('../lib/careers-locale.ts');
const example=()=>withSpanishPreview(exampleVacancies())[0];

test('complete Spanish draft can be inspected without approving or publishing the original',()=>{
 const source=example();source.status='Draft';source.translations.es.status='Draft';
 const before=structuredClone(source),preview=editorPreviewState(source,1);
 assert.equal(preview.originalSpanishStatus,'Draft');assert.deepEqual(preview.spanishIssues,[]);
 assert.equal(vacancyPresentation(preview.vacancy,'es').contentLocale,'es');
 assert.equal(vacancyPresentation(source,'es').contentLocale,'en');
 assert.equal(preview.vacancy.status,'Draft');assert.deepEqual(source,before);
});
test('current edited copy can be previewed after English changes without relabelling source review/version',()=>{
 const source=example();source.title='Edited English draft';source.translations.es.status='Approved';
 const before=structuredClone(source),preview=editorPreviewState(source,2);
 assert.deepEqual(preview.spanishIssues,[]);assert.equal(preview.vacancy.editorialVersion,2);
 assert.equal(preview.vacancy.translations.es.sourceVersion,2);
 assert.deepEqual(source,before);assert.equal(source.translations.es.sourceVersion,1);
});
for(const defect of ['missing','title','option','question'])test(`incomplete ${defect} Spanish is never made ready by preview`,()=>{
 const source=example();
 if(defect==='missing')delete source.translations;
 if(defect==='title')source.translations.es.title='';
 if(defect==='option')source.translations.es.questions[0].optionLabels={};
 if(defect==='question')source.translations.es.questions=[];
 const before=structuredClone(source),preview=editorPreviewState(source,1);
 assert(preview.spanishIssues.length);assert.deepEqual(source,before);
 assert.equal(vacancyPresentation(preview.vacancy,'es').contentLocale,'en');
});
test('preview data is deeply detached; question IDs, original choices and source arrays stay identical',()=>{
 const source=example(),before=structuredClone(source),preview=editorPreviewState(source,1);
 assert.deepEqual(preview.vacancy.questions,source.questions);
 assert.deepEqual(questionPresentation(preview.vacancy,preview.vacancy.questions[0],'es').options.map(item=>item.value),source.questions[0].options);
 preview.vacancy.questions[0].options.push('LOCAL ONLY');
 preview.vacancy.translations.es.questions[0].label='LOCAL ONLY';
 preview.vacancy.responsibilities[0]='LOCAL ONLY';
 assert.deepEqual(source,before);
});
test('stored vacancy/contract and native field types are untouched by preview projection',()=>{
 const source=example();source.questions=[];source.translations.es.questions=[];
 const kinds=['text','textarea','number','date','url','select','multiselect','yesno'];
 for(const kind of kinds){
   const options=['select','multiselect'].includes(kind)?['A','B']:undefined;
   source.questions.push({id:`q-${kind}`,label:`Question ${kind}`,kind,required:true,...(options?{options}:{})});
   source.translations.es.questions.push({id:`q-${kind}`,label:`Pregunta ${kind}`,help:'',optionLabels:options?{A:'Uno',B:'Dos'}:kind==='yesno'?{Yes:'Sí',No:'No'}:{}});
 }
 const preview=editorPreviewState(source,1);assert.deepEqual(preview.spanishIssues,[]);
 assert.deepEqual(preview.vacancy.questions,source.questions);
 for(const key of ['id','version','status','cvRequired','documentRequirements'])assert.deepEqual(preview.vacancy[key],source[key]);
 assert.equal(validateVacancy(preview.vacancy),null);
});
