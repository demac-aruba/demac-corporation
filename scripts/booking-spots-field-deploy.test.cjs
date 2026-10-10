const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname,'booking-spots-field-deploy.cjs'),'utf8');
const sha='a'.repeat(40);
async function scenario(options={}) {
  const deployed=[],artifacts=new Map(),staged={};let mainReads=0;
  const baseline={
    'package.json':'{"main":"bootstrap.js","dependencies":{"synthetic":"1"}}',
    'package-lock.json':'{"packages":{"":{"dependencies":{"synthetic":"1"}}}}',
    'bootstrap.js':"module.exports = require('./fieldOperationsAuthority');",
    'fieldOperationsAuthority.js':"require('./bookingAuthorityFirestore'); require('./fieldOperationsAuthorityCore'); // original",
    'bookingAuthorityFirestore.js':"require('./servicePricingAuthority');",
    'servicePricingAuthority.js':'module.exports = {price:100};',
    'fieldOperationsAuthorityCore.js':"function plannedWorkItems(order, appointment) {\nreturn [];\n}",
  };
  const insertion="  // Workload helpers share the visit, but the primary owns the customer scope.\n"
    + "  // Do not fall back to all Appointment services on an intentionally empty helper.\n"
    + "  if (order?.workloadSupport === true && order.supportNonBillable === true\n"
    + "      && order.appointmentAssignmentRole === 'support') return [];\n";
  const candidate={...baseline,'fieldOperationsAuthorityCore.js':baseline['fieldOperationsAuthorityCore.js'].replace('function plannedWorkItems(order, appointment) {\n','function plannedWorkItems(order, appointment) {\n'+insertion)};
  const office={...candidate,'bookingAuthorityFirestore.js':"require('./servicePricingAuthority'); require('./appointmentCharges');",'appointmentCharges.js':'module.exports = {};'};
  const observed={...(options.alreadyCandidate?candidate:baseline)};
  if(options.unreviewedSource)observed['fieldOperationsAuthority.js']+=' // unreviewed';
  if(options.transitiveHotfix)observed['servicePricingAuthority.js']='module.exports = {price:200};';
  if(options.redirectedDependency){observed['bookingAuthorityFirestore.js']="require('./unreviewedPricing');";observed['unreviewedPricing.js']='module.exports = {};';}
  if(options.changedManifest)observed['package.json']='{"main":"bootstrap.js","dependencies":{"unknown":"1"}}';
  if(options.dynamicDependency)observed['bookingAuthorityFirestore.js']='require(process.env.MODULE_NAME);';
  const before={state:'ACTIVE',buildConfig:{runtime:'nodejs22',entryPoint:'fieldOperationsAuthority',source:{storageSource:{bucket:'synthetic',object:'source.zip',generation:'1'}}},serviceConfig:{revision:'old',uri:'https://synthetic',service:'synthetic',serviceAccountEmail:'synthetic-service',availableMemory:'256M',timeoutSeconds:60,environmentVariables:{SYNTHETIC:'retained'}},eventTrigger:null};
  const runtime={env:{GITHUB_REPOSITORY:'demac-aruba/demac-corporation',GITHUB_REF:options.wrongBranch?'refs/heads/feature/test':'refs/heads/main',GITHUB_SHA:sha,RUNNER_TEMP:'/synthetic'},exitCode:0};
  const execFileSync=(command,args)=>{
    if(command==='git') {
      if(args[0]==='rev-parse')return sha;
      if(args[0]==='ls-remote')return `${options.movedMain&&++mainReads>1?'b'.repeat(40):sha}\trefs/heads/main`;
      if(args.includes('--format=%B'))return '[merge-only] [deploy-booking-spots] Owner-approved update';
      if(args[0]==='ls-tree')return Object.keys(baseline).map(file=>'functions/'+file).join('\n');
      if(args[0]==='show')return baseline[args.at(-1).split(':functions/')[1]];
      if(args[0]==='archive')return '';
    }
    if(command==='tar'){Object.assign(staged,baseline);return '';}
    if(command==='unzip'){const archive=deployed.length&&!options.badPublished?candidate:observed;return args[0]==='-Z1'?Object.keys(archive).join('\n'):archive[args.at(-1)];}
    if(command==='gcloud') {
      if(args[0]==='storage')return '';
      if(args[1]==='describe') {const record=structuredClone(before);if(deployed.length){record.serviceConfig.revision='new';record.buildConfig.source.storageSource.object='new.zip';if(options.changedConfig)record.serviceConfig.availableMemory='1G';}return JSON.stringify(record);}
      if(args[1]==='deploy'){deployed.push(args);return '';}
    }
    throw Error(`Unexpected command ${command} ${args.join(' ')}`);
  };
  let error;
  const relative=file=>file.replace(/^functions\//,'').replace('/synthetic/booking-spots-field-source/','');
  try{await vm.runInNewContext(code,{require:name=>name==='node:child_process'?{execFileSync}:name==='node:fs'?{mkdirSync(){},existsSync:file=>Object.hasOwn(staged,relative(file)),statSync:()=>({isFile:()=>true}),readFileSync:file=>(file.startsWith('functions/')?office:staged)[relative(file)],writeFileSync:(file,data)=>/\.(js|json)$/.test(file)&&!file.endsWith('-release.json')?staged[relative(file)]=data:artifacts.set(file,data)}:require(name),process:runtime,console:{log(){},error(){}},fetch:async()=>({status:options.openAuth?200:401})});}catch(cause){error=cause;}
  return {error,deployed,artifacts,staged,baseline,candidate,exitCode:runtime.exitCode};
}
test('unreviewed deployed source and wrong release identity stop before any production mutation',async()=>{
  for(const options of [{unreviewedSource:true},{wrongBranch:true},{movedMain:true}]){const result=await scenario(options);assert.ok(result.error);assert.equal(result.deployed.length,0);}
});
test('reviewed source deploys only Field authority without changing access/runtime flags',async()=>{
  const result=await scenario();assert.equal(result.error,undefined);assert.equal(result.exitCode,0);assert.equal(result.deployed.length,1);const args=result.deployed[0];assert.equal(args[2],'fieldOperationsAuthority');assert.ok(!args.some(value=>/allow-unauthenticated|service-account|set-env|memory|trigger/.test(value)));assert.equal(result.artifacts.size,1);
  assert.ok(args.includes('--source=/synthetic/booking-spots-field-source'));assert.deepEqual(result.staged,result.candidate);assert.equal(result.staged['bookingAuthorityFirestore.js'],result.baseline['bookingAuthorityFirestore.js']);assert.equal(result.staged['appointmentCharges.js'],undefined);
});
test('transitive hotfixes, redirected dependencies, manifests and dynamic imports stop before deployment',async()=>{
  for(const options of [{transitiveHotfix:true},{redirectedDependency:true},{changedManifest:true},{dynamicDependency:true}]){const result=await scenario(options);assert.ok(result.error);assert.equal(result.deployed.length,0);}
});
test('a previously deployed reviewed candidate is safe to retry',async()=>{
  const result=await scenario({alreadyCandidate:true});assert.equal(result.error,undefined);assert.equal(result.deployed.length,1);assert.equal(result.artifacts.size,1);
});
test('configuration drift or lost authentication protection is a failed release',async()=>{
  const drift=await scenario({changedConfig:true});assert.ok(drift.error);assert.ok(!String(drift.error).includes('SYNTHETIC'));assert.ok(!String(drift.error).includes('retained'));
  assert.equal((await scenario({openAuth:true})).exitCode,1);
});

test('published source mismatch is a failed release before Office can deploy',async()=>{
  const result=await scenario({badPublished:true});assert.ok(result.error);assert.equal(result.deployed.length,1);
  assert.match(result.error.message,/Published Field source differs/);
});
