'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHandler}=require('./http');
function response(){return {statusCode:200,headers:{},body:null,set(k,v){this.headers[k]=v;return this;},status(v){this.statusCode=v;return this;},json(v){this.body=v;return this;},send(v){this.body=v;return this;}};}
function request(headers={},body={action:'settings.get'}){return {method:'POST',body,rawBody:Buffer.from(JSON.stringify(body)),get:k=>headers[k],is:v=>v==='application/json',ip:'127.0.0.1'};}
test('backend disabled, unapproved origins and expired identity fail closed',async()=>{
  const res=response();await createHandler({service:{},auth:{},env:{}})(request(),res);assert.equal(res.statusCode,503);
  const origin=response();await createHandler({service:{},auth:{},env:{DEMAC_CAREERS_BACKEND_ENABLED:'true'}})(request({origin:'https://evil.example'}),origin);assert.equal(origin.statusCode,403);
  const auth=response();await createHandler({service:{},auth:{verifyIdToken:async()=>{throw Error('secret');}},env:{DEMAC_CAREERS_BACKEND_ENABLED:'true'},admin:true})(request({authorization:'Bearer invalid'}),auth);assert.equal(auth.statusCode,401);assert(!JSON.stringify(auth.body).includes('secret'));
});
test('document route checks identity and never serves public file URLs',async()=>{
  let uid;const service={document:async(user)=>{uid=user;return {bytes:Buffer.from('test'),name:'test.pdf',mime:'application/pdf'};}};
  const res=response();await createHandler({service,auth:{verifyIdToken:async()=>({uid:'admin'})},env:{DEMAC_CAREERS_BACKEND_ENABLED:'true'},admin:true})(request({authorization:'Bearer test'},{action:'documents.get',payload:{applicationId:'a',fileId:'b'}}),res);
  assert.equal(uid,'admin');assert.equal(res.statusCode,200);assert.equal(res.headers['X-Content-Type-Options'],'nosniff');assert.match(res.headers['Content-Disposition'],/^attachment/);
});
