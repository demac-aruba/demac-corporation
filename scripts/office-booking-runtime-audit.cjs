'use strict';
// Read-only incident diagnostics. Never print tokens, environment values, request
// bodies, client records or unrestricted application logs. No deployment commands.
const { execFileSync } = require('node:child_process');
const project = 'demac-corporation', region = 'us-central1';
const run = args => JSON.parse(execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5 * 1024 * 1024 }));
const fn = run(['functions', 'describe', 'officeBookingAuthority', '--project='+project, '--region='+region, '--gen2', '--format=json']);
const service = fn.serviceConfig.service.split('/').at(-1);
console.log(JSON.stringify({kind:'function',state:fn.state,updatedAt:fn.updateTime,runtime:fn.buildConfig.runtime,entryPoint:fn.buildConfig.entryPoint,revision:fn.serviceConfig.revision,memory:fn.serviceConfig.availableMemory,timeoutSeconds:fn.serviceConfig.timeoutSeconds,concurrency:fn.serviceConfig.maxInstanceRequestConcurrency,minInstances:fn.serviceConfig.minInstanceCount,maxInstances:fn.serviceConfig.maxInstanceCount,service,conditions:fn.stateMessages}));
const srv = run(['run','services','describe',service,'--project='+project,'--region='+region,'--format=json']);
console.log(JSON.stringify({kind:'service',latestCreated:srv.status.latestCreatedRevisionName,latestReady:srv.status.latestReadyRevisionName,conditions:srv.status.conditions,traffic:srv.status.traffic}));
const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${service}" AND (logName="projects/${project}/logs/run.googleapis.com%2Fvarlog%2Fsystem" OR textPayload:"Memory limit" OR textPayload:"Cannot find module" OR textPayload:"failed to start" OR textPayload:"Startup probe")`;
const logs = run(['logging','read',filter,'--project='+project,'--freshness=4h','--limit=40','--order=desc','--format=json']);
for(const item of logs){
  const message=item.textPayload||item.jsonPayload?.message||'';
  const safeLines=String(message).split('\n').filter(line=>/Memory limit of|Container called exit|STARTUP TCP probe|Starting new instance|failed to start and listen|Cannot find module ['"][.\w/@-]+['"]/.test(line)).map(line=>line.slice(0,700));
  console.log(JSON.stringify({kind:'runtime',at:item.timestamp,severity:item.severity,revision:item.resource?.labels?.revision_name,signals:safeLines}));
}
async function main(){
  const endpoint='https://us-central1-demac-corporation.cloudfunctions.net/officeBookingAuthority';
  for(const origin of ['https://demac-aruba.com','https://www.demac-aruba.com']){
    const start=performance.now();
    const preflight=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},signal:AbortSignal.timeout(20_000)});
    console.log(JSON.stringify({kind:'preflight',origin,status:preflight.status,allowOrigin:preflight.headers.get('access-control-allow-origin'),allowMethods:preflight.headers.get('access-control-allow-methods'),allowHeaders:preflight.headers.get('access-control-allow-headers'),elapsedMs:Math.round(performance.now()-start)}));
  }
  const denied=await fetch(endpoint,{method:'POST',headers:{Origin:'https://demac-aruba.com','Content-Type':'application/json'},body:JSON.stringify({action:'get_appointment_charges',data:{}}),signal:AbortSignal.timeout(20_000)});
  const body=await denied.json().catch(()=>null);
  console.log(JSON.stringify({kind:'unauthenticated-read',status:denied.status,allowOrigin:denied.headers.get('access-control-allow-origin'),code:body?.error?.code}));
}
main().catch(error=>{console.error(error.name+': read-only public probe failed');process.exitCode=1;});
