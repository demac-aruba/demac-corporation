'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { templatePhases, validateLibrary, cloneTemplatePhases, selectedTemplate, listTemplates } = require('./phase-templates');
const phases = () => [
  { id:'A',name:'Phase A',scopeOfWork:'Scope',completionCriteria:'Verified',plannedVanMinutes:30,dependencies:[],progressMethod:'units',unitsPlanned:2,checklist:[{id:'C-A',label:'Check',required:true}],
    details:{sequence:1,startsOn:'2026-09-01',endsOn:'2026-09-02',responsibleManagerSnapshot:'Specific manager',technicianInstructions:'Generic safe instruction',priority:'High'} },
  { id:'B',name:'Phase B',scopeOfWork:'Scope',completionCriteria:'Verified',plannedVanMinutes:30,dependencies:['A'],progressMethod:'approval',unitsPlanned:0,checklist:[] },
];
const template = () => ({id:'T-TEST',name:'Synthetic template',description:'Generic',projectType:'VRF Project',version:1,active:true,phases:phases(),createdAt:'2026-09-19T12:00:00.000Z',createdBy:'ACTOR',updatedAt:'2026-09-19T12:00:00.000Z',updatedBy:'ACTOR'});
const library = () => ({schemaVersion:1,version:1,templates:[template()]});
test('optional empty company library is not populated with seeded templates',()=>{
 assert.deepEqual(validateLibrary(null),{schemaVersion:1,version:0,templates:[]});
});
test('copy removes dated and personal assignment metadata without mutating its source',()=>{
 const original=phases();const before=structuredClone(original);const copy=templatePhases(original);
 assert.equal(copy[0].details.startsOn,undefined);assert.equal(copy[0].details.endsOn,undefined);
 assert.equal(copy[0].details.responsibleManagerSnapshot,undefined);assert.equal(copy[0].details.technicianInstructions,'Generic safe instruction');
 assert.deepEqual(original,before);
});
test('application creates fresh deterministic phase and checklist IDs and remaps dependencies',()=>{
 const source=template();const cloned=cloneTemplatePhases(source,'EVENT-ONE');
 assert.notEqual(cloned[0].id,'A');assert.notEqual(cloned[0].checklist[0].id,'C-A');
 assert.deepEqual(cloned[1].dependencies,[cloned[0].id]);assert.deepEqual(cloned,cloneTemplatePhases(source,'EVENT-ONE'));
 assert.notEqual(cloned[0].id,cloneTemplatePhases(source,'EVENT-TWO')[0].id);
 assert.equal(cloned[0].completedUnits,undefined);assert.equal(cloned[0].phaseReviews,undefined);
});
test('library rejects malformed schemas, duplicates, capacities and implicit activity',()=>{
 for(const patch of [{schemaVersion:2},{version:0},{templates:[template(),template()]},{templates:[{...template(),active:'yes'}]},{templates:[{...template(),phases:null}]}]){
  assert.throws(()=>validateLibrary({...library(),...patch}));
 }
});
test('archived or changed templates cannot be applied from a stale form',()=>{
 assert.throws(()=>selectedTemplate(library(),'T-TEST',2),{code:'template_version_conflict'});
 assert.throws(()=>selectedTemplate({...library(),templates:[{...template(),active:false}]},'T-TEST',1),{code:'template_not_available'});
 assert.throws(()=>selectedTemplate(library(),'MISSING',1),{code:'template_not_available'});
});
test('list exposes bounded planning summaries, not full captured project history',()=>{
 const result=listTemplates(library());assert.equal(result.templates[0].phaseCount,2);assert.equal(result.templates[0].plannedVanMinutes,60);
 assert.equal(result.templates[0].phases,undefined);assert.equal(result.templates[0].customerId,undefined);
});
