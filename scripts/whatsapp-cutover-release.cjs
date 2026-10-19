'use strict';
// Owner-approved single-function release and discard-only backlog cutover.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const functionRequire = require('node:module').createRequire(path.resolve(__dirname, '../functions/package.json'));
const { initializeApp } = functionRequire('firebase-admin/app');
const { getFirestore, FieldValue, Timestamp } = functionRequire('firebase-admin/firestore');
const { canonicalFunctionConfig } = require('./booking-references-release-config.cjs');
const { CUTOFF, obsolete, discardBacklog } = require('./whatsapp-cutover-queue.cjs');
const project = 'demac-corporation';
const functionName = 'wacliOutboundPoll';
const baseline = 'dccb8b43772a03714acb90db61d34cbd25bbca63';
const reviewed = '51225bcc1370b9ad424823d3d91496c508b37971';
const branch = 'release/whatsapp-cutover-20261019';
const execute = process.argv.includes('--execute');
const run = (cmd, args, options = {}) => execFileSync(cmd, args, { encoding:'utf8', stdio:['ignore','pipe','pipe'], maxBuffer:40e6, timeout:60000, ...options });
const git = args => run('git',args).trim();
const cloud = args => run('gcloud',args);
const describe = name => JSON.parse(cloud(['functions','describe',name,'--project='+project,'--region=us-central1','--gen2','--format=json']));
const summary = { cutoffIso:CUTOFF, reviewed, execute, stage:'preflight', productionSourceChanged:false };
const out = path.join(process.env.RUNNER_TEMP || '/tmp','whatsapp-cutover-20261019');
function record(stage, details = {}) { summary.stage=stage; Object.assign(summary,details); fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2)); console.log(JSON.stringify({stage,...details})); }
function gate() {
  assert.equal(process.env.GITHUB_REPOSITORY,'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF,'refs/heads/'+branch);
  assert.equal(git(['rev-parse','HEAD']),process.env.GITHUB_SHA);
  assert.equal(git(['ls-remote','origin','refs/heads/'+branch]).split(/\s/)[0],process.env.GITHUB_SHA,'Release advanced');
  for (const file of ['whatsappWacliGateway.js','whatsappReferenceBundle.js','package.json']) {
    assert.equal(git(['show','HEAD:functions/'+file]),git(['show',reviewed+':functions/'+file]),'Unreviewed function source');
  }
}
function bridgeHealth() {
  const python = "import json,urllib.request\nh=json.load(urllib.request.urlopen('http://127.0.0.1:8787/health',timeout=10))\nprint(json.dumps({k:h.get(k) for k in ['ok','connectorMode','pendingOutboundAcks','lastOutboundPollAt','lastOutboundAckAt','lastSendSuccessAt']} | {'outboundErrorPresent':bool(h.get('lastOutboundError'))}))\n";
  return JSON.parse(run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=10','demac-deploy@159.223.160.239','python3 -'],{input:python,timeout:20000}));
}
function sourceArchive(fn, name) {
  const src=fn.buildConfig.source.storageSource;
  assert.ok(src?.bucket && src?.object,'Function source unavailable');
  const zip=path.join(out,name+'.zip');
  cloud(['storage','cp',`gs://${src.bucket}/${src.object}${src.generation?'#'+src.generation:''}`,zip,'--quiet']);
  return zip;
}
const readZip=(zip,file)=>run('unzip',['-p',zip,file]).replace(/\r\n/g,'\n').trim();
async function main() {
  fs.mkdirSync(out,{recursive:true}); gate(); record('preflight');
  const before=describe(functionName);
  assert.equal(before.state,'ACTIVE'); assert.equal(before.buildConfig.runtime,'nodejs22');
  assert.equal(before.buildConfig.entryPoint,functionName);
  const peers={};
  for (const name of ['wacliOutboundAck','wacliBookingReferenceMedia','queueAppointmentConfirmation','sendDailyTechnicianSchedules']) {
    const fn=describe(name); peers[name]={revision:fn.serviceConfig.revision,updated:fn.updateTime};
  }
  const beforeScheduler=JSON.parse(cloud(['scheduler','jobs','describe','firebase-schedule-sendDailyTechnicianSchedules-us-central1','--project='+project,'--location=us-central1','--format=json']));
  const beforeHealth=bridgeHealth();
  assert.equal(beforeHealth.ok,true); assert.equal(beforeHealth.pendingOutboundAcks,0,'Unacknowledged sends must be reconciled first');
  const archive=sourceArchive(before,'before');
  const stage=path.join(out,'source'); fs.mkdirSync(stage,{recursive:true});
  run('unzip',['-q',archive,'-d',stage]);
  // Preserve the live dependency lock and every unrelated source file. Only these
  // two audited files change in the uploaded source for this single endpoint.
  for (const file of ['whatsappWacliGateway.js','whatsappReferenceBundle.js']) {
    const live=readZip(archive,file);
    assert.ok([baseline,reviewed].some(ref=>git(['show',ref+':functions/'+file])===live),'Unknown live source: '+file);
    fs.writeFileSync(path.join(stage,file),fs.readFileSync(path.join('functions',file)));
  }
  const livePackage=JSON.parse(readZip(archive,'package.json'));
  const reviewedPackage=JSON.parse(git(['show',reviewed+':functions/package.json']));
  assert.deepEqual(livePackage.dependencies,reviewedPackage.dependencies,'Live dependencies differ');
  assert.equal(livePackage.main,reviewedPackage.main,'Live bootstrap differs');
  initializeApp({projectId:project}); const db=getFirestore();
  const preview=await discardBacklog({db,FieldValue});
  record('queue-dry-run',{queuePreview:preview,previousRevision:before.serviceConfig.revision});
  if (!execute) return;
  gate();
  const fresh=describe(functionName);
  assert.equal(fresh.serviceConfig.revision,before.serviceConfig.revision,'Concurrent deployment');
  assert.deepEqual(canonicalFunctionConfig(fresh),canonicalFunctionConfig(before),'Runtime changed');
  assert.equal(bridgeHealth().pendingOutboundAcks,0,'An ACK is pending');
  const removed=await discardBacklog({db,FieldValue,execute:true,expectedFingerprint:preview.fingerprint,sourceSha:process.env.GITHUB_SHA});
  record('old-payloads-removed',{queueRemoval:removed});
  const remaining=await discardBacklog({db,FieldValue});
  assert.equal(remaining.discardCount,0,'Earlier unsent records remain');
  gate(); record('deploying-poll-only');
  cloudDeploy(stage,before);
  const after=describe(functionName);
  assert.equal(after.state,'ACTIVE');
  assert.deepEqual(canonicalFunctionConfig(after),canonicalFunctionConfig(before),'Runtime configuration changed');
  const deployed=sourceArchive(after,'after');
  for (const file of ['whatsappWacliGateway.js','whatsappReferenceBundle.js']) {
    assert.equal(readZip(deployed,file),git(['show',reviewed+':functions/'+file]),'Deployed source mismatch');
  }
  assert.equal(readZip(deployed,'package-lock.json'),readZip(archive,'package-lock.json'),'Dependency lock changed');
  record('deployed-source-verified',{productionSourceChanged:true,revision:after.serviceConfig.revision,runtimeConfigPreserved:true});
  for (const [name,value] of Object.entries(peers)) {
    const fn=describe(name); assert.deepEqual({revision:fn.serviceConfig.revision,updated:fn.updateTime},value,'Unrelated function changed');
  }
  const afterScheduler=JSON.parse(cloud(['scheduler','jobs','describe','firebase-schedule-sendDailyTechnicianSchedules-us-central1','--project='+project,'--location=us-central1','--format=json']));
  for (const key of ['schedule','timeZone','state','httpTarget','retryConfig','attemptDeadline']) assert.deepEqual(afterScheduler[key],beforeScheduler[key],'Scheduler changed');
  const denied=await fetch(`https://us-central1-${project}.cloudfunctions.net/${functionName}`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer invalid-cutover-check'},body:'{}',signal:AbortSignal.timeout(20000)});
  assert.equal(denied.status,401,'Authentication boundary failed');
  let health;
  for (let attempt=0;attempt<12;attempt++) {
    health=bridgeHealth();
    if (health.ok && !health.outboundErrorPresent && Date.now()-Date.parse(health.lastOutboundPollAt)<60000 && health.pendingOutboundAcks===0) break;
    await new Promise(resolve=>setTimeout(resolve,5000));
  }
  assert.ok(health.ok && !health.outboundErrorPresent && Date.now()-Date.parse(health.lastOutboundPollAt)<60000,'Outbound polling unhealthy');
  const finalQueue=await discardBacklog({db,FieldValue});
  assert.equal(finalQueue.discardCount,0,'Earlier unsent record returned');
  const recent=(await db.collection('whatsappOutboundQueue').where('completedAt','>=',Timestamp.fromDate(new Date(CUTOFF))).limit(401).get()).docs;
  assert.ok(recent.length<=400,'Post-cutover verification bound exceeded');
  const oldSent=recent.filter(doc=>doc.data().status==='sent' && obsolete(doc.data())).length;
  assert.equal(oldSent,0,'Old message sent after cutoff');
  record('complete',{health,oldUnsentRemaining:0,oldSentAfterCutoff:0,newSentAfterCutoff:recent.filter(doc=>doc.data().status==='sent'&&!obsolete(doc.data())).length,newPending:finalQueue.preserveNewCount,unrelatedFunctionsPreserved:true,schedulerPreserved:true});
}
function cloudDeploy(stage,before) {
  run('gcloud',['functions','deploy',functionName,'--project='+project,'--region=us-central1','--gen2','--source='+stage,'--entry-point='+functionName,'--runtime=nodejs22','--run-service-account='+before.serviceConfig.serviceAccountEmail,'--quiet','--format=value(state)'],{timeout:1200000});
}
main().catch(error=>{
  // Cloud command errors may contain runtime configuration. Never print stderr.
  const details={errorType:error.code==='ERR_ASSERTION'?'verification_failed':'operation_failed',exitCode:typeof error.status==='number'?error.status:null,
    verification:error.code==='ERR_ASSERTION'?error.message.split('\n')[0]:null};
  if(fs.existsSync(out))record('stopped-at-'+summary.stage,details);
  process.exitCode=1;
});
