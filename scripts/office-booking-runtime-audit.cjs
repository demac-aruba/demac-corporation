'use strict';
// Read-only incident diagnostics. Never print tokens, environment values, request
// bodies, client records or unrestricted application logs. No deployment commands.
const { execFileSync } = require('node:child_process');
const project = 'demac-corporation', region = 'us-central1';
const run = args => JSON.parse(execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 5 * 1024 * 1024 }));
function failureKind(error) {
  const text=String(error?.stderr||'')+' '+String(error?.message||'');
  return /PERMISSION_DENIED|permission.*denied|does not have permission/i.test(text)?'permission_denied':/not found|NOT_FOUND/i.test(text)?'not_found':'unavailable';
}
const tag = value => typeof value === 'string' && /^[A-Za-z0-9_:-]{1,100}$/.test(value) ? value : undefined;
const conditions = values => (values || []).map(item => ({type:tag(item.type),status:tag(item.status),reason:tag(item.reason),severity:tag(item.severity)}));
function signals(message) {
  const text=String(message), result=[];
  const memory=/Memory limit of ([\d.]+)\s*(MiB|GiB|MB|GB).*?with ([\d.]+)\s*(MiB|GiB|MB|GB)/.exec(text);
  if(memory)result.push({type:'memory_limit',limit:Number(memory[1]),limitUnit:memory[2],used:Number(memory[3]),usedUnit:memory[4]});
  else if(/Memory limit/.test(text))result.push({type:'memory_limit'});
  for(const [type,pattern] of [['container_exit',/Container called exit/],['startup_probe',/STARTUP TCP probe|Startup probe/],['new_instance',/Starting new instance/],['listen_failure',/failed to start and listen/],['missing_module',/Cannot find module/]])if(pattern.test(text))result.push({type});
  return result;
}
async function main(){
  const fn = run(['functions', 'describe', 'officeBookingAuthority', '--project='+project, '--region='+region, '--gen2', '--format=json']);
  const service = fn.serviceConfig.service.split('/').at(-1);
  if(service!=='officebookingauthority')throw Error('Unexpected service identity');
  console.log(JSON.stringify({kind:'function',state:fn.state,updatedAt:fn.updateTime,runtime:fn.buildConfig.runtime,entryPoint:fn.buildConfig.entryPoint,revision:fn.serviceConfig.revision,memory:fn.serviceConfig.availableMemory,timeoutSeconds:fn.serviceConfig.timeoutSeconds,concurrency:fn.serviceConfig.maxInstanceRequestConcurrency,minInstances:fn.serviceConfig.minInstanceCount,maxInstances:fn.serviceConfig.maxInstanceCount,service,conditions:conditions(fn.stateMessages)}));
  const srv = run(['run','services','describe',service,'--project='+project,'--region='+region,'--format=json']);
  console.log(JSON.stringify({kind:'service',latestCreated:srv.status.latestCreatedRevisionName,latestReady:srv.status.latestReadyRevisionName,conditions:conditions(srv.status.conditions),traffic:(srv.status.traffic||[]).map(item=>({revision:item.revisionName,percent:item.percent}))}));
  const filter = `resource.type="cloud_run_revision" AND resource.labels.service_name="${service}" AND (logName="projects/${project}/logs/run.googleapis.com%2Fvarlog%2Fsystem" OR textPayload:"Memory limit" OR textPayload:"Cannot find module" OR textPayload:"failed to start" OR textPayload:"Startup probe")`;
  let logs=[];
  try { logs = run(['logging','read',filter,'--project='+project,'--freshness=4h','--limit=40','--order=desc','--format=json']); }
  catch(error){ console.log(JSON.stringify({kind:'diagnostic-limit',stage:'runtime-signals',reason:failureKind(error)})); }
  for(const item of logs)console.log(JSON.stringify({kind:'runtime',at:item.timestamp,severity:tag(item.severity),revision:item.resource?.labels?.revision_name,signals:signals(item.textPayload||item.jsonPayload?.message||'')}));
  const gateway='https://us-central1-demac-corporation.cloudfunctions.net/officeBookingAuthority';
  const endpoints=[gateway,fn.serviceConfig.uri];
  for(const endpoint of endpoints){
  for(const origin of ['https://demac-aruba.com','https://www.demac-aruba.com']){
    const start=performance.now();
    const preflight=await fetch(endpoint,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},signal:AbortSignal.timeout(20_000)});
    console.log(JSON.stringify({kind:'preflight',endpoint,origin,status:preflight.status,allowOrigin:preflight.headers.get('access-control-allow-origin'),allowMethods:preflight.headers.get('access-control-allow-methods'),allowHeaders:preflight.headers.get('access-control-allow-headers'),elapsedMs:Math.round(performance.now()-start)}));
  }
  const denied=await fetch(endpoint,{method:'POST',headers:{Origin:'https://demac-aruba.com','Content-Type':'application/json'},body:JSON.stringify({action:'get_appointment_charges',data:{}}),signal:AbortSignal.timeout(20_000)});
  const body=await denied.json().catch(()=>null);
  console.log(JSON.stringify({kind:'unauthenticated-read',endpoint,status:denied.status,allowOrigin:denied.headers.get('access-control-allow-origin'),code:tag(body?.error?.code)}));
  }
}
module.exports={signals,conditions,failureKind};
if(require.main===module)main().catch(()=>{console.error('Read-only runtime audit failed; raw command output intentionally withheld.');process.exitCode=1;});
