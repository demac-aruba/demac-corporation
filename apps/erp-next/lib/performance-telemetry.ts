'use client';

import { firebaseClientConfig } from './firebase/client-config';
import { createCollector, existingCredential, moduleFromPath, TelemetryError, type Credential } from './performance-client-core';
import type { PerformanceDashboard, PerformanceMeasurement } from './performance-types';
export type { PerformanceDashboard, PerformanceDashboardMetric, PerformanceMeasurement, PerformanceUnit } from './performance-types';
export { moduleFromPath } from './performance-client-core';
let collector:ReturnType<typeof createCollector>|null=null;
function credential(uid:string|null=null):Credential|null {
  try { return existingCredential(window.sessionStorage,uid,Date.now()); } catch { return null; }
}
export function performanceClock() {
  try { return typeof window === 'undefined' ? 0 : performance.now(); } catch { return 0; }
}
async function transport(action:string,data:Record<string,unknown>,auth:Credential,externalSignal?:AbortSignal):Promise<unknown> {
  if (!firebaseClientConfig.projectId) throw new TelemetryError(503,'not_configured','Telemetry is not configured.');
  const controller=new AbortController(); const abort=()=>controller.abort();
  if (externalSignal?.aborted) controller.abort();
  externalSignal?.addEventListener('abort',abort,{once:true});
  const timer=window.setTimeout(abort,8000);
  try {
    const response=await fetch(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/performanceTelemetry`,{
      method:'POST',headers:{Authorization:`Bearer ${auth.idToken}`,'Content-Type':'application/json'},
      body:JSON.stringify({action,data}),signal:controller.signal,keepalive:action==='ingest',
    });
    const body=await response.json().catch(()=>({}));
    if (!response.ok) throw new TelemetryError(response.status,body.error?.code||'unavailable',body.error?.message||'Telemetry is unavailable.');
    return body;
  } finally { window.clearTimeout(timer); externalSignal?.removeEventListener('abort',abort); }
}
export function startPerformanceSession(uid:string) {
  collector?.stop();
  const current=createCollector({uid,release:process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA||'',
    environment:process.env.NEXT_PUBLIC_PERFORMANCE_ENVIRONMENT||'preview',enabled:process.env.NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED==='true',
    now:Date.now,id:()=>crypto.randomUUID(),credential:()=>credential(uid),visible:()=>document.visibilityState==='visible',
    module:()=>moduleFromPath(window.location.pathname),send:transport});
  collector=current;
  return {...current,stop:()=>{current.stop();if(collector===current)collector=null;}};
}
export function recordPerformanceMeasurement(input:PerformanceMeasurement) {
  try { collector?.record(input); } catch { /* Never affect the measured operation. */ }
}
export async function flushPerformanceTelemetry() {
  try { await collector?.flush(); } catch { /* Never affect the measured operation. */ }
}
export function recordDuration(name:string,module:string,startedAt:number,options:{error?:boolean;route?:string}={}) {
  try { const end=performanceClock();if(startedAt>0&&end>=startedAt)recordPerformanceMeasurement({name,module,value:end-startedAt,unit:'ms',error:options.error}); } catch { /* optional */ }
}
export async function measurePerformance<T>(name:string,module:string,task:()=>Promise<T>):Promise<T> {
  const start=performanceClock();
  try { const result=await task();recordDuration(name,module,start);return result; }
  catch (error) { recordDuration(name,module,start,{error:true});throw error; }
}
export async function getPerformanceDashboard(rangeMinutes=60,release='all',metric='schedule_data_ready',signal?:AbortSignal):Promise<PerformanceDashboard> {
  const auth=credential();
  if(!auth)throw new TelemetryError(401,'session_unavailable','An existing valid ERP session is required. Monitoring will not renew or alter your session.');
  const result=await transport('dashboard',{rangeMinutes,release,metric,module:'scheduling'},auth,signal) as PerformanceDashboard;
  if(!result||result.success!==true||result.version!==2||!Array.isArray(result.metrics)||!Array.isArray(result.timeline)||!Array.isArray(result.releases)||!Array.isArray(result.releaseMetrics)||!result.policy||!result.health||!result.baseline||!result.activeModules)throw new TelemetryError(503,'invalid_response','Telemetry returned an incompatible response. No health status can be certified.');
  return result;
}
export async function setPerformanceCollection(enabled:boolean,expectedVersion:number) {
  const auth=credential();if(!auth)throw new TelemetryError(401,'session_unavailable','A valid administrator session is required.');
  return transport('set_collection',{enabled,expectedVersion},auth);
}
