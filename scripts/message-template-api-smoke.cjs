'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),http=require('node:http');
const {createRequire}=require('node:module');
const source=path.resolve(process.argv[2]),load=createRequire(path.join(source,'package.json'));
async function main(){
  const {ReferenceDb,response}=require(path.resolve(process.argv[3]));
  const db=new ReferenceDb({'users/owner':{active:true,role:'admin',name:'Example administrator'},'users/office':{active:true,role:'office'}});
  const service=load('./messageCopySettings').createMessageCopySettings({db});
  assert.equal((await service.execute('owner',{action:'list'})).records.length,20);
  await assert.rejects(service.execute('office',{action:'list'}),{code:'admin-required'});
  const input={action:'save',id:'appointment_confirmation',language:'en',fields:{greeting:'Welcome {name}',introduction:'',closing:'Reply for help.'},expectedRevision:0,requestId:'synthetic-release-request'};
  assert.equal((await service.execute('owner',input)).savedRevision,1);
  assert.equal((await service.execute('owner',input)).replayed,true);
  assert.equal(db.records.get('businessSettings/whatsapp/messageCopy/appointment_confirmation_en/history/0000000001').revision,1);
  await assert.rejects(service.execute('owner',{...input,requestId:'synthetic-release-conflict'}),{code:'revision-conflict'});
  const handler=load('./messageCopySettingsHttp').createMessageCopyHandler({db,verifyIdToken:async(token,revoked)=>{assert.equal(revoked,true);return{uid:token};}});
  const denied=response();await handler({method:'POST',body:{action:'list'},get:key=>({'origin':'https://demac-aruba.com','authorization':'Bearer office','content-type':'application/json'})[key]},denied);assert.equal(denied.statusCode,403);
  const mod=load('./messageCopySettingsFunction');assert.equal(typeof mod.messageCopySettings,'function');
  const app=load('express')();app.use(load('express').json());app.all('/settings',mod.messageCopySettings);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const url='http://127.0.0.1:'+server.address().port+'/settings';
    const result=await fetch(url,{method:'POST',headers:{Origin:'https://demac-aruba.com','Content-Type':'application/json'},body:'{"action":"list"}'});
    assert.equal(result.status,401);assert.equal((await result.json()).error,'sign-in-required');
    assert.equal((await fetch(url,{method:'OPTIONS',headers:{Origin:'https://demac-aruba.com'}})).status,204);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  const admin=load('firebase-admin/app');await Promise.all(admin.getApps().map(admin.deleteApp));
  console.log('PASS: settings API exact entrypoint, admin list/save/receipt/history, stale-write and non-admin denial, CORS and anonymous HTTP rejection; synthetic data only.');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
