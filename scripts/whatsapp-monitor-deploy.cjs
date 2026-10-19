'use strict';
// Dedicated monitor only. No queue writes, queue claims, test sends or alert recipients.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { packageMonitor } = require('../functions/whatsappMonitorPackage.cjs');
const { validateLock } = require('./booking-dwelling-candidate-validation.cjs');
const PROJECT='demac-corporation', REGION='us-central1';
const BRANCH='release/whatsapp-monitor-20261019';
const ACCOUNT=`demac-messaging-health-monitor@${PROJECT}.iam.gserviceaccount.com`;
const NAMES=['whatsappMessagingMonitor','whatsappMessagingMonitorTick','whatsappMessagingObserveOrder'];
const ROLES=['roles/datastore.user','roles/logging.viewer','roles/monitoring.metricWriter','roles/firebaseauth.viewer','roles/eventarc.eventReceiver'];
const OBSERVER_SERVICE='whatsappmessagingobserveorder';
const ARTIFACT_REPOSITORY=`https://artifactregistry.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/repositories/gcf-artifacts`;
const GROUPS={monitorExpectations:['targets'],monitorDays:['entries'],monitorIncidents:['items'],monitorAudit:[],monitorSnapshots:['queue','incidents','unverifiedIncidents']};
const CONTROL='businessSettings/whatsapp/monitorControl/active';
function validateDeployInventory(functions) {
  for(const fn of functions.filter(fn=>fn.labels?.['deployment-codebase']==='messaging-monitor')) {
    const name=fn.name?.split('/').pop();assert.ok(NAMES.includes(name),'Unexpected monitor function; no deletion authorized');
    assert.equal(fn.name,`projects/${PROJECT}/locations/${REGION}/functions/${name}`,'Unexpected monitor region');
    assert.equal(fn.buildConfig.entryPoint,name);assert.equal(fn.buildConfig.runtime,'nodejs22');
    assert.equal(fn.serviceConfig.serviceAccountEmail,ACCOUNT);
    assert.ok(!fn.serviceConfig.minInstanceCount,'Reserved instances are not authorized');
    if(fn.state==='ACTIVE')validateFunction(fn,name);
  }
}
function validateArtifactRetention(repository) {
  assert.ok([PROJECT,'1053571783393'].some(project=>repository.name===`projects/${project}/locations/${REGION}/repositories/gcf-artifacts`),'Unexpected artifact repository');
  assert.ok(Object.keys(repository.cleanupPolicies||{}).length || repository.labels?.['firebase-functions-cleanup-opted-out']==='true',
    'Preserve registry retention; automatic cleanup changes are not authorized');
}
function observerInvokerArgs(service) {
  assert.equal(service,OBSERVER_SERVICE,'Only the dedicated observer can receive invocation permission');
  return ['run','services','add-iam-policy-binding',OBSERVER_SERVICE,'--project='+PROJECT,'--region='+REGION,'--member=serviceAccount:'+ACCOUNT,'--role=roles/run.invoker','--quiet'];
}
function validateObserverPolicy(policy,requireMember=true) {
  const bindings=(policy.bindings||[]).filter(binding=>binding.role==='roles/run.invoker');
  assert.ok(!bindings.some(binding=>binding.members?.some(member=>['allUsers','allAuthenticatedUsers'].includes(member))),'Observer must remain private');
  if(requireMember)assert.ok(bindings.some(binding=>!binding.condition&&binding.members?.includes('serviceAccount:'+ACCOUNT)),'Observer invocation is not authorized');
}
function firebaseDiagnostic(error) {
  // Only CLI error headings: never retain debug logs, environment or tool output wholesale.
  return [error.stdout,error.stderr].filter(Boolean).flatMap(value=>String(value).split(/\r?\n/))
    .map(line=>line.replace(/\u001b\[[0-9;]*m/g,''))
    .filter(line=>/^Error:|HTTP Error:|Missing required permissions/.test(line))
    .slice(-8).map(line=>line.replace(/https?:\/\/\S+/g,'[URL]')
      .replace(/Bearer\s+\S+/gi,'Bearer [REDACTED]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[REDACTED]')
      .replace(/((?:access_token|refresh_token|private_key|client_secret|password)\s*[:=]\s*)\S+/gi,'$1[REDACTED]').slice(0,700));
}
async function listIndexes(api,indexUrl) {
  const found=[];let next;
  do {
    // Firestore Admin rejects nonzero pageSize, despite exposing the parameter.
    const page=await api(indexUrl+(next?'?pageToken='+encodeURIComponent(next):''));
    found.push(...(page.indexes||[]));next=page.nextPageToken;
  } while(next);
  return found;
}
function verifyIdentityPolicy(account,policy) {
  assert.equal(account?.email,ACCOUNT,'Administrator must provision the dedicated monitor identity');
  assert.notEqual(account.disabled,true,'Monitor identity is disabled');
  const bindings=(policy.bindings||[]).filter(b=>b.members?.includes('serviceAccount:'+ACCOUNT));
  const granted=bindings.filter(b=>!b.condition).map(b=>b.role);
  assert.ok(!bindings.some(b=>['roles/owner','roles/editor'].includes(b.role)),'Broad monitor identity role is forbidden');
  for(const role of ROLES)assert.ok(granted.includes(role),'Administrator must provision monitor role: '+role);
}
function validateControl(value) {
  assert.equal(value.enabled,true,'Existing monitor is disabled; do not silently reactivate');
  assert.equal(value.activationRelease,'whatsapp-monitor-20261019','Unknown control ownership');
  assert.ok(Number.isFinite(value.startedAtMs)&&value.startedAtMs>0&&value.startedAtMs<=Date.now(),'Invalid activation cutoff');
}
function validateFunction(fn,name) {
  assert.ok(NAMES.includes(name)); assert.equal(fn.state,'ACTIVE');
  assert.equal(fn.buildConfig.entryPoint,name); assert.equal(fn.buildConfig.runtime,'nodejs22');
  assert.equal(fn.labels?.['deployment-codebase'],'messaging-monitor');
  assert.equal(fn.serviceConfig.serviceAccountEmail,ACCOUNT);
  assert.equal(fn.serviceConfig.environmentVariables.WHATSAPP_MONITOR_ENABLED,'true');
  assert.equal(fn.serviceConfig.environmentVariables.WHATSAPP_MONITOR_SERVICE_ACCOUNT,ACCOUNT);
  if(name==='whatsappMessagingObserveOrder') {
    assert.equal(fn.eventTrigger.serviceAccountEmail,ACCOUNT,'Observer trigger must use the dedicated identity');
    assert.equal(fn.eventTrigger.eventType,'google.cloud.firestore.document.v1.written');
    assert.equal(fn.eventTrigger.retryPolicy,'RETRY_POLICY_RETRY');
    const filters=fn.eventTrigger.eventFilters;
    assert.ok(filters.some(f=>f.attribute==='document'&&f.value==='workOrders/{workOrderId}'));
  }
}
async function main() {
  assert.equal(process.versions.node.split('.')[0],'22');
  assert.equal(process.env.GITHUB_REPOSITORY,'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF,'refs/heads/'+BRANCH);
  const phase=process.argv[2]; assert.ok(['prepare','deploy','activate'].includes(phase));
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP||''));
  const root=process.cwd(), out=path.join(process.env.RUNNER_TEMP,'whatsapp-monitor-release'), source=path.join(out,'source');
  fs.mkdirSync(out,{recursive:true});
  const summaryPath=path.join(out,'summary.json');
  const summary=fs.existsSync(summaryPath)?JSON.parse(fs.readFileSync(summaryPath)):{sourceSha:process.env.GITHUB_SHA,queueWrites:false,messageSends:false,externalAlertsVerified:false};
  assert.equal(summary.sourceSha,process.env.GITHUB_SHA);
  const save=()=>fs.writeFileSync(summaryPath,JSON.stringify(summary,null,2));
  const step=value=>{summary.stage=phase+'-'+value;save();console.log('Monitor release: '+summary.stage);};
  const run=(cmd,args,cwd=root)=>execFileSync(cmd,args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:40*1024*1024});
  const cloud=args=>run('gcloud',args);
  const gate=()=>{
    assert.equal(run('git',['rev-parse','HEAD']).trim(),process.env.GITHUB_SHA);
    for(const ref of ['refs/heads/main','refs/heads/'+BRANCH])assert.equal(run('git',['ls-remote','origin',ref]).split(/\s/)[0],process.env.GITHUB_SHA,'Release source advanced');
    run('git',['merge-base','--is-ancestor','5cff22bb09a16b3d8eebae43eb998b6cec5f8922','HEAD']);
  };
  let token,tokenAt=0;
  const api=async(url,method='GET',body,allowMissing=false)=>{
    if(!token||Date.now()-tokenAt>40*60000){token=cloud(['auth','print-access-token']).trim();tokenAt=Date.now();}
    const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    if(allowMissing&&response.status===404)return null;
    assert.ok(response.ok,'Cloud API '+method+' HTTP '+response.status);
    return response.status===204?{}:response.json();
  };
  const adminBase=`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/collectionGroups/`;
  const describe=name=>JSON.parse(cloud(['functions','describe',name,'--gen2','--project='+PROJECT,'--region='+REGION,'--format=json']));
  const observerPolicy=()=>JSON.parse(cloud(['run','services','get-iam-policy',OBSERVER_SERVICE,'--project='+PROJECT,'--region='+REGION,'--format=json']));
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  try {
    gate();step('preflight');
    if(phase==='prepare') {
      const control=await api(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents/${CONTROL}`,'GET',undefined,true);
      if(control)validateControl({enabled:control.fields.enabled?.booleanValue,activationRelease:control.fields.activationRelease?.stringValue,startedAtMs:Number(control.fields.startedAtMs?.integerValue||control.fields.startedAtMs?.doubleValue)});
      for(const name of NAMES){const old=await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions/${name}`,'GET',undefined,true);if(old)assert.equal(old.labels?.['deployment-codebase'],'messaging-monitor','Function name collision');}
      step('package');packageMonitor(source);
      run('npm',['install','--ignore-scripts','--no-audit','--no-fund'],source);
      validateLock(fs.readFileSync(path.join(source,'package-lock.json')),JSON.parse(fs.readFileSync(path.join(source,'package.json'))));
      const load=createRequire(path.join(source,'package.json'));
      assert.deepEqual(Object.keys(load('./index.js')).sort(),NAMES);
      fs.writeFileSync(path.join(source,'.env'),`WHATSAPP_MONITOR_ENABLED=true\nWHATSAPP_MONITOR_SERVICE_ACCOUNT=${ACCOUNT}\n`);
      fs.writeFileSync(path.join(out,'firebase.json'),JSON.stringify({functions:[{source:'source',codebase:'messaging-monitor',runtime:'nodejs22'}]}));
      step('identity');
      const accountUrl=`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/${ACCOUNT}`;
      // The deployer has no identity-creation or project-policy-write permission.
      // An administrator provisions this identity once; CI only verifies it.
      const account=await api(accountUrl,'GET',undefined,true);
      const policy=await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,'POST',{options:{requestedPolicyVersion:3}});
      verifyIdentityPolicy(account,policy);
      const monitoring=await api('https://serviceusage.googleapis.com/v1/projects/1053571783393/services/monitoring.googleapis.com');
      assert.equal(monitoring.state,'ENABLED','Administrator must enable the Cloud Monitoring API');
      step('additive-index');
      const indexUrl=adminBase+'whatsappOutboundQueue/indexes';
      const matches=index=>index.queryScope==='COLLECTION'&&index.fields?.length===3&&index.fields[0].fieldPath==='status'&&index.fields[0].order==='ASCENDING'&&index.fields[1].fieldPath==='createdAt'&&index.fields[1].order==='ASCENDING'&&index.fields[2].fieldPath==='__name__';
      const allIndexes=()=>listIndexes(api,indexUrl);
      if(!(await allIndexes()).some(matches))await api(indexUrl,'POST',{queryScope:'COLLECTION',fields:[{fieldPath:'status',order:'ASCENDING'},{fieldPath:'createdAt',order:'ASCENDING'}]});
      const until=Date.now()+20*60000;
      while(true){const index=(await allIndexes()).find(matches);assert.notEqual(index?.state,'NEEDS_REPAIR');if(index?.state==='READY'){summary.indexName=index.name;break;}assert.ok(Date.now()<until,'Index readiness timeout');await sleep(15000);}
      step('monitor-retention');
      for(const [group,fields] of Object.entries(GROUPS)) {
        await api(adminBase+group+'/fields/expiresAt?updateMask=ttlConfig,indexConfig','PATCH',{ttlConfig:{},indexConfig:{indexes:[]}});
        for(const field of fields)await api(adminBase+group+'/fields/'+field+'?updateMask=indexConfig','PATCH',{indexConfig:{indexes:[]}});
      }
      summary.prepared=true;
    }
    if(phase==='deploy') {
      assert.equal(summary.prepared,true);step('isolated-functions');gate();
      const inventory=[];let next;
      do {const page=await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/-/functions`+(next?'?pageToken='+encodeURIComponent(next):''));assert.ok(!page.unreachable?.length,'Function inventory incomplete');inventory.push(...(page.functions||[]));next=page.nextPageToken;}while(next);
      validateDeployInventory(inventory);
      const retention=await api(ARTIFACT_REPOSITORY);validateArtifactRetention(retention);
      const cli=path.join(process.env.RUNNER_TEMP,'monitor-tools/node_modules/.bin/firebase');
      assert.ok(fs.existsSync(cli));
      try {
        // --force acknowledges the reviewed observer retry policy. Exact selectors,
        // inventory and retention guards prevent unrelated deletion/cleanup changes.
        const only=NAMES.map(name=>'functions:messaging-monitor:'+name).join(',');
        run(cli,['deploy','--only',only,'--project',PROJECT,'--config',path.join(out,'firebase.json'),'--non-interactive','--force'],out);
      } catch(error) {
        summary.firebaseErrors=firebaseDiagnostic(error);save();
        for(const line of summary.firebaseErrors)console.error('Firebase diagnostic: '+line);
        throw error;
      }
      summary.functions=NAMES.map(name=>{const fn=describe(name);validateFunction(fn,name);return {name,revision:fn.serviceConfig.revision,serviceAccount:fn.serviceConfig.serviceAccountEmail};});
      const afterRetention=await api(ARTIFACT_REPOSITORY);
      for(const key of ['cleanupPolicies','cleanupPolicyDryRun','labels'])assert.deepEqual(afterRetention[key],retention[key],'Registry retention changed');
      const policy=observerPolicy();validateObserverPolicy(policy,false);
      if(!(policy.bindings||[]).some(b=>b.role==='roles/run.invoker'&&!b.condition&&b.members?.includes('serviceAccount:'+ACCOUNT))) {
        gate();cloud(observerInvokerArgs(OBSERVER_SERVICE));
      }
      validateObserverPolicy(observerPolicy());summary.observerInvocationVerified=true;
      const scheduler=JSON.parse(cloud(['scheduler','jobs','describe','firebase-schedule-whatsappMessagingMonitorTick-us-central1','--project='+PROJECT,'--location='+REGION,'--format=json']));
      assert.equal(scheduler.state,'ENABLED');assert.equal(scheduler.schedule,'every 1 minutes');assert.equal(scheduler.timeZone,'America/Aruba');
      assert.ok(scheduler.httpTarget.uri.includes('whatsappmessagingmonitortick')||scheduler.httpTarget.uri.includes('whatsappMessagingMonitorTick'));
      const endpoint=`https://${REGION}-${PROJECT}.cloudfunctions.net/whatsappMessagingMonitor`;
      const preflight=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:'https://demac-aruba.com','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},signal:AbortSignal.timeout(30000)});assert.equal(preflight.status,204);
      const denied=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"action":"state"}',signal:AbortSignal.timeout(30000)});assert.equal(denied.status,401);assert.equal((await denied.json()).error.code,'unauthenticated');
      summary.anonymousDenied=true;summary.deployed=true;
    }
    if(phase==='activate') {
      assert.equal(summary.deployed,true);step('activation');gate();
      for(const name of NAMES)validateFunction(describe(name),name);
      validateObserverPolicy(observerPolicy());
      const load=createRequire(path.join(source,'package.json'));
      const {initializeApp,getApps}=load('firebase-admin/app');if(!getApps().length)initializeApp({projectId:PROJECT});
      const {getFirestore}=load('firebase-admin/firestore');const db=getFirestore(),ref=db.doc(CONTROL);
      // A retry preserves the original cutoff and never resumes a disabled monitor.
      summary.startedAtMs=await db.runTransaction(async tx=>{const before=await tx.get(ref);if(before.exists){validateControl(before.data());return before.data().startedAtMs;}const value={enabled:true,startedAtMs:Date.now(),externalAlertsVerified:false,activationRelease:'whatsapp-monitor-20261019',sourceSha:process.env.GITHUB_SHA};tx.create(ref,value);return value.startedAtMs;});save();
      cloud(['scheduler','jobs','run','firebase-schedule-whatsappMessagingMonitorTick-us-central1','--project='+PROJECT,'--location='+REGION]);
      step('first-snapshot');
      const deadline=Date.now()+5*60000;let snapshot;
      while(Date.now()<deadline){snapshot=(await db.doc('businessSettings/whatsapp/monitorSnapshots/current').get()).data();if(snapshot?.evaluatedAtMs>=summary.startedAtMs&&Date.now()-snapshot.evaluatedAtMs<180000)break;await sleep(15000);}
      assert.ok(snapshot?.evaluatedAtMs>=summary.startedAtMs&&Date.now()-snapshot.evaluatedAtMs<180000,'Fresh snapshot missing');
      summary.snapshot={evaluatedAtMs:snapshot.evaluatedAtMs,coverage:snapshot.coverage,status:snapshot.status,transport:snapshot.transport?.status,incidentCodes:(snapshot.incidents||[]).map(x=>x.code),readCount:snapshot.readCount};save();
      assert.deepEqual(snapshot.coverage,[],'Monitor source coverage incomplete');
      step('heartbeat');let points=[];
      while(Date.now()<deadline){const filter='metric.type="custom.googleapis.com/demac/messaging/heartbeat"';const result=await api(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?filter=${encodeURIComponent(filter)}&interval.startTime=${new Date(summary.startedAtMs).toISOString()}&interval.endTime=${new Date().toISOString()}`);points=(result.timeSeries||[]).flatMap(x=>x.points||[]);if(points.length)break;await sleep(15000);}
      assert.ok(points.length,'Independent heartbeat not observed');summary.heartbeatObserved=true;
      await db.terminate();summary.active=true;
    }
    step('complete');
  } catch(error) {
    summary.failure=error.code==='ERR_ASSERTION'?String(error.message).split('\n')[0]:'Command/API failed during '+summary.stage;
    // Tool stdout/stderr may contain source, config or customer data; never dump it.
    save();console.error(summary.failure);process.exitCode=1;
  }
}
module.exports={validateControl,validateFunction,verifyIdentityPolicy,listIndexes,firebaseDiagnostic,validateDeployInventory,validateArtifactRetention,observerInvokerArgs,validateObserverPolicy,NAMES,ROLES,GROUPS,CONTROL,ACCOUNT};
if(require.main===module)main();
