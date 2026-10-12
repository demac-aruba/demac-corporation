'use strict';
// Read-only observability probe. No deployment, metric writes or function calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {TARGETS}=require('./appointment-finance-prepare.cjs');
async function main(){
  assert.equal(process.env.GITHUB_REPOSITORY,'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF,'refs/heads/fix/appointment-finance-release-20261012');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP||''));
  const run=args=>execFileSync('gcloud',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  const token=run(['auth','print-access-token']).trim();
  const out=path.join(process.env.RUNNER_TEMP,'finance-drain-audit.json');
  const report={sourceSha:process.env.GITHUB_SHA,mode:'read-only',functions:[],stage:'probe'};
  const save=()=>fs.writeFileSync(out,JSON.stringify(report,null,2));
  try{
    const opResponse=await fetch('https://cloudfunctions.googleapis.com/v2/projects/demac-corporation/locations/us-central1/operations?pageSize=1000',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
    assert.equal(opResponse.status,200,'Operation contract read failed');
    const opPage=await opResponse.json();
    report.operationContract=(opPage.operations||[]).filter(op=>Object.keys(TARGETS).some(name=>op.metadata?.target?.endsWith('/functions/'+name))).slice(0,8).map(op=>{
      const request=op.metadata?.requestResource,response=op.response;
      return {name:op.name,target:op.metadata?.target,verb:op.metadata?.verb,done:op.done||false,errorCode:op.error?.code||null,
        requestType:request?.['@type'],requestHasName:typeof request?.name==='string',requestHasFunction:typeof request?.function==='object',requestHasStorageSource:!!request?.buildConfig?.source?.storageSource,
        responseType:response?.['@type'],responseHasName:typeof response?.name==='string',responseHasRevision:typeof response?.serviceConfig?.revision==='string',responseHasStorageSource:!!response?.buildConfig?.source?.storageSource};
    });
    assert.ok(report.operationContract.length,'No scoped operation contract available');save();
    for(const name of Object.keys(TARGETS)){
      const fn=JSON.parse(run(['functions','describe',name,'--gen2','--project=demac-corporation','--region=us-central1','--format=json']));
      const serviceName=fn.serviceConfig.service.split('/').pop();assert.match(serviceName,/^[a-z0-9-]+$/);
      const svc=JSON.parse(run(['run','services','describe',serviceName,'--project=demac-corporation','--region=us-central1','--format=json']));
      const revisions=JSON.parse(run(['run','revisions','list','--service='+serviceName,'--limit=2','--sort-by=~metadata.creationTimestamp','--project=demac-corporation','--region=us-central1','--format=json']));
      const item={name,current:fn.serviceConfig.revision,timeoutSeconds:fn.serviceConfig.timeoutSeconds,
        traffic:(svc.status?.traffic||[]).map(entry=>({revision:entry.revisionName,percent:entry.percent||0,tagged:Boolean(entry.tag)})),revisions:[]};
      for(const revision of revisions){
        const revisionName=revision.metadata.name;assert.match(revisionName,/^[a-z0-9-]+$/);
        const filter=`metric.type="run.googleapis.com/container/instance_count" AND resource.type="cloud_run_revision" AND resource.labels.project_id="demac-corporation" AND resource.labels.location="us-central1" AND resource.labels.service_name="${serviceName}" AND resource.labels.revision_name="${revisionName}"`;
        const params=new URLSearchParams({filter,view:'FULL',pageSize:'1000','interval.startTime':new Date(Date.now()-3600000).toISOString(),'interval.endTime':new Date().toISOString()});
        const response=await fetch('https://monitoring.googleapis.com/v3/projects/demac-corporation/timeSeries?'+params,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
        const observed={name:revisionName,minScale:revision.metadata.annotations?.['autoscaling.knative.dev/minScale']||'0',metricStatus:response.status,series:[]};
        if(response.ok){
          const body=await response.json();assert.ok(!body.nextPageToken,'Metric samples require pagination');
          observed.series=(body.timeSeries||[]).map(series=>({state:series.metric?.labels?.state||null,points:series.points.map(point=>({at:point.interval.endTime,count:Number(point.value.int64Value)}))}));
        }
        item.revisions.push(observed);
      }
      report.functions.push(item);save();console.log(name+': current/superseded metric observations recorded');
    }
    report.stage='complete';save();
  }catch(error){report.error=error.code==='ERR_ASSERTION'?String(error.message).split('\n')[0]:'Read-only observability probe failed';save();console.error(report.error);process.exitCode=1;}
}
main();
