'use strict';
// Controlled forward release of retained, tested runtime packages. Never restore
// operational data or replace governed consumers with their unguarded baselines.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {execFileSync}=require('node:child_process');
const {TARGETS}=require('./appointment-finance-prepare.cjs');
const {manifest,auditTariffs,decode}=require('./appointment-finance-release-audit.cjs');
const {runtimeSourceHash,releaseConfig,safePaths}=require('./booking-dwelling-release.cjs');
const {planTariffs}=require('./appointment-finance-tariff-plan.cjs');
const {selectOperations,settleOperation,updateSource}=require('./appointment-finance-source-update.cjs');
const PROJECT='demac-corporation', REGION='us-central1';
const RELEASE='release/appointment-finance-20261012';
const BUCKET='gcf-v2-sources-1053571783393-us-central1';
const BASE_RULES='2ed66f4dab0ed612eb080b778b50e72e8081e7b12c77a5d90c884c7fa076a5c2';
const stable=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const hash=value=>crypto.createHash('sha256').update(Buffer.isBuffer(value)||typeof value==='string'?value:JSON.stringify(stable(value))).digest('hex');
function sourcePatch(name,archive,preparedSha) {
  assert.ok(Object.hasOwn(TARGETS,name),'Unreviewed function');
  assert.equal(archive.label,'candidate'); assert.equal(archive.privateRetained,true); assert.equal(archive.extractionVerified,true); assert.equal(archive.anonymousAccessDenied,true);
  assert.match(preparedSha,/^[a-f0-9]{40}$/); assert.match(archive.generation,/^\d+$/); assert.match(archive.sha256,/^[a-f0-9]{64}$/);
  const object=`codex-release-recovery/appointment-finance/${preparedSha}/${name}-candidate.tar.gz`;
  assert.equal(archive.uri,`gs://${BUCKET}/${object}`,'Unreviewed archive location');
  return {name:`projects/${PROJECT}/locations/${REGION}/functions/${name}`,buildConfig:{source:{storageSource:{bucket:BUCKET,object,generation:archive.generation}}}};
}
function verifyTraffic(service,revision) {
  assert.equal(service.status?.latestReadyRevisionName,revision,'Latest ready revision differs');
  assert.equal(String(service.status?.observedGeneration),String(service.metadata?.generation), 'Cloud Run configuration not observed');
  assert.ok(service.status.conditions?.some(item=>item.type==='Ready'&&item.status==='True'),'Cloud Run is not ready');
  const traffic=service.status.traffic || [];
  assert.ok(traffic.length>0 && traffic.every(item=>!item.tag),'Old tagged mutation route remains');
  assert.equal(traffic.reduce((total,item)=>total+Number(item.percent||0),0),100);
  assert.ok(traffic.filter(item=>Number(item.percent)>0).every(item=>item.revisionName===revision),'Traffic reaches an old revision');
}
function verifyPrepared(prepared) {
  assert.equal(prepared.stage,'complete'); assert.equal(prepared.mode,'prepare-and-retain-private-recovery');
  assert.deepEqual(prepared.functions.map(item=>item.name).sort(),Object.keys(TARGETS).sort());
  assert.ok(prepared.inheritedPrivacy && prepared.recoveryBucketConfigHash && prepared.recoveryBucketPolicyHash);
  for(const item of prepared.functions) {
    assert.equal(item.originalSourceHash,TARGETS[item.name].sourceHash);
    for(const result of [item.baselineResult,item.candidateResult]) {assert.equal(result.cleanInstall,true);assert.equal(result.runtimeSmokePassed,true);assert.ok(result.testsPassed>0);}
    assert.equal(item.baselineResult.dependencyLockSha256,item.candidateResult.dependencyLockSha256);
    assert.equal(item.runtimeGraph.repositoryPricingFixtureReachable,false);
    assert.ok(item.archives.some(archive=>archive.label==='baseline'&&archive.privateRetained&&archive.extractionVerified));
    sourcePatch(item.name,item.archives.find(archive=>archive.label==='candidate'),prepared.sourceSha);
  }
}
function tariffWrite(name,plan) {
  assert.equal(name,`projects/${PROJECT}/databases/(default)/documents/businessSettings/company-service-pricing-rules`);
  assert.equal(plan.changed,true);assert.ok(plan.fieldPaths.length>0);
  assert.ok(plan.currentDocument?.exists===false||typeof plan.currentDocument?.updateTime==='string','Missing pricing precondition');
  return {update:{name,fields:plan.fields},updateMask:{fieldPaths:plan.fieldPaths},currentDocument:plan.currentDocument};
}
async function main() {
  assert.equal(process.versions.node.split('.')[0],'22');
  assert.equal(process.env.GITHUB_REPOSITORY,'demac-aruba/demac-corporation');
  assert.equal(process.env.GITHUB_REF,'refs/heads/'+RELEASE);
  assert.ok(path.isAbsolute(process.env.RUNNER_TEMP||''));
  const root=process.cwd(), out=path.join(process.env.RUNNER_TEMP,'finance-release');fs.mkdirSync(out);
  const run=(cmd,args)=>execFileSync(cmd,args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:50*1024*1024});
  const cloud=args=>run('gcloud',args), git=args=>run('git',args).trim();
  const prepared=JSON.parse(fs.readFileSync('docs/ai/releases/appointment-finance-prepared-20261012.json'));verifyPrepared(prepared);
  const summary={sourceSha:process.env.GITHUB_SHA,preparedSha:prepared.sourceSha,stage:'preflight',functions:[],mode:'forward-release'};
  const save=()=>fs.writeFileSync(path.join(out,'summary.json'),JSON.stringify(summary,null,2));
  const sourceGate=()=>{
    assert.equal(git(['rev-parse','HEAD']),process.env.GITHUB_SHA);
    assert.equal(git(['ls-remote','origin','refs/heads/'+RELEASE]).split(/\s/)[0],process.env.GITHUB_SHA,'Release branch advanced');
    const main=git(['ls-remote','origin','refs/heads/main']).split(/\s/)[0];
    git(['merge-base','--is-ancestor',process.env.GITHUB_SHA,main]);
    for(const item of ['functions','apps/erp-next','src','firestore.rules']) assert.equal(git(['rev-parse',main+':'+item]),git(['rev-parse','HEAD:'+item]),'Main source differs');
    assert.equal(git(['rev-parse',prepared.sourceSha+':functions']),git(['rev-parse','HEAD:functions']),'Prepared function source differs');
    if(summary.mainSha)assert.equal(main,summary.mainSha,'Main advanced during release'); summary.mainSha=main;
  };
  let token=null,tokenAt=0;
  const api=async(url,method='GET',body,allowed=[200])=>{
    if(!token||Date.now()-tokenAt>40*60*1000){token=cloud(['auth','print-access-token']).trim();tokenAt=Date.now();}
    const response=await fetch(url,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    assert.ok(allowed.includes(response.status),'Cloud API '+method+' HTTP '+response.status);return response.json();
  };
  const describe=name=>JSON.parse(cloud(['functions','describe',name,'--project='+PROJECT,'--region='+REGION,'--gen2','--format=json']));
  const service=fn=>JSON.parse(cloud(['run','services','describe',fn.serviceConfig.service.split('/').pop(),'--project='+PROJECT,'--region='+REGION,'--format=json']));
  const iam=fn=>hash(JSON.parse(cloud(['run','services','get-iam-policy',fn.serviceConfig.service.split('/').pop(),'--project='+PROJECT,'--region='+REGION,'--format=json'])));
  const downloadSource=(fn,label)=>{
    const src=fn.buildConfig.source.storageSource;assert.ok(src?.bucket&&src.object&&src.generation);
    const archive=path.join(out,label+'.archive'),dir=path.join(out,label);
    cloud(['storage','cp',`gs://${src.bucket}/${src.object}#${src.generation}`,archive,'--quiet']);
    const gzip=fs.readFileSync(archive).subarray(0,2).equals(Buffer.from([0x1f,0x8b]));
    safePaths(run(gzip?'tar':'unzip',gzip?['-tzf',archive]:['-Z1',archive]).trim().split('\n'));fs.mkdirSync(dir);
    run(gzip?'tar':'unzip',gzip?['-xzf',archive,'-C',dir]:['-q',archive,'-d',dir]);return manifest(dir);
  };
  let inspections=0;
  const inspect=(item,label,{allowFailed=false}={})=>{
    label += '-' + (++inspections);
    const fn=describe(item.name);assert.ok(fn.state==='ACTIVE'||allowFailed&&['FAILED','UNKNOWN'].includes(fn.state),'Function is not active or a classified failed reviewed attempt');assert.equal(fn.buildConfig.entryPoint,item.name);
    assert.equal(hash(releaseConfig(fn)),item.configHash,'Runtime configuration differs');assert.equal(iam(fn),item.iamHash,'Runtime IAM differs');if(fn.state==='ACTIVE')verifyTraffic(service(fn),fn.serviceConfig.revision);
    const files=downloadSource(fn,label),sourceHash=runtimeSourceHash(files);
    const archive=item.archives.find(entry=>entry.label==='candidate');
    assert.ok([item.originalSourceHash,archive.manifestHash].includes(sourceHash),'Unreviewed live source');
    return {fn,files,sourceHash,alreadyApplied:sourceHash===archive.manifestHash};
  };
  const boundary=async(name)=>{
    if(!['officeBookingAuthority','inventoryAuthority','fieldOperationsAuthority'].includes(name))return;
    const url=`https://${REGION}-${PROJECT}.cloudfunctions.net/${name}`;
    for(const origin of ['https://demac-aruba.com','https://www.demac-aruba.com']) {
      const options=await fetch(url,{method:'OPTIONS',headers:{Origin:origin,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'},signal:AbortSignal.timeout(20000)});
      assert.equal(options.status,204,'Production CORS failed');assert.ok([origin,'*'].includes(options.headers.get('access-control-allow-origin')));
      const action=name==='fieldOperationsAuthority'?'get_schedule':name==='inventoryAuthority'?'get_snapshot':'list_presets';
      const denied=await fetch(url,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action,data:{}}),signal:AbortSignal.timeout(20000)});
      assert.equal(denied.status,401,'Production anonymous access must be denied');
    }
  };
  const rulesApi=`https://firebaserules.googleapis.com/v1/projects/${PROJECT}`;
  const readRules=async()=>{
    const release=await api(rulesApi+'/releases/cloud.firestore');
    assert.ok(release.rulesetName?.startsWith(`projects/${PROJECT}/rulesets/`));
    const ruleset=await api('https://firebaserules.googleapis.com/v1/'+release.rulesetName);assert.equal(ruleset.source.files.length,1);
    return {release,sourceHash:hash(ruleset.source.files[0].content)};
  };
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const operations=async item=>{
    const all=[];let pageToken='';
    do{
      const params=new URLSearchParams({pageSize:'1000',...(pageToken?{pageToken}:{})});
      const page=await api(`https://cloudfunctions.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/operations?`+params);
      assert.ok(!page.unreachable?.length,'Operation evidence incomplete');all.push(...(page.operations||[]));pageToken=page.nextPageToken||'';
      assert.ok(all.length<50000,'Too many operations to reconcile safely');
    }while(pageToken);
    return all.filter(op=>op.metadata?.target===`projects/${PROJECT}/locations/${REGION}/functions/${item.name}`);
  };
  const getOperation=name=>{assert.ok(name.startsWith(`projects/${PROJECT}/locations/${REGION}/operations/`));return api('https://cloudfunctions.googleapis.com/v2/'+name);};
  const recordOperation=(name,op)=>{
    summary.operations||=[];
    summary.operations.push({function:name,name:op.name,done:op.done||false,errorCode:op.error?.code||null,...(op.intent?{intent:true,at:op.at}:{})});save();
  };
  try {
    sourceGate();save();
    const rules=await readRules(),candidateRules=fs.readFileSync('firestore.rules','utf8');
    assert.ok([BASE_RULES,hash(candidateRules)].includes(rules.sourceHash),'Active rules differ');summary.rulesBefore={rulesetName:rules.release.rulesetName,sourceHash:rules.sourceHash};save();
    // Inspect every consumer before the first deployment. Recovery artifacts are
    // downloaded again and compared with both retained hashes and reviewed code.
    for(const item of prepared.functions) {
      summary.stage='preflight-'+item.name;save();
      const archive=item.archives.find(entry=>entry.label==='candidate'),local=path.join(out,item.name+'-retained.tar.gz'),dir=path.join(out,item.name+'-retained');
      cloud(['storage','cp',archive.uri+'#'+archive.generation,local,'--quiet']);assert.equal(hash(fs.readFileSync(local)),archive.sha256);
      safePaths(run('tar',['-tzf',local]).trim().split('\n'));fs.mkdirSync(dir);run('tar',['-xzf',local,'-C',dir]);const files=manifest(dir);assert.equal(runtimeSourceHash(files),archive.manifestHash);
      for(const file of [...TARGETS[item.name].files,...TARGETS[item.name].added])assert.equal(files[file],hash(fs.readFileSync(path.join(root,'functions',file))),'Candidate patch bytes differ');
      const patch=sourcePatch(item.name,archive,prepared.sourceSha);
      let prior=selectOperations(await operations(item),patch);
      const active=prior.find(op=>!op.done);
      if(active){await settleOperation(active,{getOperation,wait,record:op=>recordOperation(item.name,op)});prior=selectOperations(await operations(item),patch);}
      const state=inspect(item,item.name+'-initial',{allowFailed:Boolean(prior[0]?.done&&prior[0]?.error)});
      if(state.fn.state==='ACTIVE')await boundary(item.name);
      summary.functions.push({name:item.name,beforeRevision:state.fn.serviceConfig.revision,alreadyApplied:state.alreadyApplied,sourceHash:state.sourceHash});save();
    }
    const pricingName=`projects/${PROJECT}/databases/(default)/documents/businessSettings/company-service-pricing-rules`;
    const pricingUrl='https://firestore.googleapis.com/v1/'+pricingName;
    const readPricing=async()=>{const value=await api(pricingUrl,'GET',undefined,[200,404]);if(value.error){assert.equal(value.error.status,'NOT_FOUND');return null;}return value;};
    // Validate the bounded tariff plan before the first source change.
    planTariffs(await readPricing());
    const deploy=async item=>{
      sourceGate();summary.stage='source-'+item.name;save();
      const entry=summary.functions.find(x=>x.name===item.name),archive=item.archives.find(x=>x.label==='candidate');
      const patch=sourcePatch(item.name,archive,prepared.sourceSha);
      const after=await updateSource({patch,baselineRevision:item.beforeRevision,operations:()=>operations(item),
        inspect:options=>inspect(item,item.name+'-verified',options),
        publish:body=>{sourceGate();return api('https://cloudfunctions.googleapis.com/v2/'+patch.name+'?updateMask=buildConfig.source','PATCH',body);},
        getOperation,wait,record:op=>recordOperation(item.name,op)});
      await boundary(item.name);
      Object.assign(entry,{afterRevision:after.fn.serviceConfig.revision,sourceVerified:true,configPreserved:true,iamPreserved:true,trafficVerified:true,verifiedAt:new Date().toISOString()});save();
      console.log(item.name+': exact retained source, runtime configuration, IAM and traffic verified');
    };
    // Every null-price consumer is published before saving approved prices or
    // exposing catalog edits. No customer handler is invoked by this release.
    for(const item of prepared.functions.filter(x=>x.name!=='officeBookingAuthority'))await deploy(item);
    summary.stage='consumer-transition';save();
    // Measured supporting drain evidence is not the financial exclusivity proof.
    // The fresh-grant version fence supplies that guarantee for money writes.
    for(let minute=0;minute<6;minute++)await wait(30000);
    summary.consumerObservation=[];
    for(const entry of summary.functions.filter(x=>x.name!=='officeBookingAuthority')){
      const filter=`metric.type="run.googleapis.com/container/instance_count" AND resource.type="cloud_run_revision" AND resource.labels.project_id="${PROJECT}" AND resource.labels.location="${REGION}" AND resource.labels.revision_name="${entry.beforeRevision}"`;
      const query=new URLSearchParams({filter,view:'FULL',pageSize:'1000','interval.startTime':new Date(Date.now()-600000).toISOString(),'interval.endTime':new Date().toISOString()});
      const metrics=await api(`https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?`+query);
      assert.ok(!metrics.nextPageToken,'Metric evidence needs pagination');
      summary.consumerObservation.push({name:entry.name,revision:entry.beforeRevision,series:(metrics.timeSeries||[]).map(series=>({state:series.metric?.labels?.state||null,latest:series.points?.[0]||null}))});
    }
    sourceGate();summary.stage='approved-tariffs';save();
    const pricingBefore=await readPricing(),plan=planTariffs(pricingBefore);
    if(plan.changed)await api(`https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,'POST',{writes:[tariffWrite(pricingName,plan)]});
    const pricingAfter=await readPricing();
    if(plan.changed)assert.deepEqual(pricingAfter.fields,{...(pricingBefore?.fields||{}),...plan.fields},'Saved settings differ from bounded plan');
    const rows=auditTariffs(Object.fromEntries(Object.entries(pricingAfter.fields).map(([key,value])=>[key,decode(value)])));
    assert.equal(rows.length,15);assert.ok(rows.every(row=>row.matchesApproved),'Approved prices were not saved');
    summary.tariffs={changed:plan.changed,verified:15,updateTime:pricingAfter.updateTime,documentHash:hash(pricingAfter.fields)};save();
    sourceGate();summary.stage='catalog-rules';save();
    const active=await readRules();assert.ok([BASE_RULES,hash(candidateRules)].includes(active.sourceHash),'Rules changed during release');
    if(active.sourceHash!==hash(candidateRules)){
      const created=await api(rulesApi+'/rulesets','POST',{source:{files:[{name:'firestore.rules',content:candidateRules}]}});
      assert.ok(created.name?.startsWith(`projects/${PROJECT}/rulesets/`));summary.createdRuleset=created.name;save();
      const unchanged=await readRules();assert.equal(unchanged.release.rulesetName,active.release.rulesetName,'Rules concurrently changed');
      await api(rulesApi+'/releases/cloud.firestore','PATCH',{release:{name:`projects/${PROJECT}/releases/cloud.firestore`,rulesetName:created.name},updateMask:'rulesetName'});
    }
    const governed=await readRules();assert.equal(governed.sourceHash,hash(candidateRules));
    summary.rulesAfter={rulesetName:governed.release.rulesetName,sourceHash:governed.sourceHash,updateTime:governed.release.updateTime};save();
    const rulesAt=Date.parse(governed.release.updateTime);assert.ok(Number.isFinite(rulesAt),'Rules release update time missing');
    while(Date.now()<rulesAt+65000)await wait(Math.min(30000,rulesAt+65000-Date.now()));
    await deploy(prepared.functions.find(x=>x.name==='officeBookingAuthority'));
    // Existing Firestore listeners can take ten minutes to adopt new rules.
    // Keep new catalog UI unpromoted until this propagation interval has elapsed.
    summary.stage='rules-propagation';save();
    while(Date.now()<rulesAt+610000){await wait(Math.min(30000,rulesAt+610000-Date.now()));}
    sourceGate();
    for(const item of prepared.functions){const final=inspect(item,item.name+'-final');assert.equal(final.alreadyApplied,true);await boundary(item.name);}
    assert.equal((await readRules()).sourceHash,hash(candidateRules));
    const finalPrices=await readPricing();assert.equal(hash(finalPrices.fields),summary.tariffs.documentHash,'Tariffs changed before promotion');
    summary.stage='complete';summary.readyForErpPromotion=true;summary.completedAt=new Date().toISOString();save();
    console.log('PASS: five verified source-only releases, fifteen approved prices, governed catalog rules and protected finance cutover');
  }catch(error){summary.error=error.code==='ERR_ASSERTION'?String(error.message).split('\n')[0]:'Release stopped at '+summary.stage;save();console.error(summary.error);process.exitCode=1;}
}
module.exports={sourcePatch,verifyTraffic,verifyPrepared,tariffWrite};
if(require.main===module)main();
