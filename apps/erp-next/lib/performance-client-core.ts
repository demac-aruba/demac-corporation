import type { Observation, PerformanceMeasurement, Policy, TelemetryBatch } from './performance-types';

// Pure client state machine: injected dependencies; telemetry never owns authentication.
export const SESSION_KEY = 'demac.erp-next.firebase.session.v1';
export type Credential = { uid: string; idToken: string };
export function existingCredential(storage: Pick<Storage, 'getItem'>, expectedUid: string | null, now: number): Credential | null {
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (typeof value.uid !== 'string' || !value.uid || (expectedUid !== null && value.uid !== expectedUid)) return null;
    if (typeof value.idToken !== 'string' || !value.idToken || !Number.isFinite(value.expiresAt) || value.expiresAt <= now + 30_000) return null;
    return { uid: value.uid, idToken: value.idToken };
  } catch { return null; }
}
export const CLIENT_UNITS: Record<string, 'ms' | 'count'> = {
  route_view:'count', session_heartbeat:'count', telemetry_dropped:'count', page_load:'ms', dom_content_loaded:'ms', ttfb:'ms', first_contentful_paint:'ms', long_task:'ms', interaction_duration:'ms', browser_error:'count', unhandled_rejection:'count', firestore_rest:'ms', firebase_auth:'ms', office_booking:'ms', support_slot_validation:'ms', confirm_appointment:'ms', inventory_api:'ms', field_api:'ms', tasks_api:'ms', api_other:'ms', request_cancelled:'count', schedule_data_ready:'ms', schedule_reference_data:'ms', schedule_work_orders:'ms', schedule_work_order_fallback:'count', schedule_load_error:'count', schedule_appointment_count:'count',
};
const MODULES = new Set(['dashboard','kpis','scheduling','crm','inventory','work-orders','field','employees','projects','tasks','catalog','communications','communication-center','customer-ai','marketing','finance','payroll','payments','banking','invoices','expenses','purchasing','vans','tools','reports','settings','performance','recruitment','website-manager','access-control','audit','leads','opportunities','estimates','maintenance','technicians','executive-ai','automations','integrations','escalations','erp']);
export function moduleFromPath(path: string) {
  const segments = (path || '/').split(/[?#]/)[0].split('/').filter(Boolean);
  if (segments[0] === 'settings' && segments.includes('performance')) return 'performance';
  const first = segments[0] || 'dashboard';
  return MODULES.has(first) ? first : 'erp';
}
export function normalizeObservation(input: PerformanceMeasurement, now: number): Observation | null {
  if (!input || !Object.hasOwn(CLIENT_UNITS, input.name) || CLIENT_UNITS[input.name] !== input.unit || !MODULES.has(input.module)) return null;
  if (!Number.isFinite(input.value) || input.value < 0 || input.value > 600000) return null;
  return { name:input.name, module:input.module, value:input.value, unit:input.unit, error:input.error === true, observedAtMs:now };
}
export class TelemetryError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
type Dependencies = {
  uid:string; release:string; environment:string; enabled:boolean;
  now:()=>number; id:()=>string; credential:()=>Credential|null; visible:()=>boolean; module:()=>string;
  send:(action:'policy'|'ingest',data:Record<string,unknown>,credential:Credential,signal:AbortSignal)=>Promise<unknown>;
};
export function createCollector(deps: Dependencies) {
  let stopped=false; let permitted=false; let policyAt=0; let dropped=0;
  let queue:Observation[]=[];
  let pending:{batch:TelemetryBatch;attempts:number;retryAt:number}|null=null;
  let flight:Promise<void>|null=null; let policyFlight:Promise<void>|null=null;
  const controllers=new Set<AbortController>();
  let sessionId=''; try {sessionId=deps.id();} catch {stopped=true;}
  const validConfig=deps.enabled && /^[a-f0-9]{40}$/.test(deps.release) && ['production','preview','test'].includes(deps.environment);
  const canCollect=()=>{try{return !stopped && validConfig && permitted && deps.now()-policyAt<90000;}catch{return false;}};
  function discard(){dropped+=queue.length+(pending?.batch.measurements.length||0);queue=[];pending=null;}
  function record(input:PerformanceMeasurement){
    try{if(!canCollect())return;const item=normalizeObservation(input,deps.now());if(!item)return;
      if(queue.length>=120){queue.shift();dropped+=1;}queue.push(item);
    }catch{/* Never affect a measured operation. */}
  }
  async function checkPolicy(){
    if(stopped||!validConfig)return;
    if(policyFlight)return policyFlight;
    const controller=new AbortController();controllers.add(controller);
    // Deferring the body prevents a synchronous early return from leaving a settled
    // promise permanently in the in-flight guard (e.g. missing credentials).
    const work=Promise.resolve().then(async()=>{
      try{
        const auth=deps.credential();
        if(!auth||auth.uid!==deps.uid){permitted=false;discard();return;}
        const result=await deps.send('policy',{},auth,controller.signal) as Policy;
        if(stopped||controller.signal.aborted)return;
        permitted=result.success===true && result.enabled===true && result.environment===deps.environment;
        policyAt=deps.now();if(!permitted)discard();
      }catch{permitted=false;discard();}
    });
    policyFlight=work;
    try{await work;}finally{controllers.delete(controller);if(policyFlight===work)policyFlight=null;}
  }
  async function flush(){
    if(stopped||!canCollect())return;
    if(flight)return flight;
    const controller=new AbortController();controllers.add(controller);
    const work=Promise.resolve().then(async()=>{
      try{
        const auth=deps.credential();
        if(!auth||auth.uid!==deps.uid){discard();return;}
        const at=deps.now();
        dropped+=queue.filter((m)=>at-m.observedAtMs>600000).length;
        queue=queue.filter((m)=>at-m.observedAtMs<=600000);
        if(pending&&at-pending.batch.measurements[0].observedAtMs>600000){dropped+=pending.batch.measurements.length;pending=null;}
        if(!pending){
          const measurements=queue.splice(0,79);
          if(dropped){measurements.push({name:'telemetry_dropped',module:deps.module(),value:Math.min(600000,dropped),unit:'count',error:false,observedAtMs:at});dropped=0;}
          if(!measurements.length)return;
          pending={batch:{version:2,environment:deps.environment,batchId:deps.id(),sessionId,release:deps.release,visible:deps.visible(),module:deps.module(),measurements},attempts:0,retryAt:0};
        }
        if(at<pending.retryAt)return;
        const current=pending;current.attempts+=1;
        const result=await deps.send('ingest',current.batch as unknown as Record<string,unknown>,auth,controller.signal) as {success?:boolean};
        if(stopped)return;
        if(result.success!==true)throw new TelemetryError(500,'invalid_response','Invalid telemetry acknowledgement.');
        if(pending===current)pending=null;
      }catch(error){
        if(stopped||!pending)return;
        const retryable=!(error instanceof TelemetryError)||error.status>=500||error.status===429;
        if(!retryable||pending.attempts>=3){
          if(error instanceof TelemetryError&&[401,403,409].includes(error.status))permitted=false;
          dropped+=pending.batch.measurements.length;pending=null;
        }else pending.retryAt=deps.now()+2000*2**pending.attempts;
      }
    });
    flight=work;
    try{await work;}catch{/* Background failure is contained. */}finally{controllers.delete(controller);if(flight===work)flight=null;}
  }
  function stop(){stopped=true;permitted=false;queue=[];pending=null;for(const controller of controllers){try{controller.abort();}catch{/* optional */}}controllers.clear();}
  return{record,flush,checkPolicy,stop,canCollect,stats:()=>({queued:queue.length,pending:pending?.batch.measurements.length||0,dropped,stopped,permitted})};
}
