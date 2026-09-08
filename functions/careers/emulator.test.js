'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const project='demo-demac-careers';
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '') || !/^127\.0\.0\.1:\d+$/.test(process.env.FIREBASE_STORAGE_EMULATOR_HOST || '') || process.env.GCLOUD_PROJECT!==project)throw Error('Careers integration tests require explicit local demo emulators. Production is forbidden.');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getStorage}=require('firebase-admin/storage');
const {createService,COLLECTIONS:N}=require('./service'),{createFiles}=require('./files'),{createWorkers}=require('./workers');
const C=require('./core'),sharp=require('sharp');
const app=initializeApp({projectId:project,storageBucket:`${project}.appspot.com`}), db=getFirestore(app),bucket=getStorage(app).bucket();
const requestId=()=>crypto.randomUUID();
const job=()=>({title:'QA Technician',department:'Technical',location:'Aruba',contract:'Test contract',summary:'Test role only.',responsibilities:['Test responsibility'],requirements:['Test requirement'],cvRequired:true,status:'Draft',questions:[{id:'has-vrf',label:'VRF?',kind:'yesno',required:true},{id:'detail',label:'Describe experience',kind:'textarea',required:true,when:{questionId:'has-vrf',value:'Yes'}}],internalNotes:'Never public'});
const profile=()=>({givenName:'QA',familyName:'Candidate',email:'candidate@example.test',dialCode:'+1',phone:'2025550101',whatsapp:true,sameResidence:true,nationality:'NL',applyingFrom:'AW',residence:'AW',city:'Test',totalExperience:'6',relevantExperience:'3',languages:['English'],availability:'Immediately',privacy:true,privacyVersion:'v1',futureTalent:false,answers:{'has-vrf':'No'}});
let time=Date.now(), infected=false,sent=0, smtpFail=false;
const infra={blockers:()=>[],signature:s=>C.digest(`${s?.from}|${s?.privacyVersion}|${s?.privacyText}`),verify:async()=>{},send:async a=>{sent++;if(smtpFail)throw Object.assign(Error('Simulated SMTP uncertainty'),{code:'ETIMEDOUT'});return {accepted:[a.profile.email]};}};
const files=createFiles({bucket,sharp,scanner:async()=>{if(infected)throw C.fault('unsafe-file','Test scanner rejection.',422);}});
const args={db,files,infrastructure:infra,now:()=>time},service=createService(args),other=createService(args),workers=createWorkers(args);
let config={intakeEnabled:false,privacyText:'QA test notice. Not a production policy.',privacyVersion:'v1',retentionDays:2,talentRetentionDays:3,from:'careers@example.test',replyTo:'careers@example.test',senderName:'QA Careers'};
let photo;
test.before(async()=>{
  photo=await sharp({create:{width:96,height:96,channels:3,background:'#eee'}}).png().toBuffer();
  await db.collection('users').doc('qa-admin').set({role:'admin',active:true,name:'QA Admin'});await db.collection('users').doc('qa-tech').set({role:'technician',active:true});
  await service.saveSettings('qa-admin',{requestId:requestId(),expectedVersion:0,settings:config});await service.verifySetup('qa-admin');
  config={...config,intakeEnabled:true};await service.saveSettings('qa-admin',{requestId:requestId(),expectedVersion:1,settings:config});
});
test.after(async()=>{await db.terminate();await deleteApp(app);});
async function openJob(){const id=requestId();await service.saveVacancy('qa-admin',{id,requestId:requestId(),expectedVersion:0,vacancy:{...job(),status:'Open'}});return id;}
async function prepare(jobId){const session=await service.startSession({jobId,version:1,website:''});await service.upload({...session,kind:'photo',name:'qa.png',base64:photo.toString('base64')});await service.upload({...session,kind:'cv',name:'qa.pdf',base64:Buffer.from('%PDF-1.4\n% QA fixture\n%%EOF').toString('base64')});return session;}
test('vacancies persist between independent service instances; private fields stay private',async()=>{
  const id=await openJob();assert.equal((await other.getVacancy('qa-admin',id)).title,'QA Technician');
  const publicJob=(await service.publicJobs()).jobs.find(j=>j.id===id);assert(publicJob);assert.equal(publicJob.internalNotes,undefined);assert.equal(publicJob.createdBy,undefined);
});
test('unauthorized and revoked admins cannot read or replay a previous write',async()=>{
  await assert.rejects(service.list('qa-tech','jobs'),{status:403});await assert.rejects(service.getSettings('missing'),{status:403});
  const id=requestId(),p={id,requestId:requestId(),expectedVersion:0,vacancy:job()};await service.saveVacancy('qa-admin',p);
  await db.collection('users').doc('qa-admin').update({active:false});await assert.rejects(service.saveVacancy('qa-admin',p),{status:403});await db.collection('users').doc('qa-admin').update({active:true});
});
test('optimistic versions and idempotency preserve concurrent vacancy edits',async()=>{
  const id=requestId(),p={id,requestId:requestId(),expectedVersion:0,vacancy:job()};assert.deepEqual(await service.saveVacancy('qa-admin',p),await other.saveVacancy('qa-admin',p));
  await assert.rejects(service.saveVacancy('qa-admin',{...p,vacancy:{...job(),title:'Different'}}),{code:'idempotency-conflict'});
  const results=await Promise.allSettled([service.saveVacancy('qa-admin',{...p,requestId:requestId(),expectedVersion:1}),other.saveVacancy('qa-admin',{...p,requestId:requestId(),expectedVersion:1})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('one application and one confirmation job under concurrent retries; accessible from another service',async()=>{
  const session=await prepare(await openJob()),p={...session,profile:profile()};const [a,b]=await Promise.all([service.submit(p),other.submit(p)]);assert.equal(a.id,b.id);
  const application=await other.getApplication('qa-admin',a.id);assert.equal(application.profile.email,'candidate@example.test');assert.equal(application.documents.length,2);
  assert.equal((await db.collection(N.mail).where('applicationId','==',a.id).get()).size,1);assert.equal(application.jobSnapshot.internalNotes,undefined);
  assert.equal((await service.sessionStatus(session)).receipt.reference,a.reference);
  await assert.rejects(service.submit({...p,profile:{...profile(),givenName:'Changed'}}),{code:'already-submitted'});
});
test('native file storage is private and generation-bound; unauthorized access denied',async()=>{
  const session=await prepare(await openJob()),receipt=await service.submit({...session,profile:profile()}),a=await service.getApplication('qa-admin',receipt.id);
  const cv=a.documents.find(d=>d.kind==='cv');const download=await service.document('qa-admin',a.id,cv.id);assert.equal(download.mime,'application/pdf');assert(download.bytes.length);
  await assert.rejects(service.document('qa-tech',a.id,cv.id),{status:403});
  const url=`http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${project}.appspot.com/o/${encodeURIComponent(cv.path)}?alt=media`;
  const response=await fetch(url);assert.equal(response.status,403,'unchanged Storage rules deny anonymous read');
  const read=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents/${N.applications}/${a.id}`);assert.equal(read.status,403,'unchanged Firestore rules deny anonymous read');
});
test('invalid session, rejected scanner result and missing photo cannot submit',async()=>{
  const session=await service.startSession({jobId:await openJob(),version:1});await assert.rejects(service.sessionStatus({...session,token:'a'.repeat(64)}),{status:401});
  infected=true;try{await assert.rejects(service.upload({...session,kind:'cv',name:'qa.pdf',base64:Buffer.from('%PDF-1.4\n%%EOF').toString('base64')}),{code:'unsafe-file'});}finally{infected=false;}
  assert.equal((await service.sessionStatus(session)).files.filter(f=>f.status==='clean').length,0);
  await assert.rejects(service.submit({...session,profile:profile()}),/photo/);
});
test('a revised or closed vacancy cannot receive a stale application',async()=>{
  const id=await openJob(),session=await prepare(id);await service.saveVacancy('qa-admin',{id,requestId:requestId(),expectedVersion:1,vacancy:{...job(),status:'Open',title:'Changed role'}});
  await assert.rejects(service.submit({...session,profile:profile()}),{code:'version-conflict'});
  await service.saveVacancy('qa-admin',{id,requestId:requestId(),expectedVersion:2,vacancy:{...job(),status:'Closed'}});await assert.rejects(service.submit({...session,profile:profile()}),{code:'vacancy-closed'});
});
test('stage and notes preserve immutable submitted profile and do not write operations records',async()=>{
  const session=await prepare(await openJob()),r=await service.submit({...session,profile:profile()});
  await service.updateApplication('qa-admin',{id:r.id,requestId:requestId(),expectedVersion:1,stage:'Interview'});
  await assert.rejects(service.updateApplication('qa-admin',{id:r.id,requestId:requestId(),expectedVersion:1,stage:'Hired'}),{code:'version-conflict'});
  await service.updateApplication('qa-admin',{id:r.id,requestId:requestId(),expectedVersion:2,note:'QA note'});
  const a=await other.getApplication('qa-admin',r.id);assert.equal(a.stage,'Interview');assert.equal(a.notes.length,1);assert.equal(a.profile.email,'candidate@example.test');
  for(const collection of ['appointments','staffProfiles','customers'])assert.equal((await db.collection(collection).get()).size,0);
});
test('uncertain email delivery does not lose application or automatically resend',async()=>{
  const r=await service.submit({...await prepare(await openJob()),profile:profile()});smtpFail=true;const before=sent;
  try{await workers.sendOne(db.collection(N.mail).doc(r.id));await workers.sendOne(db.collection(N.mail).doc(r.id));}finally{smtpFail=false;}
  assert.equal(sent,before+1);assert.equal((await service.getApplication('qa-admin',r.id)).emailStatus,'delivery_unknown');
});
test('cleanup distinguishes expired drafts from submitted application documents',async()=>{
  const session=await prepare(await openJob()),r=await service.submit({...session,profile:profile()}),a=await service.getApplication('qa-admin',r.id),cv=a.documents.find(d=>d.kind==='cv');
  time+=86400001;await workers.cleanup();assert.equal((await service.document('qa-admin',r.id,cv.id)).mime,'application/pdf');
  time+=86400001;await assert.rejects(service.getApplication('qa-admin',r.id),{status:404});await workers.cleanup();
  assert.equal((await db.collection(N.applications).doc(r.id).get()).exists,false);const [exists]=await bucket.file(cv.path).exists();assert.equal(exists,false);
});
