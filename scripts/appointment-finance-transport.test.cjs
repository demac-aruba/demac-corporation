'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {createZip,retainZip,sourceVerifier}=require('./appointment-finance-transport.cjs');
const stable=v=>v&&typeof v==='object'?Array.isArray(v)?v.map(stable):Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(stable(v))).digest('hex');
function files(){const out=fs.mkdtempSync(path.join(os.tmpdir(),'finance-zip-')),directory=path.join(out,'source');fs.mkdirSync(directory);fs.mkdirSync(path.join(directory,'nested'));fs.writeFileSync(path.join(directory,'package.json'),'{"main":"bootstrap.js"}\n');fs.writeFileSync(path.join(directory,'bootstrap.js'),'module.exports=42;\n');fs.writeFileSync(path.join(directory,'nested','binary'),Buffer.from([0,1,255]));return {out,directory};}
test('ZIP has deterministic bytes and preserves every reviewed file, including binary content',()=>{
 const f=files();try{const first=createZip(f.directory,path.join(f.out,'one.zip'));fs.utimesSync(path.join(f.directory,'bootstrap.js'),new Date(),new Date());const second=createZip(f.directory,path.join(f.out,'two.zip'));assert.deepEqual(first,second);assert.equal(fs.readFileSync(path.join(f.out,'one.zip')).subarray(0,4).toString('hex'),'504b0304');fs.symlinkSync('/etc/passwd',path.join(f.directory,'bad'));assert.throws(()=>createZip(f.directory,path.join(f.out,'bad.zip')),/symlink/);}finally{fs.rmSync(f.out,{recursive:true});}
});
test('normalized storage names require exact immutable ZIP bytes and a valid operation time',()=>{
 const digest='b'.repeat(64),source={bucket:'gcf-v2-sources-1053571783393-us-central1',object:'inventoryAuthority/function-source.zip',generation:'22'},expected={...source,object:'private/approved.zip',generation:'11'};let reads=0;
 const verify=sourceVerifier({name:'inventoryAuthority',transport:{sha256:digest,createdAt:'2026-10-12T23:20:00Z'},downloadHash:()=>{reads++;return digest;}}),op={metadata:{createTime:'2026-10-12T23:20:01Z'}};
 assert.equal(verify(source,expected,op),true);assert.equal(verify(source,expected,op),true);assert.equal(reads,1);
 for(const bad of [{...source,generation:''},{...source,generation:22},{...source,bucket:'unrelated'},{...source,object:'other/function-source.zip'},{...source,sourceUploadUrl:'https://elsewhere'}])assert.equal(verify(bad,expected,op),false);
 assert.equal(verify(source,expected,{metadata:{createTime:'2026-10-12T23:19:00Z'}}),false);
 assert.equal(verify(source,expected,{metadata:{}}),false);
 const wrong=sourceVerifier({name:'inventoryAuthority',transport:{sha256:digest,createdAt:'2026-10-12T23:20:00Z'},downloadHash:()=> 'c'.repeat(64)});assert.equal(wrong(source,expected,op),false);
});
function storageFixture(f,status=403){
 const bucket={uniform_bucket_level_access:true},policy={bindings:[]},prepared={sourceSha:'a'.repeat(40),recoveryBucketConfigHash:hash(bucket),recoveryBucketPolicyHash:hash(policy),inheritedPrivacy:{mode:'complete-ancestry-iam',levels:1,policyHashes:[hash(policy)]}};
 let stored,generation=0,privateWrites=0;
 const cloud=args=>{
  if(args[0]==='org-policies')throw Error('Use complete IAM ancestry');
  if(args[0]==='projects')return JSON.stringify(args[1]==='get-ancestors'?[{type:'project',id:'demac-corporation'}]:policy);
  if(args[1]==='buckets')return JSON.stringify(args[2]==='describe'?bucket:policy);
  if(args[1]==='objects')return JSON.stringify({generation:String(generation),creation_time:'2026-10-12T23:20:00Z'});
  assert.equal(args[1],'cp');const from=args[2],to=args[3];
  if(from.startsWith('gs://')){assert.ok(stored);fs.writeFileSync(to,stored);return '';}
  const match=args.find(a=>a.startsWith('--if-generation-match='));assert.equal(match,'--if-generation-match='+generation);
  const bytes=fs.readFileSync(from);stored=bytes;generation++;if(bytes.subarray(0,2).toString()==='PK')privateWrites++;return '';
 };
 return {prepared,cloud,fetcher:async()=>({status}),counts:()=>({generation,privateWrites}),corrupt:()=>{stored=Buffer.from('different private bytes');}};
}
test('private ZIP retention uses canary/CAS, round-trip bytes and idempotent reuse',async()=>{
 const f=files(),s=storageFixture(f),args={...f,...s,name:'inventoryAuthority',archive:{sha256:'c'.repeat(64)}};
 try{const first=await retainZip(args);const second=await retainZip(args);assert.equal(first.generation,second.generation);assert.equal(first.sha256,second.sha256);assert.equal(second.reused,true);assert.deepEqual(s.counts(),{generation:2,privateWrites:1});s.corrupt();await assert.rejects(retainZip(args),/different contents/);assert.equal(s.counts().privateWrites,1);}finally{fs.rmSync(f.out,{recursive:true});}
});
test('effective public access stops retention before any private ZIP is uploaded',async()=>{
 const f=files(),s=storageFixture(f,200);try{await assert.rejects(retainZip({...f,...s,name:'inventoryAuthority',archive:{sha256:'c'.repeat(64)}}),/privacy/);assert.equal(s.counts().privateWrites,0);}finally{fs.rmSync(f.out,{recursive:true});}
});
