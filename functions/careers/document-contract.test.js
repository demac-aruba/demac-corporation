'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const D=require('./document-contract'),C=require('./core');
const {createService,COLLECTIONS:N}=require('./service');
const {transactionStore}=require('./test-support/transaction-store');
const requirement=(category,required=false,extra={})=>({category,required,helpEn:'',helpEs:'',reviewedSource:'',...extra});
const job=(requirements)=>({id:'test-job',version:1,title:'Test technician',department:'Technical',location:'Aruba',contract:'Full-time',summary:'Test only',responsibilities:['Test safely'],requirements:['Test'],desired:[],internalNotes:'',openings:1,cvRequired:true,photoRequired:true,status:'Open',questions:[],...(requirements===undefined?{}:{documentRequirements:requirements})});
test('legacy generic documents and upload IDs remain compatible',()=>{
 assert.deepEqual(D.requirementsFor(job()).map(r=>r.category),['document']);
 assert.equal(D.uploadIdentityMaterial('document','hash','document'),'document|hash');
 assert.equal(D.uploadIdentityMaterial('photo','hash'),'photo|hash');
 D.validateDocuments(job(),[{kind:'document'}]);
});
test('duplicate, unrecognized, malformed or oversized category configuration is rejected',()=>{
 for(const raw of [{},[requirement('bad')],[requirement('diploma'),requirement('diploma')],[{category:'certificate',required:'yes'}],[requirement('id')],[requirement('diploma',true,{helpEn:'x'.repeat(601)})]])assert.throws(()=>D.parseDocumentRequirements(raw),{code:'document-policy'});
});
test('required categories do not turn optional certificates or identification into obligations',()=>{
 const j=job([requirement('diploma',true),requirement('certificate')]);
 assert.deepEqual(D.missingDocumentCategories(j,[]),['diploma']);
 assert.throws(()=>D.validateDocuments(j,[{kind:'document',category:'certificate'}]),{code:'document-policy'});
 D.validateDocuments(j,[{kind:'document',category:'diploma'}]);
});
test('identification is never accepted without explicit server policy, even if configured',()=>{
 const j=job([requirement('id',false,{helpEn:'Approved test purpose.'})]);
 assert.throws(()=>D.validateDocuments(j,[{kind:'document',category:'id'}]),{code:'document-policy'});
 D.validateDocuments(j,[{kind:'document',category:'id'}],true);
 assert.throws(()=>D.validateDocuments(job([]),[{kind:'document',category:'id'}],true));
});
test('Spanish custom help is current only when reviewed against the exact English text',()=>{
 const r=requirement('diploma',false,{helpEn:'Purpose.',helpEs:'Finalidad.',reviewedSource:'Purpose.'});
 assert.equal(D.requirementPresentation(r,'es').help,'Finalidad.');
 assert.equal(D.requirementPresentation({...r,helpEn:'Changed.'},'es').translationPending,true);
 assert.equal(D.documentTranslationIssues(job([{...r,helpEn:'Changed.'}])).length,1);
 assert.equal(D.requirementPresentation(requirement('certificate'),'es').contentLocale,'es');
});
test('server public projection includes categories but no hiring notes',()=>{
 const j=C.vacancy(job([requirement('certificate',true)]));assert.equal(C.publicVacancy(j).documentRequirements[0].category,'certificate');assert(!('internalNotes' in C.publicVacancy(j)));
});
function setup(requirements){
 const store=transactionStore(),token='a'.repeat(64),j=job(requirements),sessionId='test-session';
 store.rows.set(`${N.jobs}/${j.id}`,j);store.rows.set('users/admin',{active:true,role:'admin'});
 store.rows.set(`${N.sessions}/${sessionId}`,{id:sessionId,jobId:j.id,jobVersion:1,status:'draft',files:{},expiresAt:900000,secretHash:C.digest(token)});
 const files={decode:v=>Buffer.from(v,'base64'),prepare:async bytes=>({bytes,mime:'application/pdf'}),store:async(s,id,p,lease)=>({path:`careers-private/${s}/${id}-${lease}`,generation:'1'}),publicFile:r=>({id:r.id,kind:r.kind,category:r.category,status:r.status})};
 const service=createService({db:store.db,files,infrastructure:{blockers:()=>[],signature:()=> 'ok'},now:()=>1000});
 const request={sessionId,token,kind:'document',name:'evidence.pdf',base64:Buffer.from('%PDF-TEST').toString('base64')};
 return {store,service,request,j};
}
test('same PDF can evidence two configured categories without conflating their identities',async()=>{
 const x=setup([requirement('diploma'),requirement('certificate')]);
 const diploma=await x.service.upload({...x.request,category:'diploma'}),certificate=await x.service.upload({...x.request,category:'certificate'});
 assert.notEqual(diploma.id,certificate.id);assert.equal(diploma.category,'diploma');assert.equal(certificate.category,'certificate');
 assert.deepEqual(await x.service.upload({...x.request,category:'diploma'}),diploma);
 assert.equal(Object.keys(x.store.rows.get(`${N.sessions}/${x.request.sessionId}`).files).length,2);
});
test('invalid category, absent ID policy and stale version reject before a file is reserved',async()=>{
 for(const state of ['category','id','version']){
 const x=setup([requirement('id',false,{helpEn:'Proposed purpose.'}),requirement('certificate')]);
 if(state==='version')x.store.rows.get(`${N.jobs}/${x.j.id}`).version=2;
 await assert.rejects(x.service.upload({...x.request,category:state==='category'?'diploma':state==='id'?'id':'certificate'}));
 assert.equal(Object.keys(x.store.rows.get(`${N.sessions}/${x.request.sessionId}`).files).length,0);
 }
});
test('additional category requirements survive an old editor that omits the extension',async()=>{
 const x=setup([requirement('certificate')]);
 const edited={...x.j,status:'Draft'};delete edited.documentRequirements;
 await x.service.saveVacancy('admin',{id:x.j.id,vacancy:edited,requestId:'old-editor',expectedVersion:1});
 assert.equal(x.store.rows.get(`${N.jobs}/${x.j.id}`).documentRequirements[0].category,'certificate');
});

test('incomplete document editing returns blockers without crashing the editorial panel',()=>{
 const pending=job([requirement('id')]);
 assert.equal(D.documentTranslationIssues(pending).length,1);
 assert.throws(()=>D.parseDocumentRequirements(pending.documentRequirements),{code:'document-policy'});
});
