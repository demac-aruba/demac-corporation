'use strict';
const assert=require('node:assert/strict');
function reviewedOperation(operation,patch){
 const m=operation.metadata||{},r=m.requestResource;
 if(m.target!==patch.name||m.verb!=='update'||r?.name!==patch.name)return false;
 try{assert.deepEqual(r.buildConfig?.source?.storageSource,patch.buildConfig.source.storageSource);return true;}catch{return false;}
}
function selectOperations(operations,patch){
 const scoped=operations.filter(o=>o.metadata?.target===patch.name);
 assert.ok(scoped.filter(o=>!o.done).every(o=>reviewedOperation(o,patch)),'Unreviewed update is still running');
 const reviewed=scoped.filter(o=>reviewedOperation(o,patch));
 assert.ok(reviewed.filter(o=>!o.done).length<=1,'Ambiguous running source updates');
 return reviewed.sort((a,b)=>Date.parse(b.metadata.createTime)-Date.parse(a.metadata.createTime));
}
function successfulPublication(operation,patch,fn){
 assert.equal(operation.done,true);assert.ok(!operation.error,'Source operation failed');assert.equal(reviewedOperation(operation,patch),true);
 assert.equal(operation.response?.name,patch.name,'Completed operation has no published function');
 assert.equal(operation.response?.serviceConfig?.revision,fn.serviceConfig.revision,'Published revision lacks successful operation provenance');
 assert.deepEqual(operation.response?.buildConfig?.source?.storageSource,patch.buildConfig.source.storageSource,'Published operation source differs');
}
async function settleOperation(operation,{getOperation,wait,record}){
 let attempts=0;
 while(!operation.done){assert.ok(attempts++<90,'Source operation exceeded30minutes');record(operation);await wait(20000);operation=await getOperation(operation.name);}
 record(operation);return operation;
}
// Adapter-driven so lost responses, terminal failures and resume are tested
// without credentials, a real deployment, or any downstream production writes.
async function updateSource({patch,baselineRevision,operations,inspect,publish,getOperation,wait,record}){
 let known=selectOperations(await operations(),patch);
 const active=known.find(o=>!o.done);
 if(active){await settleOperation(active,{getOperation,wait,record});known=selectOperations(await operations(),patch);}
 const last=known[0],recoverable=Boolean(last?.done&&last.error);
 let current=await inspect({allowFailed:recoverable});
 const proof=known.find(o=>o.done&&!o.error&&o.response?.serviceConfig?.revision===current.fn.serviceConfig.revision);
 if(current.fn.state==='ACTIVE'&&current.alreadyApplied&&proof){successfulPublication(proof,patch,current.fn);return current;}
 if(current.fn.state!=='ACTIVE')assert.ok(recoverable&&['FAILED','UNKNOWN'].includes(current.fn.state),'Unclassified function state');
 if(current.alreadyApplied&&!recoverable)assert.fail('Candidate requested source lacks successful publication proof');
 const started=Date.now();record({intent:true,name:patch.name,at:new Date(started).toISOString()});
 let operation;
 try{operation=await publish(patch);}catch(error){
  // Do not blindly repeat a mutation when the response may have been lost.
  for(let attempt=0;attempt<4;attempt++){
   await wait(5000);known=selectOperations(await operations(),patch);
   operation=known.find(o=>Date.parse(o.metadata.createTime)>=started-1000);
   if(operation)break;
  }
  if(!operation)throw error;
 }
 assert.equal(reviewedOperation(operation,patch),true,'PATCH returned an unreviewed operation');
 operation=await settleOperation(operation,{getOperation,wait,record});assert.ok(!operation.error,'Source update failed; retain exact candidate for forward recovery');
 current=await inspect({allowFailed:false});assert.equal(current.fn.state,'ACTIVE');assert.equal(current.alreadyApplied,true);
 assert.notEqual(current.fn.serviceConfig.revision,baselineRevision,'Source update did not produce a new revision');
 successfulPublication(operation,patch,current.fn);return current;
}
module.exports={reviewedOperation,selectOperations,settleOperation,successfulPublication,updateSource};
