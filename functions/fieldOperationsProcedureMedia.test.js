'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),{Readable}=require('node:stream'),crypto=require('node:crypto');
const {createProcedureMediaStore,validateMediaBytes,handleProcedureMedia}=require('./fieldOperationsProcedureMedia');
const {fixture,lead,helper,outsider}=require('./test-support/fieldProcedureFixture.cjs');
const {createFieldOperationsApi}=require('./fieldOperationsAuthority');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const photo=Buffer.from('/9j/2Q==','base64'); // Deliberately tiny signature fixture, not a codec/playback acceptance image.
function bucket(){const objects=new Map(),events=[];return {objects,events,file:(path,options={})=>({
 async getMetadata(){events.push(['metadata',path,options]);const o=objects.get(path);if(!o||options.generation&&options.generation!==o.generation)throw Object.assign(Error('Not found'),{code:404});return[{size:String(o.bytes.length),generation:o.generation,contentType:o.contentType}];},
 createReadStream(){events.push(['read',path,options]);const o=objects.get(path);if(!o||options.generation!==o.generation)return Readable.from((async function*(){throw Error('Wrong generation');})());return Readable.from([o.bytes]);},
 async save(bytes,opts){events.push(['save',path,opts]);assert.equal(opts.preconditionOpts.ifGenerationMatch,0);if(objects.has(path))throw Object.assign(Error('Already exists'),{code:412});objects.set(path,{bytes:Buffer.from(bytes),contentType:opts.metadata.contentType,generation:'7'});},
 })};}
function reservation(){const path='field-evidence/VISIT-1/procedures/WI-1/test-tech/cap-1';return{captureId:'cap-1',ownerUserId:lead.uid,storagePath:path,manifest:{kind:'photo',contentType:'image/jpeg',sizeBytes:photo.length,sha256:hash(photo),storagePath:path}};}
for(const mime of ['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/webm','video/mp4','video/webm'])test('reject active HTML mislabeled '+mime,()=>assert.throws(()=>validateMediaBytes(Buffer.from('<html><script>doBadThing()</script></html>'),mime.startsWith('image')?'photo':mime.split('/')[0],mime)));
test('generation-guarded upload cannot overwrite an original; exact retry accepted unlinked',async()=>{const b=bucket(),s=createProcedureMediaStore(b),r=reservation();let response=await s.upload(r,photo);assert.equal(response.linked,false);assert.equal(response.generation,'7');assert.equal((await s.upload(r,photo)).replayed,true);
 const original=Buffer.from(b.objects.get(r.storagePath).bytes);await assert.rejects(()=>s.upload(r,Buffer.from([255,216,255,1,255,217])),e=>e.code==='procedure_upload_mismatch');assert.deepEqual(b.objects.get(r.storagePath).bytes,original);assert.ok(b.events.filter(e=>e[0]==='read').every(e=>e[2].generation==='7'));
});
test('conflicting preexisting object and corrupted digest reject without overwrite',async()=>{const b=bucket(),s=createProcedureMediaStore(b),r=reservation();b.objects.set(r.storagePath,{bytes:Buffer.from([255,216,255,3,255,217]),contentType:'image/jpeg',generation:'5'});await assert.rejects(()=>s.upload(r,photo),e=>e.code==='procedure_object_conflict');assert.equal(b.objects.get(r.storagePath).generation,'5');});
test('download is pinned to canonical generation and checked against stored digest',async()=>{const b=bucket(),s=createProcedureMediaStore(b),r=reservation();await s.upload(r,photo);const evidence={...r.manifest,kind:'photo',generation:'7'};assert.deepEqual((await s.read(evidence)).bytes,photo);await assert.rejects(()=>s.read({...evidence,sha256:'f'.repeat(64)}),e=>e.code==='procedure_object_changed');await assert.rejects(()=>s.read({...evidence,generation:'8'}));});
for(const path of ['field-evidence/VISIT-1/other/file','field-evidence/VISIT-1/procedures/WI-1/a/../x','https://evil.invalid/file','public-website/file'])test('reject arbitrary storage path '+path,async()=>{const b=bucket(),s=createProcedureMediaStore(b);await assert.rejects(()=>s.verify(path,'photo'));assert.equal(b.events.length,0);});
test('HTTP media route authorizes before touching bytes and never publishes a permanent URL',async()=>{const f=fixture(),b=bucket(),s=createProcedureMediaStore(b);await f.claim('indoor');const cmd={action:'prepare_media',...await f.current('indoor'),captureId:'cap-1',stepId:'I01',kind:'photo',view:'before',contentType:'image/jpeg',sizeBytes:photo.length,sha256:hash(photo),source:'camera'};await f.mutate(cmd);
 const req={method:'POST',query:{procedureMedia:'upload',visitId:'VISIT-1',interventionId:'WI-1',captureId:'cap-1'},headers:{'content-type':'image/jpeg'},rawBody:photo};
 await assert.rejects(()=>handleProcedureMedia({request:req,identity:outsider,commands:f.commands,store:s}));assert.equal(b.events.length,0);
 await assert.rejects(()=>handleProcedureMedia({request:req,identity:helper,commands:f.commands,store:s}));assert.equal(b.events.length,0);
 const r=await handleProcedureMedia({request:req,identity:lead,commands:f.commands,store:s});assert.equal(r.status,200);assert.equal(r.body.linked,false);assert.equal(r.body.url,undefined);
});
test('actual API action dispatch retains canonical authenticated identity instead of request identity',async()=>{const f=fixture();for(const who of [lead,helper])f.store.put('users',{id:who.uid,active:true,role:who.role,staffId:who.staffId,name:who.name});
 const api=createFieldOperationsApi({db:f.store.db,verifyIdToken:async t=>({uid:t}),procedureCommands:f.commands});
 const r=await api.handle({method:'POST',headers:{authorization:'Bearer '+lead.uid},body:{action:'record_procedure_action',data:{visitId:'VISIT-1',interventionId:'WI-1',identity:helper,requestId:'http-claim-001',command:{action:'claim_part',part:'indoor',expectedPartVersion:0}}}});
 assert.equal(r.status,200);assert.equal(r.body.workflow.parts.indoor.ownerUserId,lead.uid);
 const noauth=await api.handle({method:'POST',headers:{},body:{action:'get_procedure_workspace',data:{visitId:'VISIT-1',interventionId:'WI-1'}}});assert.equal(noauth.status,401);
 const unconfigured=createFieldOperationsApi({db:f.store.db,verifyIdToken:async t=>({uid:t})});const blocked=await unconfigured.handle({method:'POST',headers:{authorization:'Bearer '+lead.uid},body:{action:'get_procedure_workspace',data:{visitId:'VISIT-1',interventionId:'WI-1'}}});assert.equal(blocked.status,503);
});

test('ordinary exact upload retry verifies the original without a second Storage write', async () => {
 const b=bucket(),s=createProcedureMediaStore(b),r=reservation();
 const first=await s.upload(r,photo),second=await s.upload(r,photo);
 assert.equal(first.replayed,false);assert.equal(second.replayed,true);
 assert.equal(second.generation,first.generation);assert.equal(second.sha256,first.sha256);
 assert.equal(b.events.filter(e=>e[0]==='save').length,1);
});
test('preexisting conflicting content is rejected before any attempted Storage write', async () => {
 const b=bucket(),s=createProcedureMediaStore(b),r=reservation();
 b.objects.set(r.storagePath,{bytes:Buffer.from([255,216,255,4,255,217]),contentType:'image/jpeg',generation:'11'});
 await assert.rejects(()=>s.upload(r,photo),e=>e.code==='procedure_object_conflict');
 assert.equal(b.events.filter(e=>e[0]==='save').length,0);assert.equal(b.objects.get(r.storagePath).generation,'11');
});
for(const code of [403,429,503])test('metadata failure '+code+' never becomes permission to upload',async()=>{
 const b=bucket(),original=b.file;b.file=(p,o)=>({...original(p,o),getMetadata:async()=>{throw Object.assign(Error('Injected metadata failure'),{code});}});
 await assert.rejects(()=>createProcedureMediaStore(b).upload(reservation(),photo),e=>e.code===code);
 assert.equal(b.events.filter(e=>e[0]==='save').length,0);
});
test('a missing original during pinned verification is not recreated by the retry',async()=>{
 const b=bucket(),r=reservation();b.objects.set(r.storagePath,{bytes:photo,contentType:'image/jpeg',generation:'7'});
 const original=b.file;b.file=(p,o)=>{const f=original(p,o);return {...f,getMetadata:async()=>{const result=await f.getMetadata();if(!o?.generation)b.objects.delete(p);return result;}};};
 await assert.rejects(()=>createProcedureMediaStore(b).upload(r,photo),e=>e.code===404);
 assert.equal(b.events.filter(e=>e[0]==='save').length,0);
});
test('concurrent first uploads retain the atomic create-only guard and resolve to one original',async()=>{
 const b=bucket(),s=createProcedureMediaStore(b),r=reservation();
 const results=await Promise.all([s.upload(r,photo),s.upload(r,photo)]);
 assert.equal(b.objects.size,1);assert.equal(results.filter(r=>r.replayed).length,1);
 assert.ok(results.every(r=>r.generation==='7'&&r.sha256===hash(photo)&&r.linked===false));
 assert.equal(b.events.filter(e=>e[0]==='save').length,2);
 assert.ok(b.events.filter(e=>e[0]==='save').every(e=>e[2].preconditionOpts.ifGenerationMatch===0));
});
test('a different writer winning after metadata 404 is rejected without overwriting the winner',async()=>{
 const b=bucket(),r=reservation(),original=b.file;
 b.file=(p,o)=>({...original(p,o),save:async(bytes,opts)=>{
  assert.equal(opts.preconditionOpts.ifGenerationMatch,0);
  b.objects.set(p,{bytes:Buffer.from([255,216,255,5,255,217]),contentType:'image/jpeg',generation:'17'});
  throw Object.assign(Error('Another writer won'),{code:412});
 }});
 await assert.rejects(()=>createProcedureMediaStore(b).upload(r,photo),e=>e.code==='procedure_object_conflict');
 assert.equal(b.objects.get(r.storagePath).generation,'17');
});
test('a committed upload with a lost response recovers by verified read rather than duplicate write',async()=>{
 const b=bucket(),r=reservation(),original=b.file;let writes=0;
 b.file=(p,o)=>{const f=original(p,o);return{...f,save:async(bytes,opts)=>{writes++;await f.save(bytes,opts);throw Object.assign(Error('Lost upload response'),{code:503});}};};
 const s=createProcedureMediaStore(b);await assert.rejects(()=>s.upload(r,photo),e=>e.code===503);
 const recovered=await s.upload(r,photo);assert.equal(recovered.replayed,true);assert.equal(recovered.linked,false);assert.equal(recovered.generation,'7');assert.equal(writes,1);
});
