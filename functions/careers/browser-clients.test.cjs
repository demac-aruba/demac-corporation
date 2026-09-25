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
