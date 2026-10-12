'use strict';
// Prepares and optionally retains private recovery packages. No deployment,
// production function invocation, database write, IAM mutation or communication.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { manifest } = require('./appointment-finance-release-audit.cjs');
const { releaseConfig, safePaths, runtimeSourceHash, isolatedTestEnv } = require('./booking-dwelling-release.cjs');
const { validateLock, validateCandidate } = require('./booking-dwelling-candidate-validation.cjs');
const PROJECT = 'demac-corporation';
const BUCKET = 'gcf-v2-sources-1053571783393-us-central1';
const BASE = '0dc09f3167150ed775018a6f257542961b21cddf';
const TARGETS = {
  officeBookingAuthority: { sourceHash: '12336022f661ad3f652b985085850bb85d3ddd212651063b4bedf1d6bb260141', files: ['appointmentCharges.js','officeBookingAuthorityFacade.js','servicePricingAuthority.js','demacServicePricingRules.js'], added: ['appointmentChargeEditing.js','serviceCatalogEditing.js'],
    tests: ['appointmentCharges.test.js','servicePricingAuthority.test.js','demacServicePricingRules.test.js','officeBookingAuthorityFacadeProject.test.js','officeBookingAuthorityCommunication.test.js','bookingAuthorityFirestore.test.js'], extraTests: ['appointmentChargeEditing.test.js','serviceCatalogEditing.test.js'] },
  inventoryAuthority: { sourceHash: 'd0863be9a354923b0cb3cea752ec263f6ec296f979602b28e5676df7eb2b65ff', files: ['inventoryAuthority.js'], added: ['servicePricingAuthority.js'], tests: ['inventoryAuthority.test.js'], extraTests: ['servicePricingAuthority.test.js'] },
  fieldOperationsAuthority: { sourceHash: 'dbe4d44338368c2aab86fc351553557c50430a5b1932ed5dd9a74c50da04c18d', files: ['servicePricingAuthority.js'], added: [], tests: ['fieldOperationsPriceSnapshots.test.js','servicePricingAuthority.test.js'], extraTests: [] },
  processCustomerAgentInbound: { sourceHash: '67dc7ded92f19cf9159ad782c68bcef0a27bb1661d1d710e2fe1a02bd20b751c', files: ['commercialSalesAuthority.js','demacCustomerSalesTools.js','servicePricingAuthority.js','demacServicePricingRules.js'], added: [], tests: ['commercialSalesAuthority.test.js','demacCustomerReservationTools.test.js','demacServicePricingRules.test.js','servicePricingAuthority.test.js'], extraTests: ['catalogPriceCompatibility.test.js'] },
  processCustomerAgentReactivation: { sourceHash: '67dc7ded92f19cf9159ad782c68bcef0a27bb1661d1d710e2fe1a02bd20b751c', files: ['commercialSalesAuthority.js','demacCustomerSalesTools.js','servicePricingAuthority.js','demacServicePricingRules.js'], added: [], tests: ['commercialSalesAuthority.test.js','demacCustomerReservationTools.test.js','demacServicePricingRules.test.js','servicePricingAuthority.test.js'], extraTests: ['catalogPriceCompatibility.test.js'] },
};
const stable = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(stable) : Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(stable(value))).digest('hex');
const CANARY = Buffer.from('DEMAC synthetic recovery privacy probe; no private data.\n');
function retainedAction(bytes, expectedHash) {
  if (hash(bytes) === expectedHash) return 'reuse';
  assert.equal(hash(bytes),hash(CANARY),'Existing recovery object has different contents');
  return 'replace-canary';
}
function verifyDelta(name, before, after) {
  const approved = TARGETS[name]; assert.ok(approved, 'Unknown target');
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(file => before[file] !== after[file]);
  assert.deepEqual(changed.sort(), [...approved.files,...approved.added].sort(), 'Unexpected candidate source delta');
  for (const file of approved.added) assert.ok(!before[file], 'New helper already exists in unreviewed baseline');
  for (const file of ['package.json','package-lock.json','bootstrap.js','index.js']) assert.equal(after[file], before[file], 'Packaging or dependency drift: ' + file);
  return changed;
}
function verifyPrivateBucket(bucket, policy) {
  assert.equal(bucket.uniform_bucket_level_access ?? bucket.iamConfiguration?.uniformBucketLevelAccess?.enabled, true, 'Uniform private bucket access required');
  assert.ok(!(policy.bindings || []).some(binding => (binding.members || []).some(member => ['allUsers','allAuthenticatedUsers'].includes(member))), 'Public recovery bucket rejected');
  const lifecycle = bucket.lifecycle_config || bucket.lifecycle || {};
  for (const rule of lifecycle.rule || []) if (rule.action?.type === 'Delete') assert.equal(rule.condition?.isLive, false, 'Recovery live objects could expire');
}
function verifyInheritedPolicies(ancestors, policies) {
  assert.ok(Array.isArray(ancestors) && ancestors.length > 0,'Project ancestry unavailable');
  assert.equal(ancestors.filter(item=>String(item.type).toLowerCase()==='project' && ['demac-corporation','1053571783393'].includes(String(item.id))).length,1,'Wrong project ancestry');
  assert.equal(policies.length,ancestors.length,'Incomplete inherited policy inspection');
  for (const policy of policies) assert.ok(!(policy.bindings || []).some(binding=>(binding.members || []).some(member=>['allUsers','allAuthenticatedUsers'].includes(member))),'Inherited public recovery access rejected');
}
async function main() {
  assert.equal(process.versions.node.split('.')[0], '22');
  assert.equal(process.env.GITHUB_REPOSITORY, 'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF, 'refs/heads/fix/appointment-finance-release-20261012');
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP || ''));
  const retain = process.argv.includes('--retain');
  const root = process.cwd(), out = path.join(process.env.RUNNER_TEMP, 'finance-preparation'); fs.mkdirSync(out);
  const run = (cmd, args, cwd = root, env = process.env) => execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore','pipe','pipe'], maxBuffer: 50 * 1024 * 1024 });
  const cloud = args => run('gcloud', args);
  const describe = name => JSON.parse(cloud(['functions','describe',name,'--project=' + PROJECT,'--region=us-central1','--gen2','--format=json']));
  const iam = fn => JSON.parse(cloud(['run','services','get-iam-policy',fn.serviceConfig.service.split('/').pop(),'--project=' + PROJECT,'--region=us-central1','--format=json']));
  const summary = { sourceSha: process.env.GITHUB_SHA, mode: retain ? 'prepare-and-retain-private-recovery' : 'prepare', stage: 'preflight', functions: [] };
  const save = () => fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
  const isolation = isolatedTestEnv(process.env);
  try {
    assert.equal(run('git',['rev-parse','HEAD']).trim(), process.env.GITHUB_SHA);
    assert.equal(run('git',['ls-remote','origin',process.env.GITHUB_REF]).split(/\s/)[0], process.env.GITHUB_SHA, 'Branch advanced');
    const bucket = JSON.parse(cloud(['storage','buckets','describe','gs://' + BUCKET,'--format=json']));
    const policy = JSON.parse(cloud(['storage','buckets','get-iam-policy','gs://' + BUCKET,'--format=json']));
    verifyPrivateBucket(bucket, policy); summary.recoveryBucketPolicyHash = hash(policy); summary.recoveryBucketConfigHash = hash(bucket); save();
    const inheritedPrivacy = () => {
      if ((bucket.public_access_prevention ?? bucket.iamConfiguration?.publicAccessPrevention) === 'enforced') return {mode:'bucket-public-access-prevention'};
      try {
        const effective=JSON.parse(cloud(['org-policies','describe','constraints/storage.publicAccessPrevention','--effective','--project=' + PROJECT,'--format=json']));
        const rules=effective.spec?.rules;
        if (Array.isArray(rules) && rules.length && rules.every(rule=>rule.enforce===true && !rule.condition)) return {mode:'effective-public-access-prevention',policyHash:hash(effective)};
      } catch { /* A complete ancestry IAM inspection is the alternative. */ }
      const ancestors=JSON.parse(cloud(['projects','get-ancestors',PROJECT,'--format=json']));
      const policies=ancestors.map(item=>{
        const kind=String(item.type).toLowerCase();
        assert.ok(['project','folder','organization'].includes(kind),'Unknown ancestry level');
        const command=kind==='project' ? ['projects'] : kind==='folder' ? ['resource-manager','folders'] : ['organizations'];
        return JSON.parse(cloud([...command,'get-iam-policy',String(item.id),'--format=json']));
      });
      verifyInheritedPolicies(ancestors,policies);
      return {mode:'complete-ancestry-iam',levels:ancestors.length,policyHashes:policies.map(hash)};
    };
    if(retain) { summary.inheritedPrivacy=inheritedPrivacy(); save(); }
    const checkBucket = () => {
      const freshBucket=JSON.parse(cloud(['storage','buckets','describe','gs://' + BUCKET,'--format=json']));
      const freshPolicy=JSON.parse(cloud(['storage','buckets','get-iam-policy','gs://' + BUCKET,'--format=json']));
      verifyPrivateBucket(freshBucket,freshPolicy);
      assert.equal(hash(freshBucket),summary.recoveryBucketConfigHash,'Recovery bucket configuration changed');
      assert.equal(hash(freshPolicy),summary.recoveryBucketPolicyHash,'Recovery bucket IAM changed');
      if(retain) assert.deepEqual(inheritedPrivacy(),summary.inheritedPrivacy,'Inherited recovery access changed');
    };
    for (const [name, spec] of Object.entries(TARGETS)) {
      summary.stage = name + '-download'; save();
      const fn = describe(name); assert.equal(fn.state,'ACTIVE'); assert.equal(fn.buildConfig.entryPoint,name); assert.equal(fn.buildConfig.runtime,'nodejs22');
      const originalConfig = hash(releaseConfig(fn)), originalIam = hash(iam(fn));
      const src = fn.buildConfig.source.storageSource; assert.equal(src.bucket, BUCKET); assert.ok(src.object && src.generation);
      const baseline = path.join(out, name + '-baseline'), zip = baseline + '.zip';
      cloud(['storage','cp',`gs://${src.bucket}/${src.object}#${src.generation}`,zip,'--quiet']);
      safePaths(run('unzip',['-Z1',zip]).trim().split('\n')); fs.mkdirSync(baseline); run('unzip',['-q',zip,'-d',baseline]);
      const original = manifest(baseline); assert.equal(runtimeSourceHash(original),spec.sourceHash,'Unreviewed deployed source');
      for (const file of Object.keys(original)) {
        assert.ok(!/(^|\/)\.env(?:\.|$)|\.(?:pem|key)$|(?:credential|service-account)\.json$/i.test(file), 'Private key in source');
        if (file === 'package-lock.json') continue; // Exact lock stays in verified private storage only.
        const oid = run('git',['hash-object',path.join(baseline,file)]).trim(); run('git',['cat-file','-e',oid + '^{blob}']);
      }
      const pkgBytes = fs.readFileSync(path.join(baseline,'package.json')), pkg = JSON.parse(pkgBytes);
      const reconstructed = !original['package-lock.json'];
      if (reconstructed) {
        assert.equal(name,'inventoryAuthority'); assert.equal(fn.serviceConfig.revision,'inventoryauthority-00004-dis');
        assert.deepEqual(pkg.dependencies, { 'firebase-admin': '^13.4.0', 'firebase-functions': '^6.4.0', sharp: '^0.34.3' });
        summary.stage = name + '-reconstruct-lock'; save();
        run('npm',['install','--package-lock-only','--ignore-scripts','--no-audit','--no-fund'],baseline,isolation);
        assert.deepEqual(fs.readFileSync(path.join(baseline,'package.json')),pkgBytes,'Dependency declarations changed');
      }
      validateLock(fs.readFileSync(path.join(baseline,'package-lock.json')),pkg);
      const before = manifest(baseline), candidate = path.join(out,name + '-candidate'); fs.cpSync(baseline,candidate,{recursive:true});
      for (const file of spec.files) {
        const live = fs.readFileSync(path.join(baseline,file));
        const main = run('git',['show',BASE + ':functions/' + file]);
        if (file === 'servicePricingAuthority.js' && hash(live) === '1b863e531303ba49155feb7947ad4282e16bf3b07c7ba3fc6755301d1eeb8643') { /* Reviewed older null parser; pure helper only. */ }
        else assert.equal(hash(live),hash(main),'Patch base differs: ' + file);
      }
      for (const file of [...spec.files,...spec.added]) fs.copyFileSync(path.join(root,'functions',file),path.join(candidate,file));
      const after = manifest(candidate), changed = verifyDelta(name,before,after);
      const baselineTests = [...spec.tests];
      summary.stage = name + '-test-baseline'; save();
      const baselineResult = validateCandidate({source:baseline,root,out,env:isolation,candidate:false,reconstruct:false,name:name + '-baseline',selectedTests:baselineTests,smokeScript:'appointment-finance-runtime-smoke.cjs'});
      summary.stage = name + '-test-candidate'; save();
      const candidateResult = validateCandidate({source:candidate,root,out,env:isolation,candidate:true,reconstruct:false,name:name + '-candidate',selectedTests:[...spec.tests,...spec.extraTests],smokeScript:'appointment-finance-runtime-smoke.cjs'});
      assert.deepEqual(manifest(baseline),before); assert.deepEqual(manifest(candidate),after);
      const archives = [];
      for (const [label,directory,expected] of [['baseline',baseline,before],['candidate',candidate,after]]) {
        const archive = directory + '.tar.gz'; run('tar',['--sort=name','--mtime=@0','--owner=0','--group=0','--numeric-owner','-czf',archive,'-C',directory,'.']);
        const verify = directory + '-roundtrip'; fs.mkdirSync(verify); run('tar',['-xzf',archive,'-C',verify]); assert.deepEqual(manifest(verify),expected); fs.rmSync(verify,{recursive:true});
        const entry = { label, sha256:hash(fs.readFileSync(archive)), manifestHash:runtimeSourceHash(expected), extractionVerified:true };
        if (retain) {
          summary.stage = name + '-retain-' + label; save();
          checkBucket();
          const object = `codex-release-recovery/appointment-finance/${process.env.GITHUB_SHA}/${name}-${label}.tar.gz`, uri = `gs://${BUCKET}/${object}`;
          const canary=path.join(out,'privacy-canary'); fs.writeFileSync(canary,CANARY);
          // Supplement the complete public-principal policy check with an
          // anonymous probe on the exact final resource before private bytes.
          // Existing matching archives are reused; different bytes never replaced.
          try { cloud(['storage','cp',canary,uri,'--if-generation-match=0','--quiet']); } catch { /* Existence is verified and contents fenced below. */ }
          let obj = JSON.parse(cloud(['storage','objects','describe',uri,'--format=json'])); assert.ok(obj.generation);
          const retrieved=archive + '.retrieved'; cloud(['storage','cp',uri + '#' + obj.generation,retrieved,'--quiet']);
          const action=retainedAction(fs.readFileSync(retrieved),entry.sha256);
          const anonymousDenied = async () => {
            const response=await fetch(`https://storage.googleapis.com/${BUCKET}/${object}`,{method:'HEAD',redirect:'error',signal:AbortSignal.timeout(20000)});
            assert.equal(response.status,403,'Effective public recovery access must be denied');
          };
          await anonymousDenied();
          if(action==='replace-canary') {
            cloud(['storage','cp',archive,uri,'--if-generation-match=' + obj.generation,'--quiet']);
            obj=JSON.parse(cloud(['storage','objects','describe',uri,'--format=json'])); assert.ok(obj.generation);
          }
          cloud(['storage','cp',uri + '#' + obj.generation,retrieved,'--quiet']); assert.equal(hash(fs.readFileSync(retrieved)),entry.sha256);
          await anonymousDenied(); checkBucket();
          entry.uri = uri; entry.generation = String(obj.generation); entry.privateRetained = true; fs.unlinkSync(retrieved);
          entry.anonymousAccessDenied=true; entry.reused=action==='reuse';
        }
        archives.push(entry);
      }
      const fresh = describe(name); assert.deepEqual(fresh.buildConfig.source,fn.buildConfig.source,'Concurrent source change');
      assert.equal(hash(releaseConfig(fresh)),originalConfig,'Concurrent configuration change'); assert.equal(hash(iam(fresh)),originalIam,'Concurrent IAM change');
      summary.functions.push({name,beforeRevision:fn.serviceConfig.revision,source:src,originalSourceHash:spec.sourceHash,reconstructed,historicalDependencyEquivalence:reconstructed ? 'unknown; newly pinned baseline' : 'original lock preserved',configHash:originalConfig,iamHash:originalIam,changed,baselineResult,candidateResult,archives});
      save(); console.log(name + ': baseline ' + baselineResult.testsPassed + '; candidate ' + candidateResult.testsPassed + '; runtime smoke passed; private recovery=' + retain);
    }
    checkBucket();
    summary.stage='complete'; save(); console.log('PASS preparation; no production behavior, settings, rules or records changed');
  } catch (error) { summary.error = error.code === 'ERR_ASSERTION' ? String(error.message).split('\n')[0] : 'Preparation failed at ' + summary.stage; save(); console.error(summary.error); process.exitCode=1; }
}
module.exports={TARGETS,verifyDelta,verifyPrivateBucket,verifyInheritedPolicies,retainedAction,CANARY};
if(require.main===module) main();
