'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const C=require('./whatsappMonitorCore');const {createMonitorCloud}=require('./whatsappMonitorCloud');const {boundedReader}=require('./whatsappMonitorService');const {packageMonitor}=require('./whatsappMonitorPackage.cjs');const {alertPlan}=require('./whatsappMonitorAlertPlan.cjs');
const at=Date.parse('2026-10-19T12:06:00Z');const base={at,transport:{available:true,lastSuccessAtMs:at-10000}};
const record=(patch={})=>({id:'test-message',notificationType:'appointment-confirmation',status:'queued',createdAt:new Date(at-360000),...patch});
test('healthy needs fresh positive transport evidence; errors, absence and clock skew stay visible',()=>{
  assert.equal(C.evaluate(base).status,'healthy');
  for(const transport of [{},{available:true,lastSuccessAtMs:at-600000},{available:true,lastSuccessAtMs:at+120000},{available:true,lastSuccessAtMs:at-10000,lastErrorAtMs:at}])assert.notEqual(C.evaluate({...base,transport}).status,'healthy');
  assert.equal(C.evaluate({...base,coverage:['read_budget']}).status,'unknown');
});
test('failed sends, stalled queues and missing generated messages are distinct',()=>{
  const r=C.evaluate({...base,queue:[record(),record({id:'failed',status:'failed'})],missing:[{id:'missing',flow:'technicians',dueAtMs:at-300000}]});
  assert.deepEqual(r.incidents.map(x=>x.code).sort(),['not_generated','queue_stalled','send_failed']);assert.equal(r.counts.affected,3);
});
test('partial bundle counts one record and respects recent progress, retry and valid leases',()=>{
  for(const patch of [{messages:[{},{}],messageIndex:1,completedAt:new Date(at-10000)},{retryAfterIso:new Date(at+30000).toISOString()},{status:'processing',createdAt:new Date(at-30000),leaseUntil:new Date(at+600000)}])assert.equal(C.evaluate({...base,queue:[record(patch)]}).counts.affected,0);
  const r=C.evaluate({...base,queue:[record({messages:[{},{}],messageIndex:1})]});assert.equal(r.counts.affected,1);assert.equal(r.queue[0].completedParts,1);
  assert.equal(C.evaluate({...base,queue:[record({status:'processing',leaseUntil:new Date(at-120000)})]}).incidents[0].code,'ack_overdue');
});
test('old cutover records, previous dates and preactivation records cannot become active work',()=>{
  const r=C.evaluate({...base,policy:{startedAtMs:at-100000},queue:[record({status:'cancelled',cancellationReason:C.DISCARD_REASON}),record({id:'prior-date',scheduleDate:'2026-10-18'}),record({id:'preactivation'})],missing:[{id:'old',flow:'clients',dueAtMs:at-360000}]});assert.equal(r.counts.affected,0);assert.equal(r.counts.historical,2);assert.equal(r.status,'healthy');
});
test('dependency ordering reports the blocked root once and unknown dependencies explicitly',()=>{
  const parent=record({id:'parent',notificationType:'van-daily-schedule'});const child=record({id:'child',dependsOnQueueId:'parent'});
  assert.equal(C.evaluate({...base,queue:[parent,child]}).counts.affected,1);
  assert.equal(C.evaluate({...base,queue:[child]}).incidents[0].code,'dependency_unknown');
  assert.equal(C.evaluate({...base,queue:[{...parent,to:'other'},child]}).incidents.some(x=>x.code==='dependency_unknown'),true);
  const freshChild={...child,createdAt:new Date(at-120000)};
  assert.equal(C.evaluate({...base,policy:{startedAtMs:at-180000},queue:[parent,freshChild]}).incidents[0].code,'dependency_unknown','old queued dependency cannot hide a new blockage');
});
test('confirmed counter requires terminal ACK today; private payloads never leave evaluator',()=>{
  const r=C.evaluate({...base,queue:[record({status:'sent',completedAt:new Date(at),text:'SECRET',to:'PRIVATE',errorMessage:'TOKEN'}),record({id:'old',status:'sent',completedAt:new Date(at-86400000)})]});assert.equal(r.counts.confirmed,1);assert.equal(r.counts.pending,0);assert.doesNotMatch(JSON.stringify(r),/SECRET|PRIVATE|TOKEN/);assert.equal(r.notifications.deliveryStatus,'not_observed');
});
test('daily generation absence and late/incomplete coverage never appear healthy',()=>{
  assert.equal(C.evaluate({...base,daily:{required:true,dueAtMs:at-300000,batchPresent:false}}).incidents[0].code,'schedule_not_run');
  const r=C.evaluate({...base,queue:Array.from({length:101},(_,i)=>record({id:String(i)}))});assert.ok(r.coverage.includes('display_limit'));assert.equal(r.incidents[0].count,101);assert.equal(r.incidents[0].items.length,100);
});
test('bounded reads stop further network requests after the budget and preserve explicit limits',async()=>{
  let calls=0;let limit;const source={limit(n){limit=n;return this;},async get(){calls++;return{docs:[{},{}]};}};const reader=boundedReader({collection:()=>source},2);
  await reader.collection('safe').limit(2).get();await assert.rejects(reader.collection('safe').get(),/budget/);assert.equal(calls,1);assert.equal(limit,2);
});
test('Google adapter uses only fixed endpoints, structured bounded logs and aggregate metrics',async()=>{
  const calls=[];const cloud=createMonitorCloud({projectId:'demo-demac-health',getToken:async()=>'synthetic',fetchImpl:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{ok:true,status:200,json:async()=>({entries:[{timestamp:new Date(at-10000).toISOString()}]})};}});
  const transport=await cloud.readTransport(at);assert.equal(transport.lastSuccessAtMs,at-10000);await cloud.publishSignals(C.evaluate(base));assert.equal(calls.length,3);assert.ok(calls.slice(0,2).every(x=>x.body.pageSize===1&&x.body.orderBy==='timestamp desc'));assert.equal(calls[2].body.timeSeries.length,3);assert.doesNotMatch(JSON.stringify(calls[2].body),/workOrder|recipient|phone/);
  assert.throws(()=>createMonitorCloud({projectId:'https://evil.test'}));
});
test('cloud API failures redact provider responses',async()=>{
  const cloud=createMonitorCloud({projectId:'demo-demac-health',getToken:async()=>'synthetic',fetchImpl:async()=>({ok:false,text:async()=>'SECRET'})});await assert.rejects(cloud.readTransport(at),error=>!/SECRET/.test(error.message));
});
test('standalone package exports monitoring only and refuses repository overwrite',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'demac-monitor-'));try{const dest=packageMonitor(path.join(tmp,'source'));assert.ok(!fs.existsSync(path.join(dest,'bootstrap.js')));assert.match(fs.readFileSync(path.join(dest,'index.js'),'utf8'),/whatsappMonitor/);assert.throws(()=>packageMonitor(dest),/empty/);assert.throws(()=>packageMonitor(__dirname),/outside/);assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dest,'package.json'))).dependencies).sort(),['firebase-admin','firebase-functions']);}finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
test('external alert plan requires explicit verified channels and monitors its own failure',()=>{
  assert.throws(()=>alertPlan('demo-demac-health',[]));assert.throws(()=>alertPlan('demo-demac-health',['projects/other-project/notificationChannels/123']));const plan=alertPlan('demo-demac-health',['projects/demo-demac-health/notificationChannels/123']);assert.equal(plan.length,4);assert.equal(plan[2].conditions[0].conditionAbsent.duration,'300s');assert.match(plan[3].conditions[0].conditionMatchedLog.filter,/messaging-observer/);
});
test('isolated monitor package includes the explicitly registered message catalog dependency',()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'demac-monitor-copy-'));
  try {
    const dest=packageMonitor(path.join(tmp,'source'));
    const catalog=JSON.parse(fs.readFileSync(path.join(dest,'data/message-copy-catalog.json'),'utf8'));
    assert.ok(catalog.some(item=>item.id==='appointment_confirmation'));
    assert.ok(catalog.some(item=>item.id==='van_work_order'));
    assert.ok(!fs.existsSync(path.join(dest,'messageCopySettingsFunction.js')));
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
});
