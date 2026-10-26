'use strict';
// Read-only production metadata/log audit. Never reads or writes employee documents.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const PROJECT='demac-corporation';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
async function main(){
  assert.equal(process.env.GITHUB_REPOSITORY,'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF,'refs/heads/fix/attendance-web-transaction-20261025');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP||''));
  const report={sourceSha:process.env.GITHUB_SHA,productionWrites:false,employeeDocumentReads:false};
  const token=execFileSync('gcloud',['auth','print-access-token'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  async function api(url,body){
    const r=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    if(!r.ok)return {denied:true,httpStatus:r.status};return r.json();
  }
  const base='https://firebaserules.googleapis.com/v1/projects/'+PROJECT;
  const release=await api(base+'/releases/cloud.firestore');
  if(release.denied) report.rules=release;
  else {
    assert.ok(release.rulesetName.startsWith('projects/'+PROJECT+'/rulesets/'));
    const rules=await api('https://firebaserules.googleapis.com/v1/'+release.rulesetName);
    if(rules.denied)report.rules=rules;
    else {
      assert.equal(rules.source.files.length,1);
      report.rules={matchesRepository:hash(rules.source.files[0].content)===hash(fs.readFileSync('firestore.rules')),sourceHash:hash(rules.source.files[0].content),releaseTime:release.updateTime};
    }
  }
  const logs=await api('https://logging.googleapis.com/v2/entries:list?fields=entries(timestamp,protoPayload(methodName,status(code))),nextPageToken',{
    resourceNames:['projects/'+PROJECT],pageSize:50,orderBy:'timestamp desc',
    filter:'resource.labels.project_id="'+PROJECT+'" AND protoPayload.serviceName="firestore.googleapis.com" AND protoPayload.methodName="google.firestore.v1.Firestore.BeginTransaction" AND protoPayload.status.code=7 AND timestamp>="2026-10-25T23:55:00Z"'
  });
  report.deniedBeginTransactions=logs.denied?logs:{entries:(logs.entries||[]).map(e=>({timestamp:e.timestamp,method:e.protoPayload?.methodName,code:e.protoPayload?.status?.code})),moreAvailable:Boolean(logs.nextPageToken)};
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'attendance-web-save-audit.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
main().catch(()=>{console.error('Read-only attendance metadata/log audit failed; no production document operations were performed.');process.exitCode=1;});
