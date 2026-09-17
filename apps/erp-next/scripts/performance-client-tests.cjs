const test=require('node:test');const assert=require('node:assert/strict');
const Core=require('../.performance-test/lib/performance-client-core.js');
const Observers=require('../.performance-test/lib/performance-observers.js');
const View=require('../.performance-test/lib/performance-view-model.js');
const ServerCore=require('../../../functions/performanceTelemetryCore.js');
const base=Date.UTC(2026,8,16,15,16);
function setup(overrides={}){let time=base;let id=0;const calls=[];const deps={uid:'office',release:'a'.repeat(40),environment:'test',enabled:true,now:()=>time,id:()=>`identity_session_${++id}`,credential:()=>({uid:'office',idToken:'existing'}),visible:()=>true,module:()=> 'scheduling',send:async(action,data)=>{calls.push({action,data:structuredClone(data)});return action==='policy'?{success:true,enabled:true,environment:'test'}:{success:true};},...overrides};return{deps,calls,collector:Core.createCollector(deps),advance:(ms)=>time+=ms};}
const input={name:'support_slot_validation',module:'scheduling',unit:'ms',value:50};
test('client and server use the same closed metric registry',()=>assert.deepEqual(Core.CLIENT_UNITS,ServerCore.UNITS));
test('read-only credential lookup never refreshes, deletes, rewrites or exposes refresh tokens',()=>{
  const raw=JSON.stringify({uid:'office',idToken:'valid',refreshToken:'DO_NOT_EXPOSE',expiresAt:base+60000});
  let writes=0;const storage={getItem:()=>raw,setItem:()=>writes++,removeItem:()=>writes++};
  assert.deepEqual(Core.existingCredential(storage,'office',base),{uid:'office',idToken:'valid'});
  assert.equal(writes,0);assert.equal(Core.existingCredential(storage,'different',base),null);
  assert.equal(Core.existingCredential(storage,'office',base+40000),null);
  assert.equal(Core.existingCredential({getItem(){throw Error('storage blocked');}},'office',base),null);
  assert.equal(Core.existingCredential({getItem:()=>'{invalid'},'office',base),null);
});
test('missing credentials can recover without deadlocking policy or flush',async()=>{
  let valid=false;const f=setup({credential:()=>valid?{uid:'office',idToken:'existing'}:null});
  await f.collector.checkPolicy();valid=true;await f.collector.checkPolicy();
  assert.equal(f.collector.canCollect(),true);f.collector.record(input);valid=false;await f.collector.flush();valid=true;
  f.collector.record(input);await f.collector.flush();assert.equal(f.calls.filter((c)=>c.action==='ingest').length,1);
});
test('lost ACK retries keep immutable batch ID, samples and original timestamps',async()=>{
  const sent=[];let fail=true;const f=setup({send:async(action,data)=>{if(action==='policy')return{success:true,enabled:true,environment:'test'};sent.push(JSON.stringify(data));if(fail){fail=false;throw Error('lost acknowledgement');}return{success:true};}});
  await f.collector.checkPolicy();f.collector.record(input);await f.collector.flush();f.advance(9000);await f.collector.flush();
  assert.equal(sent.length,2);assert.equal(sent[0],sent[1]);assert.equal(JSON.parse(sent[0]).measurements[0].observedAtMs,base);
});
test('telemetry callbacks never throw on storage/network failures and buffering is bounded',async()=>{
  const f=setup();await f.collector.checkPolicy();for(let i=0;i<10000;i++)f.collector.record(input);
  assert.ok(f.collector.stats().queued<=120);assert.ok(f.collector.stats().dropped>0);
  await f.collector.flush();assert.ok(f.calls.find((c)=>c.action==='ingest').data.measurements.length<=80);
});
test('disabled, stopped, expired and changed-user collectors cannot emit',async()=>{
  const f=setup();await f.collector.checkPolicy();f.collector.record(input);f.collector.stop();await f.collector.flush();assert.equal(f.calls.filter((c)=>c.action==='ingest').length,0);
  const other=setup({enabled:false});await other.collector.checkPolicy();assert.equal(other.calls.length,0);
  const changed=setup();await changed.collector.checkPolicy();changed.collector.record(input);changed.deps.credential=()=>({uid:'admin',idToken:'different'});await changed.collector.flush();assert.equal(changed.calls.filter((c)=>c.action==='ingest').length,0);
});
test('HTTP observer preserves exact responses/rejections even if measurement fails',async()=>{
  const response={ok:true,marker:'original'};let now=0;const listeners=new Map();let fn=async()=>response;
  const win={fetch:(...args)=>fn(...args),location:{pathname:'/scheduling'},performance:{now:()=>++now,getEntriesByType:()=>[]},addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n)=>listeners.delete(n),setTimeout:()=>1,clearTimeout:()=>{}};
  const original=win.fetch;const cleanup=Observers.installPerformanceObservers(win,()=>{throw Error('metrics failure');},()=>true);
  assert.equal(await win.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority'),response);
  const operationalError=Error('original request failed');fn=async()=>{throw operationalError;};
  await assert.rejects(win.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority'),(error)=>error===operationalError);
  cleanup();assert.equal(win.fetch,original);assert.equal(listeners.size,0);
  // Mount again after cleanup, as in a Strict Mode effect replay.
  fn=async()=>response;const seen=[];const again=Observers.installPerformanceObservers(win,(m)=>seen.push(m),()=>true);
  await win.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority');assert.equal(seen.length,1);again();assert.equal(win.fetch,original);
});
test('broken timing APIs cannot change an accepted operation',async()=>{
  const accepted={ok:true};let ticks=0;
  const win={fetch:async()=>accepted,location:{pathname:'/scheduling'},performance:{now:()=>{if(++ticks>1)throw Error('clock failure');return 1;},getEntriesByType:()=>[]},addEventListener:()=>{},removeEventListener:()=>{},setTimeout:()=>1,clearTimeout:()=>{}};
  const cleanup=Observers.installPerformanceObservers(win,()=>{},()=>true);
  assert.equal(await win.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority'),accepted);cleanup();
});
test('request attribution is captured at start, cancelled requests are not successes',async()=>{
  const events=[];let release;const win={fetch:()=>new Promise((resolve)=>release=resolve),location:{pathname:'/scheduling'},performance:{now:()=>5,getEntriesByType:()=>[]},addEventListener:()=>{},removeEventListener:()=>{},setTimeout:()=>1,clearTimeout:()=>{}};
  const cleanup=Observers.installPerformanceObservers(win,(m)=>events.push(m),()=>true);
  const request=win.fetch('https://us-central1-demo.cloudfunctions.net/officeBookingAuthority');win.location.pathname='/crm';release({ok:true});await request;assert.equal(events[0].module,'scheduling');cleanup();
  assert.equal(Observers.requestMetric('https://us-central1-demo.cloudfunctions.net/performanceTelemetry'),null);
});
test('UI unavailable/stale states override previously healthy readings',()=>{
  const data={generatedAtMs:base,lastObservedAtMs:base,policy:{enabled:true},health:{status:'healthy',label:'Measured workflows healthy'},metrics:[],truncated:false};
  assert.equal(View.displayHealth(data,'network failed',base).status,'unavailable');
  assert.equal(View.displayHealth(data,'',base+600000).status,'stale');
  assert.equal(View.displayHealth(null,'',base).status,'collecting');
  assert.equal(View.displayHealth({...data,lastObservedAtMs:null},'',base).status,'collecting');
  assert.equal(View.displayHealth({...data,policy:{enabled:false}},'',base).status,'collecting');
});
