'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {patchFor,verifyDelta,filesForFunction,resumedTransport,TARGETS,FILES}=require('./whatsapp-monitor-source-release.cjs');
const {validateControl,validateFunction,verifyIdentityPolicy,listIndexes,firebaseDiagnostic,validateDeployInventory,validateArtifactRetention,observerInvokerArgs,validateObserverPolicy,ROLES,GROUPS,ACCOUNT,NAMES}=require('./whatsapp-monitor-deploy.cjs');
const PUBLISHED=require('./whatsapp-monitor-published-sources.json');
const {updateSource}=require('./appointment-finance-source-update.cjs');
const {sourceVerifier}=require('./appointment-finance-transport.cjs');
const transport=name=>({format:'zip',privateRetained:true,extractionVerified:true,anonymousAccessDenied:true,uri:'gs://gcf-v2-sources-1053571783393-us-central1/codex-release-recovery/appointment-finance/'+'a'.repeat(40)+'/'+name+'-candidate.zip',generation:'123',sha256:'b'.repeat(64)});
test('cross-release resumption retains the original immutable transport and successful operation proof',async()=>{
  for(const proof of PUBLISHED.functions){
    const entry={name:proof.name,alreadyPresent:true,beforeRevision:proof.afterRevision,beforeSourceHash:proof.candidateSourceHash,configHash:proof.configHash,iamHash:proof.iamHash,schedulerHash:proof.schedulerHash};
    const prior=resumedTransport(entry);assert.deepEqual(prior,proof.transport);
    for(const delta of [{alreadyPresent:false},{beforeRevision:'other'},{beforeSourceHash:'other'},{configHash:'other'},{iamHash:'other'},{schedulerHash:'other'}])assert.throws(()=>resumedTransport({...entry,...delta}));
    assert.throws(()=>resumedTransport(entry,{...PUBLISHED,releaseSha:'other'}));
    const patch=patchFor(proof.name,prior);
    const source={bucket:patch.buildConfig.source.storageSource.bucket,object:proof.name+'/function-source.zip',generation:'123'};
    const fn={name:patch.name,state:'ACTIVE',serviceConfig:{revision:proof.afterRevision},buildConfig:{source:{storageSource:source}}};
    const operation={name:'projects/demac-corporation/locations/us-central1/operations/proven',done:true,metadata:{target:patch.name,verb:'update',createTime:new Date(Date.parse(prior.createdAt)+2000).toISOString(),requestResource:{name:patch.name,buildConfig:{source:{storageSource:source}}}},response:fn};
    const matches=sourceVerifier({name:proof.name,transport:prior,downloadHash:()=>prior.sha256});
    let writes=0;await updateSource({patch,baselineRevision:proof.afterRevision,operations:async()=>[operation],inspect:async()=>({fn,alreadyApplied:true}),publish:async()=>{writes++;throw Error('No mutation expected');},sourceMatches:matches});assert.equal(writes,0);
    await assert.rejects(updateSource({patch,baselineRevision:proof.afterRevision,operations:async()=>[],inspect:async()=>({fn,alreadyApplied:true}),sourceMatches:matches}),/publication proof/);
  }
});
test('installer confirmation cannot delete unknown functions or create artifact cleanup policies',()=>{
  assert.doesNotThrow(()=>validateDeployInventory([]));
  const fn={name:'projects/demac-corporation/locations/us-central1/functions/whatsappMessagingMonitor',labels:{'deployment-codebase':'messaging-monitor'},state:'FAILED',buildConfig:{entryPoint:'whatsappMessagingMonitor',runtime:'nodejs22'},serviceConfig:{serviceAccountEmail:ACCOUNT}};
  assert.doesNotThrow(()=>validateDeployInventory([fn]));
  for(const delta of [{name:fn.name.replace('whatsappMessagingMonitor','unexpected')},{name:fn.name.replace('us-central1','europe-west1')},{serviceConfig:{serviceAccountEmail:'other'}},{serviceConfig:{...fn.serviceConfig,minInstanceCount:1}}])assert.throws(()=>validateDeployInventory([{...fn,...delta}]));
  const repo={name:'projects/demac-corporation/locations/us-central1/repositories/gcf-artifacts',cleanupPolicies:{existing:{action:'DELETE'}}};
  assert.doesNotThrow(()=>validateArtifactRetention(repo));assert.throws(()=>validateArtifactRetention({...repo,cleanupPolicies:{}}));assert.throws(()=>validateArtifactRetention({...repo,name:'other'}));
});
test('observer invocation is private and the only permitted service IAM grant is its dedicated identity',()=>{
  const args=observerInvokerArgs('whatsappmessagingobserveorder');
  assert.deepEqual(args,['run','services','add-iam-policy-binding','whatsappmessagingobserveorder','--project=demac-corporation','--region=us-central1','--member=serviceAccount:'+ACCOUNT,'--role=roles/run.invoker','--quiet']);
  assert.throws(()=>observerInvokerArgs('officebookingauthority'));
  const binding={role:'roles/run.invoker',members:['serviceAccount:'+ACCOUNT]};
  assert.doesNotThrow(()=>validateObserverPolicy({bindings:[binding]}));
  for(const policy of [{},{bindings:[{...binding,condition:{expression:'true'}}]},{bindings:[{...binding,members:['serviceAccount:other']}]},{bindings:[binding,{...binding,members:['allUsers']}]},{bindings:[binding,{...binding,members:['allAuthenticatedUsers']}]}])assert.throws(()=>validateObserverPolicy(policy));
  assert.ok(ROLES.includes('roles/eventarc.eventReceiver'));
});
test('Firebase failure diagnostics retain bounded error headings and redact credentials',()=>{
  const secret='private-value';
  const output=firebaseDiagnostic({stdout:'environment='+secret+'\nError: Permission denied. https://example.test/?access_token='+secret,stderr:'Bearer '+secret+'\nError: access_token='+secret+' Bearer '+secret+' eyJfake.fake.fake\n'+('Error: x\n'.repeat(10))});
  assert.equal(output.length,8);assert.ok(output.every(line=>line.startsWith('Error:')));
  const detail=firebaseDiagnostic({stderr:'Error: access_token='+secret+' Bearer '+secret+' eyJfake.fake.fake https://example.test/?password='+secret});
  assert.ok(detail[0].includes('[REDACTED]'));assert.ok(!JSON.stringify(detail).includes(secret));
  assert.deepEqual(firebaseDiagnostic({stderr:'debug only '+secret}),[]);
  assert.equal(firebaseDiagnostic({stderr:'Error: '+'x'.repeat(1000)})[0].length,700);
});
test('Firestore index inspection uses provider default size and preserves every returned page',async()=>{
  const url='https://firestore.googleapis.com/v1/projects/demo/databases/(default)/collectionGroups/queue/indexes';
  const calls=[];
  const api=async value=>{
    calls.push(value);const parsed=new URL(value);
    if(parsed.searchParams.has('pageSize'))throw Error('Invalid page size. Only 0 is supported.');
    if(!parsed.searchParams.has('pageToken'))return {indexes:[{name:'existing'}],nextPageToken:'next/+ token'};
    assert.equal(parsed.searchParams.get('pageToken'),'next/+ token');return {indexes:[{name:'target'}]};
  };
  assert.deepEqual(await listIndexes(api,url),[{name:'existing'},{name:'target'}]);
  assert.equal(calls.length,2);assert.equal(calls[0],url);
  assert.deepEqual(await listIndexes(async()=>({}),url),[]);
  await assert.rejects(listIndexes(async()=>{throw Error('Unavailable');},url),/Unavailable/);
});
test('live mutations can target only the two explicit function sources',()=>{
  assert.deepEqual(TARGETS,['queueAppointmentConfirmation','wacliOutboundPoll']);
  for(const name of TARGETS){const patch=patchFor(name,transport(name));assert.deepEqual(Object.keys(patch).sort(),['buildConfig','name']);assert.deepEqual(Object.keys(patch.buildConfig),['source']);}
  for(const name of ['sendDailyTechnicianSchedules','officeBookingAuthority','whatsappMessagingMonitor'])assert.throws(()=>patchFor(name,transport(name)));
  for(const delta of [{privateRetained:false},{extractionVerified:false},{anonymousAccessDenied:false},{generation:''},{sha256:'bad'},{uri:transport(TARGETS[1]).uri}])assert.throws(()=>patchFor(TARGETS[0],{...transport(TARGETS[0]),...delta}));
});
test('unrelated runtime, dependencies and every unselected producer are unchanged',()=>{
  for(const name of TARGETS){const selected=filesForFunction(name);const before=Object.fromEntries([...FILES,'bootstrap.js','package.json','package-lock.json','whatsappTransactionalService.js'].map(f=>[f,'old']));const after={...before,...Object.fromEntries(selected.map(f=>[f,'new']))};assert.deepEqual(verifyDelta(before,after,name),selected.toSorted());
    for(const file of Object.keys(before).filter(f=>!selected.includes(f)))assert.throws(()=>verifyDelta(before,{...after,[file]:'unexpected'},name));
  }
});
test('activation retries cannot reset the cutoff or resume an intentionally disabled monitor',()=>{
  const valid={enabled:true,activationRelease:'whatsapp-monitor-20261019',startedAtMs:Date.now()-60000};assert.doesNotThrow(()=>validateControl(valid));
  for(const delta of [{enabled:false},{activationRelease:'other'},{startedAtMs:NaN},{startedAtMs:0},{startedAtMs:Date.now()+60000}])assert.throws(()=>validateControl({...valid,...delta}));
});
test('preprovisioned identity requires all unconditional minimum roles without broad privileges',()=>{
  const account={email:ACCOUNT,disabled:false};
  const policy={bindings:ROLES.map(role=>({role,members:['serviceAccount:'+ACCOUNT]}))};
  assert.doesNotThrow(()=>verifyIdentityPolicy(account,policy));
  for(const bad of [null,{email:'other'},{...account,disabled:true}])assert.throws(()=>verifyIdentityPolicy(bad,policy));
  for(let i=0;i<ROLES.length;i++){
    assert.throws(()=>verifyIdentityPolicy(account,{bindings:policy.bindings.filter((_,n)=>n!==i)}));
    assert.throws(()=>verifyIdentityPolicy(account,{bindings:policy.bindings.map((b,n)=>n===i?{...b,condition:{expression:'true'}}:b)}));
  }
  assert.throws(()=>verifyIdentityPolicy(account,{bindings:[...policy.bindings,{role:'roles/editor',members:['serviceAccount:'+ACCOUNT]}]}));
  assert.throws(()=>verifyIdentityPolicy(account,{bindings:policy.bindings.map(b=>({...b,members:['serviceAccount:other']}))}));
});
test('deployment verification rejects wrong identity, disabled runtime and wrong event source',()=>{
  for(const name of NAMES){const fn={state:'ACTIVE',buildConfig:{entryPoint:name,runtime:'nodejs22'},labels:{'deployment-codebase':'messaging-monitor'},serviceConfig:{serviceAccountEmail:ACCOUNT,environmentVariables:{WHATSAPP_MONITOR_ENABLED:'true',WHATSAPP_MONITOR_SERVICE_ACCOUNT:ACCOUNT}},eventTrigger:{serviceAccountEmail:ACCOUNT,eventType:'google.cloud.firestore.document.v1.written',retryPolicy:'RETRY_POLICY_RETRY',eventFilters:[{attribute:'document',value:'workOrders/{workOrderId}'}]}};assert.doesNotThrow(()=>validateFunction(fn,name));
    for(const delta of [{state:'FAILED'},{labels:{}},{serviceConfig:{...fn.serviceConfig,serviceAccountEmail:'other'}},{serviceConfig:{...fn.serviceConfig,environmentVariables:{}}}])assert.throws(()=>validateFunction({...fn,...delta},name));
    if(name==='whatsappMessagingObserveOrder'){assert.throws(()=>validateFunction({...fn,eventTrigger:{...fn.eventTrigger,eventFilters:[]}},name));assert.throws(()=>validateFunction({...fn,eventTrigger:{...fn.eventTrigger,serviceAccountEmail:'other'}},name));}
  }
  assert.ok(ROLES.every(role=>!['roles/owner','roles/editor'].includes(role)));
  assert.ok(Object.keys(GROUPS).every(group=>group.startsWith('monitor')));
});
test('release keeps source and new infrastructure gated, isolated, serialized and never sends',()=>{
  const source=fs.readFileSync(require.resolve('./whatsapp-monitor-source-release.cjs'),'utf8'),deploy=fs.readFileSync(require.resolve('./whatsapp-monitor-deploy.cjs'),'utf8');
  assert.match(source,/updateMask=buildConfig\.source/);assert.match(source,/'--reverse', '--check'/);assert.match(source,/BASE, REVIEWED/);
  assert.doesNotMatch(source,/firestore\.googleapis|functions', 'deploy|firebase-admin/);
  assert.match(deploy,/NAMES\.map\(name=>'functions:messaging-monitor:'\+name\)/);assert.match(deploy,/validateDeployInventory\(inventory\)/);assert.match(deploy,/validateArtifactRetention\(retention\)/);assert.match(deploy,/tx\.create\(ref,value\)/);assert.match(deploy,/refs\/heads\/main/);
  assert.doesNotMatch(deploy,/claimOutboundCommand|enqueue|sendMessage|notificationChannels|alertPolicies|collection\('whatsappOutboundQueue'\)/);
  // Project IAM writes remain forbidden. The new, tested service-scoped grant
  // belongs only to the observer; it does not grant project-wide invocation.
  assert.doesNotMatch(deploy,/'projects','add-iam-policy-binding'|:setIamPolicy|accountId:/);
  const workflow=fs.readFileSync('.github/workflows/whatsapp-monitor-release.yml','utf8');assert.match(workflow,/group: field-operations-authority-production/);assert.match(workflow,/needs: safety/);
});
