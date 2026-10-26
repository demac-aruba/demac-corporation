'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { auditRules, publishRules, hash, BASE, RELEASE } = require('./employee-overnight-rules.cjs');
const { verifyDelta, FILES } = require('./employee-overnight-audit.cjs');
const baseline = execFileSync('git',['show','8327da2c4eef7cf9f07d2ab54100838069a83712:firestore.rules'],{encoding:'utf8'});
const candidate = fs.readFileSync('firestore.rules','utf8');
function fixture({lost=false,deny=false,drift=false}={}) {
  let source=baseline, release={name:RELEASE,rulesetName:'projects/demac-corporation/rulesets/baseline',updateTime:'baseline-time'};
  const calls=[];
  return {calls, api:async(url,method='GET',body)=>{
    calls.push({url,method,body});
    if(method==='GET'&&url===BASE+RELEASE) return {...release};
    if(method==='GET') return {source:{files:[{name:'firestore.rules',content:url.endsWith('/candidate')?candidate:source}]}};
    if(method==='POST') {if(drift)release.updateTime='external-change';return {name:'projects/demac-corporation/rulesets/candidate'};}
    assert.equal(method,'PATCH');assert.equal(url,BASE+RELEASE);
    assert.deepEqual(body,{release:{name:RELEASE,rulesetName:'projects/demac-corporation/rulesets/candidate'},updateMask:'rulesetName'});
    if(deny)throw Error('Cloud API PATCH HTTP 403');
    release={...body.release,updateTime:'published'};source=candidate;
    if(lost)throw Error('Response lost');return {...release};
  }};
}
test('read-only audit bounds Rules delta to attendance and rejects live/source drift',async()=>{
  const f=fixture();const audit=await auditRules(f.api,candidate,baseline);
  assert.equal(audit.candidateHash,hash(candidate));assert.ok(f.calls.every(c=>c.method==='GET'));
  await assert.rejects(auditRules(f.api,candidate.replace('match /vanMaintenanceLogs','match /anotherCollection'),baseline));
  await assert.rejects(auditRules(f.api,candidate,baseline+' '));
});
test('Rules publication reconciles lost response and rerun is read-only',async()=>{
  for(const lost of [false,true]){
    const f=fixture({lost});const audit=await auditRules(f.api,candidate,baseline);let gates=0;const records=[];
    const args={api:f.api,candidate,audit,sourceGate:()=>gates++,record:r=>records.push(r)};
    const result=await publishRules(args);assert.equal(result.stage,'complete');assert.equal(result.responseReconciled,lost);assert.equal(gates,3);
    const count=f.calls.length;assert.equal((await publishRules(args)).alreadyApplied,true);assert.ok(f.calls.slice(count).every(c=>c.method==='GET'));
    assert.ok(records.some(r=>r.stage==='publish-intent'));
  }
});
test('Rules drift, rejected publication and unreviewed candidate never trigger rollback or retry',async()=>{
  for(const options of [{deny:true},{drift:true}]){
    const f=fixture(options);const audit=await auditRules(f.api,candidate,baseline);
    await assert.rejects(publishRules({api:f.api,candidate,audit,sourceGate:()=>{},record:()=>{}}));
    assert.equal(f.calls.filter(c=>c.method==='PATCH').length,options.deny?1:0);
    assert.ok(!f.calls.some(c=>c.method==='DELETE'));
  }
  const f=fixture();const audit=await auditRules(f.api,candidate,baseline);const count=f.calls.length;
  await assert.rejects(publishRules({api:f.api,candidate:candidate+' ',audit,sourceGate:()=>{},record:()=>{}}));assert.equal(f.calls.length,count);
});
test('only two reviewed runtime files may change and source publication contract remains intact',()=>{
  const before=Object.fromEntries([...FILES,'bootstrap.js','index.js','package.json','package-lock.json'].map(f=>[f,'old']));
  const after={...before,...Object.fromEntries(FILES.map(f=>[f,'new']))};verifyDelta(before,after);
  assert.throws(()=>verifyDelta(before,{...after,'package.json':'new'}));
  const old=fs.readFileSync('scripts/employee-split-release.cjs','utf8');const next=fs.readFileSync('scripts/employee-overnight-release.cjs','utf8');
  const patch=s=>s.slice(s.indexOf('function patchFor'),s.indexOf('async function main'));
  assert.equal(patch(next),patch(old));
  assert.match(next,/updateMask=buildConfig\.source/);assert.match(next,/employee-overnight-audit-20261026.json/);
  assert.ok(next.indexOf('await publishRules')>next.indexOf('await updateSource'));
  assert.match(fs.readFileSync('.github/workflows/employee-overnight-release.yml','utf8'),/group: field-operations-authority-production/);
});
