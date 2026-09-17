"use strict";
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./performanceTelemetryCore');
const { createPerformanceTelemetryApi } = require('./performanceTelemetryService');

class Store {
  constructor() {
    this.records = new Map(); this.writes = []; this.failCommit = false; this.tail = Promise.resolve();
    for (const [uid,role,active] of [['admin','admin',true],['office','office',true],['inactive','admin',false]]) this.records.set(`users/${uid}`,{role,active});
    for (const name of ['clients','appointments','workOrders','properties','capacityLocks']) this.records.set(`${name}/sentinel`,{untouched:true});
  }
  snap(path) { const data=this.records.get(path); return {exists:data!==undefined, data:() => structuredClone(data), id:path.split('/').pop()}; }
  doc(path) { return {path,get:async() => this.snap(path)}; }
  collection(name) {
    const filters=[]; let cap=Infinity; let order;
    const query={ doc:(id) => this.doc(`${name}/${id}`),where:(field,op,value) => {filters.push([field,op,value]);return query;},orderBy:(field) => {order=field;return query;},limit:(n) => {cap=n;return query;},get:async() => {
      let records=[...this.records.entries()].filter(([path,data]) => path.startsWith(`${name}/`) && filters.every(([key,op,value]) => op==='>=' ? data[key]>=value : data[key]<=value));
      if (order) records.sort((a,b) => a[1][order]-b[1][order]);
      const docs=records.slice(0,cap).map(([path])=>this.snap(path)); return {docs,size:docs.length};
    }}; return query;
  }
  runTransaction(task) {
    const execute=async()=>{
      const writes=[]; let writing=false;
      const tx={get:async(ref)=>{assert.equal(writing,false,'read after write');return this.snap(ref.path);},getAll:async(...refs)=>{assert.equal(writing,false,'read after write');return refs.map((ref)=>this.snap(ref.path));},set:(ref,data)=>{writing=true;assert.ok(ref.path.startsWith('performanceTelemetry'),'business mutation');writes.push([ref.path,structuredClone(data)]);}};
      const result=await task(tx);
      if(this.failCommit) throw new Error('simulated commit failure');
      writes.forEach(([path,data])=>{this.records.set(path,data);this.writes.push(path);}); return result;
    };
    const result=this.tail.then(execute);this.tail=result.catch(()=>{});return result;
  }
}
const SHA='a'.repeat(40);
const SECOND='b'.repeat(40);
const BASE=Date.UTC(2026,8,16,15,16);
function fixture() {
  const db=new Store(); let time=BASE;
  const api=createPerformanceTelemetryApi({db,enabled:true,environment:'test',now:()=>time,verifyIdToken:async(token)=>({uid:token,role:'admin'})});
  return {db,api,advance:(ms)=>{time+=ms;},request:async(action,data={},uid='admin')=>api.handle({method:'POST',headers:uid?{authorization:`Bearer ${uid}`}:{},body:{action,data}})};
}
function batch(id='batch_identity_0001',value=100,at=BASE) {
  return {version:2,environment:'test',batchId:id,sessionId:'session_identity_0001',release:SHA,module:'scheduling',visible:true,measurements:[{name:'schedule_data_ready',module:'scheduling',unit:'ms',value,observedAtMs:at}]};
}

test('pooled histogram p95 is not max or average of release percentiles',()=>{
  const first=C.aggregate(Array.from({length:99},()=>batch().measurements[0]),SHA);
  const second=C.aggregate(batch('batch_identity_0002',5000).measurements,SECOND);
  assert.equal(C.pool([...Object.values(first),...Object.values(second)])[0].p95,100);
  assert.equal(C.pool([...Object.values(first),...Object.values(second)])[0].p99,100);
  assert.equal(C.pool(Object.values(second))[0].p95,5000);
});
test('histogram edges, empty and overflow cannot manufacture a 60s reading',()=>{
  assert.equal(C.percentile({},.95),null);
  assert.equal(C.serialize(Object.values(C.aggregate(batch('batch_identity_0002',120000).measurements,SHA))[0]).p95,120000);
  assert.equal(C.normalizeMeasurement({...batch().measurements[0],value:600001}),null);
  assert.equal(C.normalizeMeasurement({...batch().measurements[0],value:'10'}),null);
  assert.throws(()=>C.addMetric(C.emptyMetric('page_load','crm',SHA,'ms'),C.emptyMetric('firestore_rest','crm',SHA,'ms')),/Unlike/);
});
test('no-data, count-only, stale and unavailable are never healthy',()=>{
  assert.equal(C.health([],BASE).status,'collecting');
  const countOnly=C.pool(Object.values(C.aggregate([{...batch().measurements[0],name:'route_view',unit:'count'}],SHA)));
  assert.equal(C.health(countOnly,BASE).status,'collecting');
  const enough=C.pool(Object.values(C.aggregate(Array.from({length:20},()=>batch().measurements[0]),SHA)));
  assert.equal(C.health(enough,BASE).status,'healthy');
  assert.equal(C.health(enough,BASE+600000).status,'stale');
  assert.equal(C.health(enough,BASE,true).status,'unavailable');
});
test('authentication and authorization use active profile, not forged claims or body',async()=>{
  const f=fixture();
  assert.equal((await f.request('dashboard',{},null)).status,401);
  assert.equal((await f.request('dashboard',{},'inactive')).status,403);
  assert.equal((await f.request('dashboard',{role:'admin',uid:'admin'},'office')).status,403);
  assert.equal((await f.request('set_collection',{enabled:false,expectedVersion:0},'office')).status,403);
  assert.equal((await f.request('dashboard')).status,200);
  assert.equal((await f.request('ingest',batch(),'office')).status,200);
});
test('ingest -> storage -> dashboard returns real pooled values and zero business writes',async()=>{
  const f=fixture();const original=[...f.db.records.entries()].filter(([path])=>!path.startsWith('users/'));
  await f.request('ingest',{...batch(),customerName:'PRIVATE',route:'/crm/PRIVATE?phone=PRIVATE'});
  const result=await f.request('dashboard');
  assert.equal(result.status,200); assert.equal(result.body.metrics[0].p95,100);assert.equal(result.body.metrics[0].count,1);
  assert.ok(!JSON.stringify([...f.db.records.entries()]).includes('PRIVATE'));
  for(const [path,data] of original) assert.deepEqual(f.db.records.get(path),data);
  assert.ok(f.db.writes.every((path)=>path.startsWith('performanceTelemetry')));
});
test('lost acknowledgement retries are atomic, replay-safe and actor scoped',async()=>{
  const f=fixture();const data=batch();
  // The first response is deliberately discarded after the server commits.
  await f.request('ingest',data,'office');
  const retries=await Promise.all(Array.from({length:8},()=>f.request('ingest',data,'office')));
  assert.ok(retries.every((result)=>result.body.replayed===true));
  assert.equal((await f.request('dashboard')).body.metrics[0].count,1);
  assert.equal((await f.request('ingest',{...data,measurements:batch('another_identity_001',500).measurements},'office')).status,409);
  await f.request('ingest',data,'admin');
  assert.equal((await f.request('dashboard')).body.metrics[0].count,2);
});
test('failed commit writes neither receipt nor rollup, then retry counts once',async()=>{
  const f=fixture();f.db.failCommit=true;
  assert.equal((await f.request('ingest',batch())).status,500);
  assert.equal(f.db.writes.length,0);
  f.db.failCommit=false;assert.equal((await f.request('ingest',batch())).status,200);
  assert.equal((await f.request('dashboard')).body.metrics[0].count,1);
});
test('observation time survives delayed ingestion and release filters stay independent',async()=>{
  const f=fixture();const at=BASE-120000;
  await f.request('ingest',batch('batch_delayed_identity',100,at));
  await f.request('ingest',{...batch('batch_second_identity',5000),release:SECOND});
  const result=(await f.request('dashboard',{release:SHA})).body;
  assert.equal(result.metrics[0].p95,100);
  assert.equal(result.timeline[0].atMs,Math.floor(at/900000)*900000);
  assert.equal(result.metrics[0].lastObservedAtMs,at);
  assert.equal(result.releaseMetrics.length,2);
});
test('server kill switch rejects ingestion atomically and resumes without business changes',async()=>{
  const f=fixture();const first=await f.request('set_collection',{enabled:false,expectedVersion:0});assert.equal(first.status,200);
  const before=f.db.writes.length;
  assert.equal((await f.request('ingest',batch())).body.error.code,'disabled');assert.equal(f.db.writes.length,before);
  assert.equal((await f.request('set_collection',{enabled:true,expectedVersion:0})).status,409);
  assert.equal((await f.request('set_collection',{enabled:true,expectedVersion:1})).status,200);
  assert.equal((await f.request('ingest',batch())).status,200);
});
test('transport, dimensional, environment and user rate budgets are enforced',async()=>{
  const f=fixture();
  assert.equal((await f.request('ingest',{...batch(),environment:'production'})).status,400);
  assert.equal((await f.request('ingest',{...batch(),measurements:[{...batch().measurements[0],name:'arbitrary_customer_name'}]})).status,400);
  assert.equal((await f.request('ingest',batch('batch_ancient_identity',1,BASE-1000000))).status,400);
  assert.equal((await f.request('ingest',{...batch(),extra:'x'.repeat(61000)})).status,413);
  for(let index=0;index<12;index++) assert.equal((await f.request('ingest',batch(`batch_rate_identity_${index}`))).status,200);
  assert.equal((await f.request('ingest',batch('batch_rate_identity_13'))).status,429);
  const spec=C.windowSpec(43200,BASE);assert.equal(spec.size,86400000);assert.ok((spec.to-spec.from)/spec.size*4<130);
});
module.exports={Store,batch,fixture};
