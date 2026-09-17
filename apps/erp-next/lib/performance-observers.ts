import { moduleFromPath } from './performance-client-core';
import type { PerformanceMeasurement } from './performance-types';
type Browser = Window & typeof globalThis;
export function requestMetric(input:RequestInfo|URL,init?:RequestInit):string|null{
  try{
    const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
    if(url.hostname==='firestore.googleapis.com')return 'firestore_rest';
    if(['identitytoolkit.googleapis.com','securetoken.googleapis.com'].includes(url.hostname))return 'firebase_auth';
    if(!url.hostname.endsWith('.cloudfunctions.net')||url.pathname==='/performanceTelemetry')return null;
    const endpoint=url.pathname.split('/')[1];
    if(endpoint==='officeBookingAuthority'){
      if(typeof init?.body==='string'&&init.body.length<200000){const body=JSON.parse(init.body);
        if(body.action==='create_appointment')return 'confirm_appointment';
        if(body.action==='check_availability'&&Array.isArray(body.data?.supportSlotSelections)&&body.data.supportSlotSelections.length)return 'support_slot_validation';
      }return 'office_booking';
    }
    if(endpoint==='inventoryAuthority')return 'inventory_api';
    if(endpoint==='fieldOperationsAuthority')return 'field_api';
    if(endpoint==='taskTrackerApi'||endpoint==='taskCheckpointApi')return 'tasks_api';
    return 'api_other';
  }catch{return null;}
}
export function installPerformanceObservers(win:Browser,record:(input:PerformanceMeasurement)=>void,canCollect:()=>boolean){
  const originalFetch=win.fetch;let disposed=false;
  const safeRecord=(factory:()=>PerformanceMeasurement)=>{try{if(!disposed)record(factory());}catch{/* Even a broken timing API cannot affect the ERP response. */}};
  const metricNow=(name:string,value:number,unit:'ms'|'count',error=false)=>safeRecord(()=>({name,module:moduleFromPath(win.location.pathname),value,unit,error}));
  const wrapped:typeof fetch=async(input,init)=>{
    let metric:string|null=null;let startedAt=0;let module='erp';
    try{if(canCollect()){metric=requestMetric(input,init);startedAt=win.performance.now();module=moduleFromPath(win.location.pathname);}}catch{metric=null;}
    let response:Response;
    try{response=await originalFetch.call(win,input,init);}
    catch(error){
      if(metric)safeRecord(()=>{const cancelled=error instanceof Error&&error.name==='AbortError';return{name:cancelled?'request_cancelled':metric!,module,value:cancelled?1:Math.max(0,win.performance.now()-startedAt),unit:cancelled?'count':'ms',error:!cancelled};});
      throw error;
    }
    if(metric)safeRecord(()=>({name:metric!,module,value:Math.max(0,win.performance.now()-startedAt),unit:'ms',error:!response.ok}));
    return response;
  };
  try{win.fetch=wrapped;}catch{/* Passive browser timing remains optional. */}
  const observers:PerformanceObserver[]=[];
  function observe(type:string,callback:(entries:PerformanceEntry[])=>void){
    try{const observer=new win.PerformanceObserver((list)=>{try{if(canCollect()&&!disposed)callback(list.getEntries());}catch{/* optional */}});observer.observe({type,buffered:false});observers.push(observer);}catch{/* Unsupported API is unknown, never synthesized. */}
  }
  observe('longtask',(entries)=>entries.forEach((entry)=>metricNow('long_task',entry.duration,'ms')));
  observe('event',(entries)=>entries.forEach((entry)=>metricNow('interaction_duration',entry.duration,'ms')));
  const onError=()=>metricNow('browser_error',1,'count',true);const onRejection=()=>metricNow('unhandled_rejection',1,'count',true);
  win.addEventListener('error',onError);win.addEventListener('unhandledrejection',onRejection);
  const navigation=()=>{
    try{if(!canCollect())return;const entry=win.performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming|undefined;
      if(!entry||new URL(entry.name).pathname!==win.location.pathname||!entry.loadEventEnd)return;
      metricNow('page_load',entry.loadEventEnd,'ms');metricNow('dom_content_loaded',entry.domContentLoadedEventEnd,'ms');metricNow('ttfb',entry.responseStart,'ms');
      const paint=win.performance.getEntriesByName('first-contentful-paint')[0];if(paint)metricNow('first_contentful_paint',paint.startTime,'ms');
    }catch{/* Full-document metrics never stand in for SPA data-ready metrics. */}
  };
  const timer=win.setTimeout(navigation,3000);
  return()=>{disposed=true;if(win.fetch===wrapped)win.fetch=originalFetch;observers.forEach((observer)=>observer.disconnect());win.clearTimeout(timer);win.removeEventListener('error',onError);win.removeEventListener('unhandledrejection',onRejection);};
}
