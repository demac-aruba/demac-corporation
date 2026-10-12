'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {updateSource,reviewedOperation}=require('./appointment-finance-source-update.cjs');
const patch={name:'projects/demac-corporation/locations/us-central1/functions/officeBookingAuthority',buildConfig:{source:{storageSource:{bucket:'private',object:'candidate.tar.gz',generation:'77'}}}};
const clone=x=>structuredClone(x);
function fixture(){
 let state='ACTIVE',candidate=false,revision='old',patches=0,polls=0,ops=[];
 const operation=(done=false,error)=>({name:'projects/demac-corporation/locations/us-central1/operations/test',metadata:{target:patch.name,verb:'update',createTime:new Date().toISOString(),requestResource:clone(patch)},done,...(error?{error}:{...(done?{response:{...clone(patch),serviceConfig:{revision:'new'}}}:{})})});
 const adapter={patch,baselineRevision:'old',operations:async()=>clone(ops),wait:async()=>{},record:()=>{},
  inspect:async({allowFailed})=>{assert.ok(state==='ACTIVE'||allowFailed&&['FAILED','UNKNOWN'].includes(state));return {fn:{...clone(patch),state,serviceConfig:{revision}},alreadyApplied:candidate};},
  publish:async()=>{patches++;state='DEPLOYING';ops=[operation()];return clone(ops[0]);},
  getOperation:async()=>{polls++;state='ACTIVE';candidate=true;revision='new';ops=[operation(true)];return clone(ops[0]);}};
 return {adapter,operation,set:value=>{({state=state,candidate=candidate,revision=revision,ops=ops}=value);},counts:()=>({patches,polls}),getOps:()=>ops};
}
test('accepted PATCH with lost response is discovered and polled, never duplicated',async()=>{
 const f=fixture(),send=f.adapter.publish;f.adapter.publish=async()=>{await send();throw Error('Synthetic response lost');};
 const result=await updateSource(f.adapter);assert.equal(result.alreadyApplied,true);assert.deepEqual(f.counts(),{patches:1,polls:1});
});
test('rerun resumes an existing reviewed operation without a second PATCH',async()=>{
 const f=fixture();f.set({state:'DEPLOYING',candidate:true,ops:[f.operation()]});await updateSource(f.adapter);assert.deepEqual(f.counts(),{patches:0,polls:1});
});
test('terminal failed/unknown reviewed attempt recovers only the exact candidate',async()=>{
 for(const state of ['FAILED','UNKNOWN']){const f=fixture();f.set({state,candidate:true,ops:[f.operation(true,{code:13})]});await updateSource(f.adapter);assert.deepEqual(f.counts(),{patches:1,polls:1});}
});
test('successful publication proof makes rerun read-only; requested metadata alone is insufficient',async()=>{
 const f=fixture();f.set({candidate:true,revision:'new',ops:[f.operation(true)]});await updateSource(f.adapter);assert.deepEqual(f.counts(),{patches:0,polls:0});
 const unproven=fixture();unproven.set({candidate:true,revision:'new'});await assert.rejects(updateSource(unproven.adapter),/lacks successful publication proof/);assert.equal(unproven.counts().patches,0);
});
test('polling loss and failed verification prevent every downstream tariff/rule action',async()=>{
 for(const failure of ['poll','verify','operation']){
  const f=fixture();let downstream=0;
  if(failure==='poll')f.adapter.getOperation=async()=>{throw Error('Synthetic polling unavailable');};
  if(failure==='verify'){const inspect=f.adapter.inspect;f.adapter.inspect=async args=>{if(f.getOps()[0]?.done)throw Error('Synthetic IAM drift');return inspect(args);};}
  if(failure==='operation')f.adapter.getOperation=async()=>f.operation(true,{code:13});
  await assert.rejects((async()=>{await updateSource(f.adapter);downstream++;})());assert.equal(downstream,0);assert.equal(f.counts().patches,1);
 }
});
test('unrelated running update, mismatched generation and unclassified failed state cannot authorize recovery',async()=>{
 const f=fixture(),wrong=f.operation();wrong.metadata.requestResource.buildConfig.source.storageSource.generation='78';assert.equal(reviewedOperation(wrong,patch),false);f.set({ops:[wrong]});await assert.rejects(updateSource(f.adapter),/Unreviewed update/);
 const unknown=fixture();unknown.set({state:'UNKNOWN'});await assert.rejects(updateSource(unknown.adapter));assert.equal(unknown.counts().patches,0);
});
test('partial rollout resume skips proven targets and stops at the first unverified target',async()=>{
 const first=fixture(),second=fixture();first.set({candidate:true,revision:'new',ops:[first.operation(true)]});second.adapter.getOperation=async()=>second.operation(true,{code:13});let downstream=false;
 await assert.rejects((async()=>{for(const f of [first,second])await updateSource(f.adapter);downstream=true;})());
 assert.equal(first.counts().patches,0);assert.equal(second.counts().patches,1);assert.equal(downstream,false);
});
test('server-normalized immutable ZIP copy is verified before polling and on safe resume',async()=>{
 const {sourceVerifier}=require('./appointment-finance-transport.cjs');
 const source={bucket:'gcf-v2-sources-1053571783393-us-central1',object:'officeBookingAuthority/function-source.zip',generation:'99'},digest='b'.repeat(64);
 for(const lost of [false,true]){
  const f=fixture();let reads=0;
  f.adapter.sourceMatches=sourceVerifier({name:'officeBookingAuthority',transport:{sha256:digest,createdAt:new Date(Date.now()-10000).toISOString()},downloadHash:()=>{reads++;return digest;}});
  const normalized=done=>{const op=f.operation(done);op.metadata.requestResource.buildConfig.source.storageSource=clone(source);if(done)op.response.buildConfig.source.storageSource=clone(source);return op;};
  const send=f.adapter.publish;f.adapter.publish=async()=>{await send();f.set({ops:[normalized(false)]});if(lost)throw Error('Synthetic response lost');return normalized(false);};
  const poll=f.adapter.getOperation;f.adapter.getOperation=async()=>{await poll();f.set({ops:[normalized(true)]});return normalized(true);};
  const inspect=f.adapter.inspect;f.adapter.inspect=async args=>{const value=await inspect(args);if(value.alreadyApplied)value.fn.buildConfig.source.storageSource=clone(source);return value;};
  await updateSource(f.adapter);await updateSource(f.adapter);
  assert.deepEqual(f.counts(),{patches:1,polls:1});assert.equal(reads,1);
 }
});
test('copied wrong bytes or live-source divergence never permit downstream activation',async()=>{
 const f=fixture();f.adapter.sourceMatches=()=>false;await assert.rejects(updateSource(f.adapter),/unreviewed operation/);assert.deepEqual(f.counts(),{patches:1,polls:6});
 const changed=fixture(),inspect=changed.adapter.inspect;changed.adapter.inspect=async args=>{const v=await inspect(args);if(v.alreadyApplied)v.fn.buildConfig.source.storageSource.generation='wrong';return v;};
 await assert.rejects(updateSource(changed.adapter),/Live source differs/);
});
test('accepted operation provenance can populate after PATCH without another mutation',async()=>{
 const f=fixture(),send=f.adapter.publish;
 f.adapter.publish=async()=>{const response=await send();delete response.metadata.requestResource;return response;};
 await updateSource(f.adapter);assert.deepEqual(f.counts(),{patches:1,polls:1});
});
test('provenance polling is bounded and cannot switch the accepted operation identity',async()=>{
 const f=fixture(),send=f.adapter.publish,poll=f.adapter.getOperation;
 f.adapter.publish=async()=>{const response=await send();delete response.metadata.requestResource;return response;};
 f.adapter.getOperation=async()=>({...await poll(),name:'projects/demac-corporation/locations/us-central1/operations/unrelated'});
 await assert.rejects(updateSource(f.adapter),/Operation identity changed/);assert.equal(f.counts().patches,1);
});
