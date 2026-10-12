'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { TARGETS, verifyDelta, verifyPrivateBucket, verifyInheritedPolicies, retainedAction, CANARY } = require('./appointment-finance-prepare.cjs');
const { createHash } = require('node:crypto');
test('retention reuses identical immutable bytes, resumes its harmless probe, and rejects different content',()=>{
  const expected=createHash('sha256').update('reviewed archive').digest('hex');
  assert.equal(retainedAction(Buffer.from('reviewed archive'),expected),'reuse');
  assert.equal(retainedAction(CANARY,expected),'replace-canary');
  assert.throws(()=>retainedAction(Buffer.from('unreviewed archive'),expected));
});
test('inherited privacy checks cover every ancestor and both public principals',()=>{
  const ancestors=[{type:'project',id:'1053571783393'},{type:'organization',id:'synthetic'}];
  verifyInheritedPolicies(ancestors,[{bindings:[]},{bindings:[]}]);
  assert.throws(()=>verifyInheritedPolicies(ancestors,[{bindings:[]}]));
  assert.throws(()=>verifyInheritedPolicies([],[]));
  for(const member of ['allUsers','allAuthenticatedUsers']) assert.throws(()=>verifyInheritedPolicies(ancestors,[{}, {bindings:[{members:[member]}]}]));
});
test('each source candidate changes only its reviewed consumers and keeps bootstrap and dependencies', () => {
  for (const [name, spec] of Object.entries(TARGETS)) {
    const before = Object.fromEntries(['package.json','package-lock.json','bootstrap.js','index.js',...spec.files].map(file=>[file,'original']));
    const after = {...before,...Object.fromEntries([...spec.files,...spec.added].map(file=>[file,'candidate']))};
    assert.equal(verifyDelta(name,before,after).length,spec.files.length+spec.added.length);
    for(const file of ['package.json','package-lock.json','bootstrap.js','index.js','unrelated.js']) assert.throws(()=>verifyDelta(name,before,{...after,[file]:'changed'}));
    assert.throws(()=>verifyDelta(name,before,{...after,[spec.files[0]]:'original'}));
  }
});
test('recovery requires uniform private access and no deletion of live objects', () => {
  const privateBucket={uniform_bucket_level_access:true,lifecycle_config:{rule:[{action:{type:'Delete'},condition:{isLive:false,numNewerVersions:3}}]}};
  verifyPrivateBucket(privateBucket,{bindings:[{members:['serviceAccount:synthetic@example.invalid']}]});
  for(const member of ['allUsers','allAuthenticatedUsers']) assert.throws(()=>verifyPrivateBucket(privateBucket,{bindings:[{members:[member]}]}));
  assert.throws(()=>verifyPrivateBucket({...privateBucket,uniform_bucket_level_access:false},{}));
  assert.throws(()=>verifyPrivateBucket({...privateBucket,lifecycle_config:{rule:[{action:{type:'Delete'},condition:{age:1}}]}},{}));
});
