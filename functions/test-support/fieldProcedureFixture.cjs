'use strict';
// Synthetic deterministic transaction fixture. This is not an emulator or hosted backend.
const {createFieldAuditAppender}=require('../fieldOperationsAudit');
const {createProcedureWorkflowCommands}=require('../fieldOperationsProcedureWorkflow');
const {initialWorkflow,protocolForService,PROTOCOL_ID}=require('../fieldOperationsServiceProtocol');
const copy=v=>v===undefined?undefined:structuredClone(v);
function transactionalStore(seed={}){
  const data=new Map(Object.entries(seed).map(([name,rows])=>[name,new Map(rows.map(r=>[r.id,copy(r)]))]));
  const ensure=n=>{if(!data.has(n))data.set(n,new Map());return data.get(n);};
  const snapshot=(name,key)=>({id:key,exists:ensure(name).has(key),data:()=>copy(ensure(name).get(key))});
  const query=(name,filters=[])=>({kind:'query',name,filters,where:(k,op,v)=>query(name,[...filters,[k,op,v]]),get:async()=>read(query(name,filters))});
  function ref(name,key){return{kind:'doc',name,id:key,get:async()=>snapshot(name,key)};}
  function read(t){if(t.kind==='doc')return snapshot(t.name,t.id);if(t.kind==='query')return {docs:[...ensure(t.name)].filter(([,v])=>t.filters.every(([k,op,w])=>{if(op!=='==')throw Error('Unsupported test operator');return v[k]===w;})).map(([k])=>snapshot(t.name,k))};throw Error('Unsupported test read');}
  let tail=Promise.resolve(),failNextCommit=false;const commits=[];
  const db={collection:n=>({doc:k=>ref(n,k),where:(...f)=>query(n,[f]),get:async()=>read(query(n))}),runTransaction:fn=>{
    const run=tail.then(async()=>{const writes=[];let wrote=false;const tx={
      get:async t=>{if(wrote)throw Error('Firestore transaction read after write');return read(t);},
      create:(r,v)=>{wrote=true;if(ensure(r.name).has(r.id))throw Error('Existing document');writes.push(['create',r,copy(v)]);},
      update:(r,v)=>{wrote=true;if(!ensure(r.name).has(r.id))throw Error('Missing document');writes.push(['update',r,copy(v)]);},
      set:(r,v)=>{wrote=true;writes.push(['create',r,copy(v)]);},
    };const value=await fn(tx);if(failNextCommit&&writes.length){failNextCommit=false;throw Error('Injected atomic commit failure');}
    for(const [type,r,v] of writes)ensure(r.name).set(r.id,type==='update'?{...ensure(r.name).get(r.id),...v}:v);commits.push(writes.map(([type,r,v])=>({type,collection:r.name,id:r.id,value:copy(v)})));return value;
    });tail=run.catch(()=>{});return run;
  }};
  return {db,commits,get:(n,k)=>copy(ensure(n).get(k)),all:n=>copy([...ensure(n).values()]),put:(n,v)=>ensure(n).set(v.id,copy(v)),failNext:()=>{failNextCommit=true;}};
}
const at='2026-09-24T12:00:00.000Z';
const lead={uid:'test-tech',staffId:'staff-tech',name:'DEMO Technician',role:'technician',operations:false};
const helper={uid:'test-helper',staffId:'staff-helper',name:'DEMO Helper',role:'technician',operations:false};
const office={uid:'test-office',staffId:null,name:'DEMO Office',role:'operations',operations:true};
const outsider={uid:'test-other',staffId:'staff-other',name:'DEMO Unassigned',role:'technician',operations:false};
function service(){return{id:'service-1',itemType:'Servicio',name:'Synthetic catalog service',category:'Maintenance',durationMinutes:60,active:true,serviceDefinition:{version:1,bookingCode:'standard_service',duration:{minutes:60}},fieldExecutionDefinition:{version:1,procedureProtocolId:PROTOCOL_ID}};}
function seed(){return{
 workOrders:[{id:'WO-1',appointmentId:'APT-1',clientId:'CLIENT-1',propertyId:'PROPERTY-1',date:'2026-09-24',status:'En proceso',technicianIds:['staff-tech','staff-helper']}],
 workVisits:[{id:'VISIT-1',fieldAuthorityVersion:1,workOrderId:'WO-1',appointmentId:'APT-1',clientId:'CLIENT-1',propertyId:'PROPERTY-1',scheduledScopeSnapshot:{appointmentId:'APT-1',capturedAt:at,estimatedUnitCount:1,workLines:[{id:'line-1',presetId:'standard_service',label:'Synthetic planned service',quantity:1,durationMinutes:60}]},status:'in_progress',participatingStaffIds:['staff-tech','staff-helper'],requiresSecondVisit:false,arrivedAt:at,startedAt:at,createdAt:at,createdByUserId:lead.uid,updatedAt:at,updatedByUserId:lead.uid,version:3}],
 visitAssets:[{id:'VA-1',fieldAuthorityVersion:1,visitId:'VISIT-1',workOrderId:'WO-1',clientId:'CLIENT-1',propertyId:'PROPERTY-1',assetId:'AC-1',sequence:1,locationLabel:'Synthetic room',source:'existing_asset',status:'identified',addedOnSite:false,createdAt:at,createdByUserId:lead.uid,updatedAt:at,updatedByUserId:lead.uid,version:1}],
 workInterventions:[{id:'WI-1',fieldAuthorityVersion:1,visitId:'VISIT-1',workOrderId:'WO-1',clientId:'CLIENT-1',propertyId:'PROPERTY-1',visitAssetId:'VA-1',assetId:'AC-1',plannedWorkLineId:'line-1',serviceCatalogItemId:'service-1',interventionType:'Synthetic service',origin:'planned',requestedBy:'office',status:'in_progress',performedByStaffIds:[],startedAt:at,createdAt:at,createdByUserId:lead.uid,updatedAt:at,updatedByUserId:lead.uid,version:2,procedureWorkflow:initialWorkflow(protocolForService(service()))}],
 services:[service()],
};}
function fixture(options={}){
 const store=transactionalStore({...seed(),...options.seed}),revoked=new Set(),objects=new Map();let count=0,storageCalls=0;
 const resolveAssignment=async({identity})=>({assigned:!revoked.has(identity.uid)&&[lead.uid,helper.uid,office.uid].includes(identity.uid),responsibility:identity.uid===lead.uid?'lead':identity.uid===helper.uid?'helper':identity.operations?'office':'unassigned',source:'direct_staff',readOnly:false});
 const appender=createFieldAuditAppender({db:store.db});
 const commands=createProcedureWorkflowCommands({db:store.db,resolveAssignment,appendAuditInTransaction:options.appendAuditInTransaction||appender,now:()=>new Date(Date.parse(at)+count++*1000).toISOString(),verifyStoredMedia:options.verifyStoredMedia|| (async(path)=>{storageCalls++;if(!objects.has(path))throw Error('Object unavailable');return copy(objects.get(path));})});
 const input=(identity=lead)=>({identity,visitId:'VISIT-1',interventionId:'WI-1'});
 let request=0;
 const mutate=(command,identity=lead,requestId)=>commands.mutate({...input(identity),command,requestId:requestId||`synthetic-request-${++request}`});
 const read=(identity=lead)=>commands.read(input(identity));
 async function current(part,identity=part==='indoor'?lead:helper){const b=await read(identity);return {part,expectedPartVersion:b.workflow.parts[part].version,expectedSafetyRevision:b.workflow.safety.revision};}
 async function claim(part,who=part==='indoor'?lead:helper){const b=await read(who);return mutate({action:'claim_part',part,expectedPartVersion:b.workflow.parts[part].version},who);}
 async function save(part,stepId,extra={},who=part==='indoor'?lead:helper){return mutate({action:'save_step',...await current(part,who),stepId,complete:true,...extra},who);}
 async function photo(part,stepId,view,who=part==='indoor'?lead:helper,extra={}){
   const captureId=`synthetic-capture-${++request}`,sha256=require('crypto').createHash('sha256').update(captureId).digest('hex');
   const reservation=await mutate({action:'prepare_media',...await current(part,who),captureId,stepId,kind:'photo',view,contentType:'image/jpeg',sizeBytes:20,sha256,source:'camera',...extra},who);
   const r=reservation.workflow.pendingCaptures[captureId];objects.set(r.storagePath,{sha256,contentType:'image/jpeg',sizeBytes:20,generation:'1'});
   return mutate({action:'commit_media',captureId},who);
 }
 return {store,commands,input,read,mutate,current,claim,save,photo,objects,revoked,resolveAssignment,appender,get storageCalls(){return storageCalls;}};
}
module.exports={transactionalStore,fixture,lead,helper,office,outsider,seed,service,at};
