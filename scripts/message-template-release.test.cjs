'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {verifyDelta,patchFor,filesForFunction,TARGETS,FILES,SHARED}=require('./message-template-editor-release.cjs');
const {createBody,verifyFunction,boundaries,API_FILES}=require('./message-template-settings-install.cjs');
const transport=name=>({format:'zip',privateRetained:true,extractionVerified:true,anonymousAccessDenied:true,uri:'gs://gcf-v2-sources-1053571783393-us-central1/codex-release-recovery/appointment-finance/'+'a'.repeat(40)+'/'+name+'-candidate.zip',generation:'123',sha256:'b'.repeat(64)});
test('existing functions can change only source; arbitrary targets and public/unverified archives are denied',()=>{
  for(const name of TARGETS){
    const body=patchFor(name,transport(name));
    assert.deepEqual(Object.keys(body).sort(),['buildConfig','name']);assert.deepEqual(Object.keys(body.buildConfig),['source']);
    for(const change of [{privateRetained:false},{extractionVerified:false},{anonymousAccessDenied:false},{generation:''},{format:'tar'},{sha256:'bad'},{uri:transport('other').uri}])assert.throws(()=>patchFor(name,{...transport(name),...change}));
  }
  assert.throws(()=>patchFor('wacliOutboundPoll',transport('wacliOutboundPoll')));
});
test('source diff rejects unrelated code, runtime, dependency and deleted producer changes',()=>{
  for(const name of TARGETS){
    const selected=filesForFunction(name),before=Object.fromEntries(FILES.filter(f=>!SHARED.includes(f)).map(f=>[f,'old']));
    Object.assign(before,{'bootstrap.js':'same','package.json':'same','package-lock.json':'same'});
    const after={...before,...Object.fromEntries(selected.map(f=>[f,'new']))};
    assert.deepEqual(verifyDelta(before,after,name),[...selected].sort());
    for(const f of ['bootstrap.js','package.json','package-lock.json','whatsappWacliGateway.js',...FILES.filter(f=>!selected.includes(f))])assert.throws(()=>verifyDelta(before,{...after,[f]:'changed'},name));
    assert.throws(()=>verifyDelta(before,{...after,[selected[0]]:undefined},name));
    assert.throws(()=>verifyDelta({...before,[selected[0]]:undefined},after,name));
  }
});
test('new API is bounded to one entrypoint, pinned private source and an existing project runtime identity',()=>{
  const name='messageCopySettings',identity='1053571783393-compute@developer.gserviceaccount.com';
  const body=createBody(transport(name),identity);
  assert.equal(body.buildConfig.entryPoint,name);assert.equal(body.serviceConfig.maxInstanceCount,5);assert.ok(!body.eventTrigger);
  verifyFunction({...body,state:'ACTIVE'},identity);
  for(const change of [{state:'FAILED'},{name:body.name+'Other'},{eventTrigger:{eventType:'unexpected'}},{serviceConfig:{...body.serviceConfig,serviceAccountEmail:'other'}}])assert.throws(()=>verifyFunction({...body,state:'ACTIVE',...change},identity));
  assert.throws(()=>createBody(transport(name),'unrelated@other.iam.gserviceaccount.com'));
  assert.throws(()=>createBody({...transport(name),privateRetained:false},identity));
  assert.ok(!API_FILES.includes('bootstrap.js'));assert.ok(!API_FILES.includes('whatsappTransactionalService.js'));
});
test('HTTP acceptance requires CORS, private caching and application denial, not just an HTTP response',async()=>{
  const good=async(url,options)=>{
    assert.ok(url.endsWith('/messageCopySettings'));
    const untrusted=options.headers.Origin==='https://untrusted.example';
    const status=untrusted?403:options.method==='OPTIONS'?204:options.method==='POST'?401:405;
    return {status,headers:new Headers({'access-control-allow-origin':options.headers.Origin,'cache-control':'private, no-store'}),json:async()=>({error:untrusted?'origin-denied':options.method==='POST'?'sign-in-required':'method-not-allowed'})};
  };
  await boundaries(good);
  await assert.rejects(boundaries(async(url,options)=>({...await good(url,options),status:200})));
  await assert.rejects(boundaries(async(url,options)=>({...await good(url,options),headers:new Headers()})));
});
