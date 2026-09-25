'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBrowserClients}=require('./test-support/browser-clients.cjs');
const {createService}=require('./service');
const {transactionStore}=require('./test-support/transaction-store');
test('each isolated browser gets a stable different network identity; arbitrary headers are rejected',()=>{
  const clients=createBrowserClients(),a=clients.register(),b=clients.register();
  assert.notEqual(a,b);assert.equal(clients.address(a),'192.0.2.1');
  assert.equal(clients.address(b),'192.0.2.2');assert.equal(clients.address(a),'192.0.2.1');
  for(const invalid of [undefined,null,'127.0.0.1','192.0.2.1','unregistered'])assert.throws(()=>clients.address(invalid));
});
test('independent journeys retain the exact thirty-request rate limit, recovery window and separation',async()=>{
  const store=transactionStore();let now=120000;
  const service=createService({db:store.db,files:{},infrastructure:{},now:()=>now});
  for(let i=0;i<30;i++)await service.rateLimit('test-client-a');
  await assert.rejects(service.rateLimit('test-client-a'),{code:'rate-limited',status:429});
  await service.rateLimit('test-client-b');
  await assert.rejects(service.rateLimit('test-client-a'),{code:'rate-limited',status:429});
  now+=60000;await service.rateLimit('test-client-a');
});

// Exercise the adapter through the actual HTTP handler. Preflight is not an
// authenticated API operation and must not consume a candidate request budget.
const {createHandler}=require('./http');
function preflight(clients, origin, admin=false) {
  const headers={origin,'access-control-request-method':'POST','access-control-request-headers':admin?'authorization,content-type':'content-type'};
  const req={method:'OPTIONS',ip:clients.requestAddress('OPTIONS',undefined),get:key=>headers[key]};
  const res={headers:{},statusCode:200,body:undefined,
    set(key,value){this.headers[key]=value;return this;},
    status(value){this.statusCode=value;return this;},
    send(value){this.body=value;return this;},json(value){this.body=value;return this;}};
  const handler=createHandler({admin,env:{CAREERS_ALLOWED_ORIGINS:'http://127.0.0.1:4174'},
    service:()=>{throw Error('Preflight must not access the service or rate limiter');},
    auth:{verifyIdToken:()=>{throw Error('Preflight must not authenticate a candidate');}}});
  return handler(req,res).then(()=>res);
}
test('browser-generated preflights without test identity reach the unchanged CORS handler',async()=>{
  const clients=createBrowserClients();
  for(const admin of [false,true]){
    const res=await preflight(clients,'http://127.0.0.1:4174',admin);
    assert.equal(res.statusCode,204);assert.equal(res.body,'');
    assert.equal(res.headers['Access-Control-Allow-Origin'],'http://127.0.0.1:4174');
    assert.equal(res.headers['Access-Control-Allow-Headers'],'Authorization, Content-Type');
    assert.equal(res.headers['Access-Control-Allow-Methods'],'POST, OPTIONS');
  }
});
test('preflight origin rejection is unchanged and does not widen the CORS allowlist',async()=>{
  const clients=createBrowserClients(),res=await preflight(clients,'https://untrusted.example.test');
  assert.equal(res.statusCode,403);assert.equal(res.body.code,'origin-denied');
  assert.equal(res.headers['Access-Control-Allow-Origin'],undefined);
});
test('only OPTIONS is exempt from test identity lookup; real POSTs still require registered identities',()=>{
  const clients=createBrowserClients(),a=clients.register(),b=clients.register();
  assert.equal(clients.requestAddress('POST',a),clients.address(a));
  assert.notEqual(clients.requestAddress('POST',a),clients.requestAddress('POST',b));
  for(const method of ['POST','GET','DELETE','options',''])
    for(const token of [undefined,null,'unregistered'])assert.throws(()=>clients.requestAddress(method,token));
});
