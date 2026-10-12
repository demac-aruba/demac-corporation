'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {sourcePatch,verifyTraffic,verifyPrepared,tariffWrite}=require('./appointment-finance-release.cjs');
const {TARGETS}=require('./appointment-finance-prepare.cjs');
const {planTariffs}=require('./appointment-finance-tariff-plan.cjs');
const sha='a'.repeat(40),bucket='gcf-v2-sources-1053571783393-us-central1';
const archive=name=>({label:'candidate',privateRetained:true,extractionVerified:true,anonymousAccessDenied:true,generation:'123456789',sha256:'b'.repeat(64),uri:`gs://${bucket}/codex-release-recovery/appointment-finance/${sha}/${name}-candidate.tar.gz`});
test('source patch can only select a retained immutable reviewed candidate and cannot modify runtime configuration',()=>{
 for(const name of Object.keys(TARGETS)){
  const patch=sourcePatch(name,archive(name),sha);
  assert.deepEqual(Object.keys(patch).sort(),['buildConfig','name']);assert.deepEqual(Object.keys(patch.buildConfig),['source']);
  assert.equal(patch.buildConfig.source.storageSource.generation,'123456789');
  for(const change of [{label:'baseline'},{privateRetained:false},{anonymousAccessDenied:false},{uri:'gs://public/arbitrary.tar.gz'},{generation:''}])assert.throws(()=>sourcePatch(name,{...archive(name),...change},sha));
 }
 assert.throws(()=>sourcePatch('unrelated',archive('unrelated'),sha));
});
test('publication requires observed ready generation, 100 percent reviewed revision, and no tagged old routes',()=>{
 const ready={metadata:{generation:2},status:{observedGeneration:2,latestReadyRevisionName:'new',conditions:[{type:'Ready',status:'True'}],traffic:[{revisionName:'new',percent:100}]}};
 verifyTraffic(ready,'new');
 for(const status of [{observedGeneration:1},{conditions:[]},{traffic:[{revisionName:'old',percent:1},{revisionName:'new',percent:99}]},{traffic:[{revisionName:'new',percent:100},{revisionName:'old',tag:'old'}]},{traffic:[]}])assert.throws(()=>verifyTraffic({...ready,status:{...ready.status,...status}},'new'));
});
test('release refuses missing recovery, failed runtime tests or incomplete consumer evidence',()=>{
 const prepared={stage:'complete',mode:'prepare-and-retain-private-recovery',sourceSha:sha,inheritedPrivacy:{},recoveryBucketConfigHash:'verified',recoveryBucketPolicyHash:'verified',functions:Object.entries(TARGETS).map(([name,target])=>({name,originalSourceHash:target.sourceHash,baselineResult:{cleanInstall:true,runtimeSmokePassed:true,testsPassed:1,dependencyLockSha256:'lock'},candidateResult:{cleanInstall:true,runtimeSmokePassed:true,testsPassed:1,dependencyLockSha256:'lock'},runtimeGraph:{repositoryPricingFixtureReachable:false},archives:[{label:'baseline',privateRetained:true,extractionVerified:true},archive(name)]}))};
 verifyPrepared(prepared);
 for(const mutate of [x=>x.functions.pop(),x=>x.functions[0].candidateResult.runtimeSmokePassed=false,x=>x.functions[0].archives.shift(),x=>x.functions[0].candidateResult.dependencyLockSha256='changed']){const bad=structuredClone(prepared);mutate(bad);assert.throws(()=>verifyPrepared(bad));}
});
test('tariff commit fences absence/updateTime and limits writes to the reviewed settings document',()=>{
 const name='projects/demac-corporation/databases/(default)/documents/businessSettings/company-service-pricing-rules';
 const created=tariffWrite(name,planTariffs(null));assert.deepEqual(created.currentDocument,{exists:false});assert.equal(created.updateMask.fieldPaths.length,6);
 const current={updateTime:'2026-10-12T01:00:00Z',fields:{version:{integerValue:'1'}}};
 assert.deepEqual(tariffWrite(name,planTariffs(current)).currentDocument,{updateTime:current.updateTime});
 assert.throws(()=>tariffWrite(name,{...planTariffs(null),currentDocument:{}}));
 assert.throws(()=>tariffWrite(name+'/different',planTariffs(null)));
});
