'use strict';
// Functions copies input bytes to function-source.zip; transport is ZIP even
// though the independently retained recovery format remains deterministic tar.gz.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {manifest}=require('./appointment-finance-release-audit.cjs');
const {verifyPrivateBucket,verifyInheritedPolicies,retainedAction,CANARY}=require('./appointment-finance-prepare.cjs');
const BUCKET='gcf-v2-sources-1053571783393-us-central1',PROJECT='demac-corporation';
const stable=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)||typeof v==='string'?v:JSON.stringify(stable(v))).digest('hex');
function createZip(directory,archive){
  // Fixed metadata and sorted entries make retry bytes independent of extraction time.
  const before=manifest(directory);
  execFileSync('python3',['-c',`import pathlib,sys,zipfile,stat
root=pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2],'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9) as z:
 for p in sorted(root.rglob('*')):
  assert not p.is_symlink(), 'Archive symlink'
  if p.is_dir(): continue
  assert p.is_file(), 'Nonregular archive member'
  i=zipfile.ZipInfo(p.relative_to(root).as_posix(),date_time=(1980,1,1,0,0,0));i.create_system=3;i.compress_type=zipfile.ZIP_DEFLATED;i.external_attr=(stat.S_IFREG | stat.S_IMODE(p.stat().st_mode))<<16
  z.writestr(i,p.read_bytes(),compress_type=zipfile.ZIP_DEFLATED,compresslevel=9)
`,directory,archive],{stdio:['ignore','pipe','pipe']});
  const roundtrip=archive+'.extracted';fs.mkdirSync(roundtrip);
  try{execFileSync('unzip',['-q',archive,'-d',roundtrip]);assert.deepEqual(manifest(roundtrip),before,'ZIP changes reviewed files');}
  finally{fs.rmSync(roundtrip,{recursive:true});}
  return {format:'zip',sha256:hash(fs.readFileSync(archive)),fullManifestHash:hash(before),extractionVerified:true};
}
function checkPrivacy(cloud,prepared){
 const bucket=JSON.parse(cloud(['storage','buckets','describe','gs://'+BUCKET,'--format=json']));
 const policy=JSON.parse(cloud(['storage','buckets','get-iam-policy','gs://'+BUCKET,'--format=json']));
 verifyPrivateBucket(bucket,policy);assert.equal(hash(bucket),prepared.recoveryBucketConfigHash);assert.equal(hash(policy),prepared.recoveryBucketPolicyHash);
 let privacy;
 if((bucket.public_access_prevention??bucket.iamConfiguration?.publicAccessPrevention)==='enforced')privacy={mode:'bucket-public-access-prevention'};
 if(!privacy){try{const effective=JSON.parse(cloud(['org-policies','describe','constraints/storage.publicAccessPrevention','--effective','--project='+PROJECT,'--format=json']));const rules=effective.spec?.rules;if(Array.isArray(rules)&&rules.length&&rules.every(r=>r.enforce===true&&!r.condition))privacy={mode:'effective-public-access-prevention',policyHash:hash(effective)};}catch{}}
 if(!privacy){
  const ancestors=JSON.parse(cloud(['projects','get-ancestors',PROJECT,'--format=json']));
  const policies=ancestors.map(a=>{const kind=String(a.type).toLowerCase();assert.ok(['project','folder','organization'].includes(kind));const command=kind==='project'?['projects']:kind==='folder'?['resource-manager','folders']:['organizations'];return JSON.parse(cloud([...command,'get-iam-policy',String(a.id),'--format=json']));});
  verifyInheritedPolicies(ancestors,policies);privacy={mode:'complete-ancestry-iam',levels:ancestors.length,policyHashes:policies.map(hash)};
 }
 assert.deepEqual(privacy,prepared.inheritedPrivacy,'Inherited archive privacy changed');
}
async function retainZip({name,directory,archive,out,prepared,cloud,fetcher=fetch}){
 assert.match(name,/^[a-zA-Z]+$/);assert.match(prepared.sourceSha,/^[a-f0-9]{40}$/);
 const local=path.join(out,name+'-transport.zip'),entry={label:'candidate',...createZip(directory,local),recoverySha256:archive.sha256};
 const object=`codex-release-recovery/appointment-finance/${prepared.sourceSha}/${name}-candidate.zip`,uri=`gs://${BUCKET}/${object}`;
 checkPrivacy(cloud,prepared);
 const canary=path.join(out,'zip-privacy-canary');fs.writeFileSync(canary,CANARY);
 try{cloud(['storage','cp',canary,uri,'--if-generation-match=0','--quiet']);}catch{/* Existing resource must be downloaded and verified below. */}
 let obj=JSON.parse(cloud(['storage','objects','describe',uri,'--format=json']));assert.match(String(obj.generation),/^\d+$/);
 const retrieved=local+'.retrieved';cloud(['storage','cp',uri+'#'+obj.generation,retrieved,'--quiet']);
 const action=retainedAction(fs.readFileSync(retrieved),entry.sha256);
 const deny=async()=>{const response=await fetcher(`https://storage.googleapis.com/${BUCKET}/${object}`,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(response.status,403,'Effective ZIP privacy not proven');};
 await deny();checkPrivacy(cloud,prepared);
 if(action==='replace-canary'){cloud(['storage','cp',local,uri,'--if-generation-match='+obj.generation,'--quiet']);obj=JSON.parse(cloud(['storage','objects','describe',uri,'--format=json']));}
 assert.match(String(obj.generation),/^\d+$/);cloud(['storage','cp',uri+'#'+obj.generation,retrieved,'--quiet']);assert.equal(hash(fs.readFileSync(retrieved)),entry.sha256);
 await deny();checkPrivacy(cloud,prepared);fs.unlinkSync(retrieved);
 const createdAt=obj.creation_time??obj.timeCreated;assert.ok(Number.isFinite(Date.parse(createdAt)),'ZIP creation time missing');
 return {...entry,uri,generation:String(obj.generation),createdAt,privateRetained:true,anonymousAccessDenied:true,reused:action==='reuse'};
}
function sourceVerifier({name,transport,downloadHash}){
 assert.match(name,/^[a-zA-Z]+$/);assert.match(transport.sha256,/^[a-f0-9]{64}$/);
 const created=Date.parse(transport.createdAt);assert.ok(Number.isFinite(created));const cache=new Map();
 return (source,expected,operation)=>{
  if(!source||typeof source.generation!=='string'||!/^\d+$/.test(source.generation))return false;
  if(Object.keys(source).some(k=>!['bucket','object','generation'].includes(k)))return false;
  if(source.bucket===expected.bucket&&source.object===expected.object&&source.generation===expected.generation)return true;
  // A normalized path alone never proves approval. Verify the exact immutable bytes.
  if(source.bucket!==BUCKET||source.object!==name+'/function-source.zip')return false;
  const started=Date.parse(operation?.metadata?.createTime);if(!Number.isFinite(started)||started<created-1000)return false;
  const key=source.bucket+'/'+source.object+'#'+source.generation;
  if(!cache.has(key))cache.set(key,downloadHash(source));
  return cache.get(key)===transport.sha256;
 };
}
module.exports={createZip,checkPrivacy,retainZip,sourceVerifier};
