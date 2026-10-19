'use strict';
// Read-only permission inspection. No role grants, account creation or source deployment.
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const PROJECT='demac-corporation';
const PERMISSIONS=['iam.serviceAccounts.create','iam.serviceAccounts.get','iam.serviceAccounts.list','iam.serviceAccounts.actAs','resourcemanager.projects.getIamPolicy','resourcemanager.projects.setIamPolicy','serviceusage.services.get','serviceusage.services.enable','cloudfunctions.functions.create','cloudfunctions.functions.update','datastore.indexes.create','datastore.indexes.update','datastore.entities.get','datastore.entities.create','cloudscheduler.jobs.create','cloudscheduler.jobs.run','monitoring.timeSeries.list','logging.logEntries.list'];
async function main(){
  assert.equal(process.env.GITHUB_REPOSITORY,'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF,'refs/heads/chore/whatsapp-monitor-access-20261019');
  const run=args=>execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const token=run(['auth','print-access-token']);
  const result={mode:'read-only',productionWrites:false,sourceSha:process.env.GITHUB_SHA,principal:run(['auth','list','--filter=status:ACTIVE','--format=value(account)'])};
  const api=async(url,body)=>{
    const response=await fetch(url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const data=await response.json();return {response,data};
  };
  const check=await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:testIamPermissions`,{permissions:PERMISSIONS});
  result.permissionCheckStatus=check.response.status;
  if(check.response.ok){result.granted=PERMISSIONS.filter(p=>check.data.permissions?.includes(p));result.missing=PERMISSIONS.filter(p=>!check.data.permissions?.includes(p));}
  const usage=await api(`https://serviceusage.googleapis.com/v1/projects/1053571783393/services/iam.googleapis.com`);
  result.iamApi={httpStatus:usage.response.status,state:usage.data.state||null,errorStatus:usage.data.error?.status||null,reasons:(usage.data.error?.details||[]).map(x=>x.reason).filter(Boolean)};
  const account=await api(`https://iam.googleapis.com/v1/projects/${PROJECT}/serviceAccounts/demac-messaging-health-monitor@${PROJECT}.iam.gserviceaccount.com`);
  result.monitorAccount={httpStatus:account.response.status,exists:account.response.ok,errorStatus:account.data.error?.status||null,reasons:(account.data.error?.details||[]).map(x=>x.reason).filter(Boolean)};
  const monitoring=await api('https://serviceusage.googleapis.com/v1/projects/1053571783393/services/monitoring.googleapis.com');
  result.monitoringApi={httpStatus:monitoring.response.status,state:monitoring.data.state||null,errorStatus:monitoring.data.error?.status||null};
  const policy=await api(`https://cloudresourcemanager.googleapis.com/v1/projects/${PROJECT}:getIamPolicy`,{options:{requestedPolicyVersion:3}});
  result.monitorRoles={httpStatus:policy.response.status,bindings:(policy.data.bindings||[]).filter(b=>b.members?.includes('serviceAccount:demac-messaging-health-monitor@'+PROJECT+'.iam.gserviceaccount.com')).map(b=>({role:b.role,conditional:Boolean(b.condition)}))};
  result.indexInspection=[];
  for(const suffix of ['whatsappOutboundQueue/indexes?pageSize=100','whatsappOutboundQueue/indexes','-/indexes?pageSize=100']) {
    const indexes=await api('https://firestore.googleapis.com/v1/projects/demac-corporation/databases/(default)/collectionGroups/'+suffix);
    result.indexInspection.push({suffix,httpStatus:indexes.response.status,errorCode:indexes.data.error?.status||null,errorMessage:String(indexes.data.error?.message||'').slice(0,500),returnedCount:(indexes.data.indexes||[]).length,nextPage:Boolean(indexes.data.nextPageToken),queueIndexes:(indexes.data.indexes||[]).filter(x=>x.name?.includes('/collectionGroups/whatsappOutboundQueue/')).map(x=>({state:x.state,queryScope:x.queryScope,fields:x.fields}))});
  }
  fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'whatsapp-monitor-access.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
}
if(require.main===module)main().catch(()=>{console.error('Read-only monitor access inspection failed.');process.exitCode=1;});
