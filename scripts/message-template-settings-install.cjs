'use strict';
// Installs only the new HTTP settings boundary; never reads/writes business data.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { runtimeSourceHash, isolatedTestEnv } = require('./booking-dwelling-release.cjs');
const { validateLock } = require('./booking-dwelling-candidate-validation.cjs');
const { retainZip, createZip } = require('./appointment-finance-transport.cjs');
const { verifyTraffic } = require('./appointment-finance-release.cjs');
const NAME = 'messageCopySettings', PROJECT = 'demac-corporation', REGION = 'us-central1';
const RESOURCE = `projects/${PROJECT}/locations/${REGION}/functions/${NAME}`;
const API_FILES = ['messageCopySettingsFunction.js', 'messageCopySettingsHttp.js', 'messageCopySettings.js', 'messageCopy.js', 'messageCopyStore.js', 'data/message-copy-catalog.json'];
function createBody(transport, runtimeIdentity) {
  assert.match(runtimeIdentity, /^1053571783393-compute@developer\.gserviceaccount\.com$|^demac-corporation@appspot\.gserviceaccount\.com$|^[a-z0-9-]+@demac-corporation\.iam\.gserviceaccount\.com$/);
  for (const field of ['privateRetained','extractionVerified','anonymousAccessDenied']) assert.equal(transport[field], true);
  const prefix = 'gs://gcf-v2-sources-1053571783393-us-central1/';
  assert.match(transport.uri, /^gs:\/\/gcf-v2-sources-1053571783393-us-central1\/codex-release-recovery\/appointment-finance\/[a-f0-9]{40}\/messageCopySettings-candidate\.zip$/);
  assert.match(transport.generation, /^\d+$/);
  return { name: RESOURCE, buildConfig: { runtime: 'nodejs22', entryPoint: NAME, source: { storageSource: { bucket: 'gcf-v2-sources-1053571783393-us-central1', object: transport.uri.slice(prefix.length), generation: transport.generation } } },
    serviceConfig: { serviceAccountEmail: runtimeIdentity, availableMemory: '256M', timeoutSeconds: 30, maxInstanceCount: 5, minInstanceCount: 0, ingressSettings: 'ALLOW_ALL' },
    labels: { 'deployment-tool': 'codex-message-editor' } };
}
function verifyFunction(fn, runtimeIdentity) {
  assert.equal(fn.name, RESOURCE); assert.equal(fn.state, 'ACTIVE');
  assert.equal(fn.buildConfig.runtime, 'nodejs22'); assert.equal(fn.buildConfig.entryPoint, NAME);
  assert.ok(!fn.eventTrigger); assert.equal(fn.serviceConfig.serviceAccountEmail, runtimeIdentity);
  assert.equal(fn.serviceConfig.timeoutSeconds, 30); assert.equal(fn.serviceConfig.maxInstanceCount, 5);
  assert.ok(!fn.serviceConfig.minInstanceCount); assert.equal(fn.serviceConfig.availableMemory, '256M');
  assert.equal(fn.serviceConfig.ingressSettings, 'ALLOW_ALL'); assert.ok(!fn.serviceConfig.secretEnvironmentVariables?.length);
}
async function boundaries(fetcher = fetch) {
  for (const origin of ['https://demac-aruba.com','https://www.demac-aruba.com']) {
    for (const item of [{ method: 'OPTIONS', status: 204 }, { method: 'POST', status: 401, error: 'sign-in-required' }, { method: 'GET', status: 405, error: 'method-not-allowed' }]) {
      const result = await fetcher(`https://${REGION}-${PROJECT}.cloudfunctions.net/${NAME}`, { method: item.method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Origin: origin, 'Content-Type': 'application/json', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' }, ...(item.method === 'POST' ? { body: '{"action":"list"}' } : {}) });
      assert.equal(result.status, item.status); assert.equal(result.headers.get('access-control-allow-origin'), origin);
      assert.equal(result.headers.get('cache-control'), 'private, no-store');
      if (item.error) assert.equal((await result.json()).error, item.error);
    }
  }
  const denied = await fetcher(`https://${REGION}-${PROJECT}.cloudfunctions.net/${NAME}`, { method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'origin-denied');
}
async function installApi({ reviewedRoot, out, cloud, api, describe, service, download, prepared, sourceGate, saveStage }) {
  const run = (cmd,args,options={}) => execFileSync(cmd,args,{ encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024,...options });
  const stage = path.join(out, 'settings-api-source'); fs.mkdirSync(stage);
  for (const file of API_FILES) { const target=path.join(stage,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(reviewedRoot,'functions',file),target); }
  const pkg = JSON.parse(fs.readFileSync(path.join(reviewedRoot,'functions/package.json')));
  fs.writeFileSync(path.join(stage,'package.json'),JSON.stringify({...pkg,main:'messageCopySettingsFunction.js',scripts:{}},null,2)+'\n');
  fs.copyFileSync(path.join(reviewedRoot,'functions/package-lock.json'),path.join(stage,'package-lock.json'));
  validateLock(fs.readFileSync(path.join(stage,'package-lock.json')),pkg);
  const expected = manifest(stage), validation=path.join(out,'settings-api-validation');fs.cpSync(stage,validation,{recursive:true});
  saveStage('test-settings-api-package');
  const isolated=isolatedTestEnv(process.env);
  run('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:validation,env:isolated});
  const test=run(process.execPath,['--require',path.join(reviewedRoot,'scripts/booking-dwelling-test-network.cjs'),path.join(reviewedRoot,'scripts/message-template-api-smoke.cjs'),validation,path.join(reviewedRoot,'functions/test-support/referenceDb.cjs')],{cwd:validation,env:isolated});
  assert.match(test,/PASS: settings API/);assert.deepEqual(manifest(stage),expected);
  const identity=describe('officeBookingAuthority').serviceConfig.serviceAccountEmail;
  saveStage('retain-settings-api-package');
  const zip=createZip(stage,path.join(out,'settings-api-proof.zip'));
  const transport=await retainZip({name:NAME,directory:stage,archive:zip,out,prepared,cloud});
  const body=createBody(transport,identity);
  const inventory=JSON.parse(cloud(['functions','list','--v2','--regions='+REGION,'--project='+PROJECT,'--format=json']));
  let existing=inventory.some(fn=>fn.name===RESOURCE), operationName=null;
  if (!existing) {
    sourceGate();saveStage('create-settings-api');
    let operation=await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/functions?functionId=${NAME}`,'POST',body);
    assert.match(operation.name,/^projects\/demac-corporation\/locations\/us-central1\/operations\//);operationName=operation.name;
    for(let attempt=0;!operation.done;attempt++) { assert.ok(attempt<90,'Settings API create timeout');await new Promise(resolve=>setTimeout(resolve,20000));operation=await api('https://cloudfunctions.googleapis.com/v2/'+operationName);assert.equal(operation.name,operationName); }
    assert.ok(!operation.error,'Settings API create failed');assert.equal(operation.response?.name,RESOURCE);
  }
  sourceGate();saveStage('verify-settings-api-source');
  const fn=describe(NAME);verifyFunction(fn,identity);
  assert.equal(runtimeSourceHash(download(fn.buildConfig.source.storageSource,'settings-api-live').files),runtimeSourceHash(expected),'Settings API source differs');
  verifyTraffic(service(fn),fn.serviceConfig.revision);
  // Public HTTP transport is necessary for Firebase-token authentication. The
  // application still denies anonymous callers and enforces fresh admin profiles.
  const serviceName=fn.serviceConfig.service.split('/').pop();
  assert.equal(serviceName,'messagecopysettings');
  let policy=JSON.parse(cloud(['run','services','get-iam-policy',serviceName,'--project='+PROJECT,'--region='+REGION,'--format=json']));
  if(!policy.bindings?.some(binding=>binding.role==='roles/run.invoker'&&!binding.condition&&binding.members?.includes('allUsers'))) {
    sourceGate();saveStage('allow-authenticated-settings-browser-transport');
    cloud(['run','services','add-iam-policy-binding',serviceName,'--project='+PROJECT,'--region='+REGION,'--member=allUsers','--role=roles/run.invoker','--quiet']);
    policy=JSON.parse(cloud(['run','services','get-iam-policy',serviceName,'--project='+PROJECT,'--region='+REGION,'--format=json']));
  }
  assert.ok(policy.bindings.some(binding=>binding.role==='roles/run.invoker'&&!binding.condition&&binding.members?.includes('allUsers')));
  saveStage('probe-settings-api-boundaries');await boundaries();
  return {name:NAME,revision:fn.serviceConfig.revision,existing,operationName,sourceVerified:true,httpBoundariesVerified:true,isolatedAdminSaveHistoryVerified:true,productionDataWrites:false,transport};
}
module.exports={installApi,createBody,verifyFunction,boundaries,API_FILES};
