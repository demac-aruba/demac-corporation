'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const P=require('./privacy-contract'),C=require('./core');
const {createService,COLLECTIONS:N}=require('./service'),{transactionStore}=require('./test-support/transaction-store');
const config=()=>({intakeEnabled:false,privacyText:'Original test policy.',privacyVersion:'v1',retentionDays:30,talentRetentionDays:40,from:'qa@example.test',replyTo:'qa@example.test',senderName:'Test'});
test('legacy policy remains verbatim with explicitly unknown language',()=>{
 const selected=P.selectPrivacy(P.publicPrivacy(config()),'es');assert.equal(selected.text,'Original test policy.');assert.equal(selected.contentLocale,null);assert.equal(selected.translationPending,true);
});
test('only the reviewed current Spanish notice is public',()=>{
 const c={...config(),privacyLocale:'en',privacyTranslation:{text:'Aviso de prueba.',status:'Approved',sourceVersion:'v1'}};
 assert.equal(P.selectPrivacy(P.publicPrivacy(c),'es').text,'Aviso de prueba.');assert.equal(P.selectPrivacy(P.publicPrivacy(c),'es').contentLocale,'es');
 for(const patch of [{privacyVersion:'v2'},{privacyLocale:null},{privacyTranslation:{...c.privacyTranslation,status:'Draft'}}])assert.equal(P.publicPrivacy({...c,...patch}).spanishText,undefined);
 assert.equal(P.selectPrivacy(P.publicPrivacy(c),'en').text,c.privacyText);
});
test('malformed policy declarations and empty approvals are rejected',()=>{
 for(const input of [{privacyLocale:'fr'},{privacyTranslation:{text:'',status:'Approved',sourceVersion:'v1'}},{privacyTranslation:{text:'x'.repeat(12001),status:'Draft',sourceVersion:'v1'}}])assert.throws(()=>P.parsePrivacyFields(input),{code:'privacy-version'});
});
test('original Spanish policy does not need a fabricated translation',()=>{
 const view=P.selectPrivacy(P.publicPrivacy({...config(),privacyLocale:'es'}),'es');assert.equal(view.contentLocale,'es');assert.equal(view.translationPending,false);
});
test('policy review or translation change requires a new version and cannot erase via old client',async()=>{
 const store=transactionStore();store.rows.set('users/admin',{active:true,role:'admin'});
 const service=createService({db:store.db,files:{},infrastructure:{signature:()=> 'ok',blockers:()=>[]},now:()=>1000});
 const first={...config(),privacyLocale:'en',privacyTranslation:{text:'Aviso de prueba.',status:'Approved',sourceVersion:'v1'}};
 await service.saveSettings('admin',{requestId:'a',expectedVersion:0,settings:first});
 await assert.rejects(service.saveSettings('admin',{requestId:'b',expectedVersion:1,settings:{...first,privacyTranslation:{...first.privacyTranslation,text:'Different.'}}}),{code:'privacy-version'});
 await service.saveSettings('admin',{requestId:'c',expectedVersion:1,settings:config()});
 assert.equal(store.rows.get(`${N.settings}/default`).privacyTranslation.text,'Aviso de prueba.');
 const next={...first,privacyVersion:'v2',privacyTranslation:{...first.privacyTranslation,text:'Aviso actualizado.',sourceVersion:'v2'}};
 await service.saveSettings('admin',{requestId:'d',expectedVersion:2,settings:next});assert.equal(store.rows.get(`${N.settings}/default`).privacyVersion,'v2');
});
