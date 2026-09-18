import assert from 'node:assert/strict';
import { createRegistryTransport, createRegistryWriter, createIntentJournal, RegistryRequestError, minutesLabel, type RegistryRequest } from '../lib/projects/registry-client-core';
import type { RegistryCommand } from '../lib/projects/registry-types';

let passed=0;
async function test(name:string,run:()=>unknown){await run();passed++;console.log(`PASS ${name}`);}
const identity=()=>({uid:'SYNTHETIC-USER',idToken:'SYNTHETIC-TOKEN',expiresAt:Date.now()+3600000});
const endpoint='https://projects.example.test/projectsRegistry';
const result={success:true,projectId:'SYNTHETIC-PROJECT',version:1,changed:true,replayed:false};
const requestId=()=> '00000000-0000-4000-8000-000000000001' as const;
function storage(){const data=new Map<string,string>();return {data,getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);},removeItem:(key:string)=>{data.delete(key);}};}
function good(payload:unknown=result){return new Response(JSON.stringify({success:true,data:payload}),{status:200});}
async function main(){
await test('transport attaches only the current session and disables cookie caching/redirects',async()=>{
 const send=createRegistryTransport({endpoint,identity,fetcher:(async(url,init)=>{assert.equal(String(url),endpoint);assert.equal(init?.cache,'no-store');assert.equal(init?.credentials,'omit');assert.equal(init?.redirect,'error');assert.equal((init?.headers as Record<string,string>).Authorization,'Bearer SYNTHETIC-TOKEN');return good();}) as typeof fetch});
 assert.deepEqual(await send({action:'list_plans',data:{}}),result);
});
await test('expired identity fails without refreshing or sending a request',async()=>{
 const send=createRegistryTransport({endpoint,identity:()=>({...identity(),expiresAt:0}),fetcher:(async()=>{assert.fail('No request');}) as typeof fetch});
 await assert.rejects(send({action:'list_plans',data:{}}),{code:'unauthenticated',uncertain:false});
});
await test('late response for another account is discarded',async()=>{
 let current=identity();const send=createRegistryTransport({endpoint,identity:()=>current,fetcher:(async()=>{current={...current,uid:'OTHER-USER'};return good();}) as typeof fetch});
 await assert.rejects(send({action:'get_plan',data:{projectId:'P'}}),{code:'session_changed',uncertain:true});
});
await test('connection, invalid JSON and missing result remain ambiguous',async()=>{
 for(const fetcher of [async()=>{throw Error('network');},async()=>new Response('not-json'),async()=>new Response('{"success":true}')]){
 const send=createRegistryTransport({endpoint,identity,fetcher:fetcher as typeof fetch});await assert.rejects(send({action:'create_plan',data:{}}),(cause:unknown)=>cause instanceof RegistryRequestError&&cause.uncertain);
 }
});
await test('structured server version conflict is a definite rejection',async()=>{
 const send=createRegistryTransport({endpoint,identity,fetcher:(async()=>new Response(JSON.stringify({success:false,error:{code:'version_conflict',message:'Refresh first',outcome:'rejected'}}),{status:409})) as typeof fetch});
 await assert.rejects(send({action:'edit_metadata',data:{}}),{code:'version_conflict',uncertain:false,status:409});
});
await test('pre-cancelled reads never send; insecure endpoints are rejected',async()=>{
 const controller=new AbortController();controller.abort();const send=createRegistryTransport({endpoint,identity,fetcher:(async()=>{assert.fail();}) as typeof fetch});
 await assert.rejects(send({action:'list_plans',data:{}},controller.signal),{code:'cancelled'});
 assert.throws(()=>createRegistryTransport({endpoint:'http://remote.test/x',identity}),/HTTPS/);
 assert.throws(()=>createRegistryTransport({endpoint:'https://user:pass@remote.test/x',identity}),/Invalid/);
});
await test('oversized commands fail before network and never truncate',async()=>{
 const send=createRegistryTransport({endpoint,identity,fetcher:(async()=>{assert.fail();}) as typeof fetch});
 await assert.rejects(send({action:'preview_legacy_import',data:{raw:'x'.repeat(128*1024)}}),{code:'payload_too_large'});
});
await test('lost-response retry uses the same ID and frozen payload, blocking alternate writes',async()=>{
 const calls:RegistryCommand[]=[];let first=true;const send:RegistryRequest=async<T>(command:RegistryCommand)=>{calls.push(command);if(first){first=false;throw new RegistryRequestError('network','unknown',true);}return result as T;};
 const writer=createRegistryWriter(send,requestId);const patch={name:'ORIGINAL'};
 await assert.rejects(writer.start('edit_metadata',{projectId:'P',expectedVersion:1,patch}));patch.name='CHANGED';
 assert.equal(writer.hasPending(),true);await assert.rejects(writer.start('create_plan',{}),{code:'write_busy'});
 assert.deepEqual(await writer.retry(),result);assert.deepEqual(calls[0],calls[1]);assert.equal((calls[1].data.patch as {name:string}).name,'ORIGINAL');assert.equal(writer.hasPending(),false);
});
await test('definite first rejection permits a reviewed new command',async()=>{
 const writer=createRegistryWriter((async()=>{throw new RegistryRequestError('version_conflict','refresh',false,409);}) as RegistryRequest,requestId);
 await assert.rejects(writer.start('edit_metadata',{}));assert.equal(writer.hasPending(),false);
});
await test('journal restores an exact pending command after reload without automatic execution',async()=>{
 const disk=storage();const journal=createIntentJournal(disk,'SYNTHETIC-USER');let calls=0;
 const first=createRegistryWriter((async()=>{calls++;throw new RegistryRequestError('network','unknown',true);}) as RegistryRequest,requestId,journal);
 await assert.rejects(first.start('create_plan',{name:'Synthetic'}));
 const next=createRegistryWriter((async()=>{calls++;return result;}) as RegistryRequest,requestId,journal);
 assert.equal(calls,1);assert.equal(next.hasPending(),true);await next.retry();assert.equal(calls,2);assert.equal(disk.data.size,0);
});
await test('session journals are user scoped and contain no authentication credentials',async()=>{
 const disk=storage();const journal=createIntentJournal(disk,'USER-A');journal.write({action:'create_plan',requestId:'ORIGINAL-REQ',data:{name:'Synthetic'}});
 assert.equal(createIntentJournal(disk,'USER-B').read(),null);
 const saved=[...disk.data.values()].join('');assert.ok(!saved.includes('idToken'));assert.ok(!saved.includes('refreshToken'));
});
await test('storage unavailable prevents sending, rather than losing retry protection',async()=>{
 let calls=0;const disk=storage();disk.setItem=()=>{throw Error('denied');};const writer=createRegistryWriter((async()=>{calls++;return result;}) as RegistryRequest,requestId,createIntentJournal(disk,'USER-A'));
 await assert.rejects(writer.start('create_plan',{}),{code:'journal_unavailable'});assert.equal(calls,0);assert.equal(writer.hasPending(),false);
});
await test('journal cleanup failure preserves retry identity after a successful server result',async()=>{
 const disk=storage();const remove=disk.removeItem;disk.removeItem=()=>{throw Error('denied');};const writer=createRegistryWriter((async()=>result) as RegistryRequest,requestId,createIntentJournal(disk,'USER-A'));
 await assert.rejects(writer.start('create_plan',{}),{code:'journal_cleanup',uncertain:true});assert.equal(writer.hasPending(),true);disk.removeItem=remove;await writer.retry();assert.equal(writer.hasPending(),false);
});
await test('later permission rejection cannot erase an earlier ambiguous outcome',async()=>{
 let n=0;const writer=createRegistryWriter((async()=>{n++;throw new RegistryRequestError(n===1?'network':'forbidden','error',n===1);}) as RegistryRequest,requestId);
 await assert.rejects(writer.start('create_plan',{}));await assert.rejects(writer.retry());assert.equal(writer.hasPending(),true);
});
await test('corrupt journals fail closed without deleting recovery evidence',()=>{
 const disk=storage();disk.setItem('demac.projects.pending.v1:USER-A','not-json');assert.throws(()=>createIntentJournal(disk,'USER-A').read(),{code:'invalid_pending_request'});assert.equal(disk.data.size,1);
});
await test('unknown and zero measurements remain distinguishable',()=>{assert.equal(minutesLabel(null),'Not reconciled');assert.equal(minutesLabel(0),'0h');assert.equal(minutesLabel(90),'1.5h');});
console.log(`Projects central client: ${passed} scenarios passed; synthetic data only.`);
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
