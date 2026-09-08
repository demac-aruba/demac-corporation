'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const C=require('./core');
const job=()=>({title:'Test Technician',department:'Technical',location:'Aruba',contract:'Full-time',summary:'Test vacancy, not a live advertisement.',responsibilities:['Maintain test units.'],requirements:['Relevant work experience.'],cvRequired:true,status:'Draft',questions:[{id:'has-vrf',label:'VRF experience?',kind:'yesno',required:true},{id:'detail',label:'Describe experience',kind:'textarea',required:true,when:{questionId:'has-vrf',value:'Yes'}}]});
const profile=()=>({givenName:'Test',familyName:'Candidate',email:'candidate@example.test',dialCode:'+1',phone:'2025550101',whatsapp:true,sameResidence:true,nationality:'AW',applyingFrom:'AW',residence:'AW',city:'Test City',totalExperience:'6',relevantExperience:'3',languages:['English'],availability:'Immediately',privacy:true,privacyVersion:'v1',futureTalent:false,answers:{'has-vrf':'No'}});
const config=()=>({intakeEnabled:false,privacyText:'Test notice. Not a production privacy policy.',privacyVersion:'v1',retentionDays:60,talentRetentionDays:90,from:'careers@example.test',replyTo:'careers@example.test',senderName:'DEMAC Test'});
module.exports={job,profile,config};
test('server owns profile, stage and public visibility',()=>{
  const j=C.vacancy({...job(),internalNotes:'Private budget'}),p=C.profile({...profile(),stage:'Hired',score:100},j,config());
  assert.equal(p.stage,undefined);assert.equal(p.score,undefined);assert.equal(C.publicVacancy({...j,id:'test',version:1}).internalNotes,undefined);assert.equal(j.photoRequired,true);
});
test('conditional answers validated, hidden answers not persisted',()=>{
  const j=C.vacancy(job());assert.equal(C.profile({...profile(),answers:{'has-vrf':'No',detail:'hidden'}},j,config()).answers.detail,undefined);
  assert.throws(()=>C.profile({...profile(),answers:{'has-vrf':'Yes'}},j,config()),/Answer:/);
  assert.equal(C.profile({...profile(),answers:{'has-vrf':'Yes',detail:'Experience'}},j,config()).answers.detail,'Experience');
});
test('invalid fields, bad options and object answers rejected',()=>{
  const j=C.vacancy(job());for(const patch of [{email:'not-email'},{phone:'x'},{totalExperience:''},{relevantExperience:'80'},{privacy:false},{privacyVersion:'old'},{futureTalent:'yes'},{answers:{'has-vrf':{}}}])assert.throws(()=>C.profile({...profile(),...patch},j,config()));
  assert.throws(()=>C.vacancy({...job(),questions:[{id:'choice',label:'Tools',kind:'select',required:true,options:['x','x']}]}));
});
test('prototype identifiers, invalid calendar dates and forward condition rejected',()=>{
  for(const key of ['__proto__','constructor','prototype','../secret'])assert.throws(()=>C.id(key));
  for(const d of ['2026-02-30','2026-99-01','nonsense'])assert.throws(()=>C.date(d),{code:'invalid-input'});
  assert.throws(()=>C.vacancy({...job(),questions:[job().questions[1],job().questions[0]]}));
});
test('country of application is independent of telephone and nationality',()=>{
  assert.equal(C.profile({...profile(),nationality:'NL',applyingFrom:'SV',phone:'2025550101'},C.vacancy(job()),config()).residence,'SV');
});
test('publication is based on configured status and Aruba date',()=>{
  const j={...C.vacancy(job()),status:'Open',publishUntil:'2026-09-08'};
  assert.equal(C.isOpen(j,Date.parse('2026-09-09T03:59:00Z')),true);assert.equal(C.isOpen(j,Date.parse('2026-09-09T04:00:00Z')),false);
  assert.equal(C.isOpen({...j,status:'Paused'}),false);
});
test('settings have no invented sender or retention, secrets compared safely',()=>{
  assert.throws(()=>C.settings({...config(),from:''}));assert.throws(()=>C.settings({...config(),retentionDays:0}));
  const token='a'.repeat(64);assert(C.verifySecret(token,C.digest(token)));assert(!C.verifySecret('b'.repeat(64),C.digest(token)));assert(!C.verifySecret('',C.digest(token)));
});
