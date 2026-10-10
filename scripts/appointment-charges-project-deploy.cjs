'use strict';
// Approved, source-only Project guard rollout; no data, policy or secret changes.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
// Successful Project production release 36465955456; preserve its dependencies.
const baseline = '83862a11db3681e1ae7463d59a6f7cf8da800f7b';
const project = 'demac-corporation', name = 'projectAuthority';
if (process.env.GITHUB_REPOSITORY !== 'demac-aruba/demac-corporation' || process.env.GITHUB_REF !== 'refs/heads/main') throw Error('Approved main release context required.');
const run = (command, args) => execFileSync(command,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024});
const git = args => run('git',args).trim();
const sourceSha = git(['rev-parse','HEAD']);
assert.equal(sourceSha,process.env.GITHUB_SHA,'Release identity changed');
assert.ok(git(['show','-s','--format=%B','HEAD']).includes('[deploy-appointment-charges]'),'Explicit bounded release marker required');
const main = () => git(['ls-remote','origin','refs/heads/main']).split(/\s/)[0];
assert.equal(main(),sourceSha,'Main advanced before release');
const describe = () => JSON.parse(run('gcloud',['functions','describe',name,'--project='+project,'--gen2','--region=us-central1','--format=json']));
const before = describe();
assert.equal(before.state,'ACTIVE');assert.equal(before.buildConfig.runtime,'nodejs22');assert.equal(before.buildConfig.entryPoint,name);
const source = before.buildConfig.source.storageSource;
assert.ok(source?.bucket&&source.object,'Deployed source not available');
const zip=path.join(process.env.RUNNER_TEMP,'appointment-charges-project-baseline.zip');
run('gcloud',['storage','cp',`gs://${source.bucket}/${source.object}${source.generation?'#'+source.generation:''}`,zip,'--quiet']);
const normalize=value=>String(value).replace(/\r\n/g,'\n');
const archiveFiles=new Set(run('unzip',['-Z1',zip]).trim().split('\n'));
assert.ok([...archiveFiles].every(file=>!file.startsWith('/')&&!file.split('/').includes('..')),'Unexpected deployed source archive path');
const baselineFiles=new Set(git(['ls-tree','-r','--name-only',baseline,'--','functions']).split('\n').map(file=>file.replace(/^functions\//,'')));
// Compare the actual loaded graph, including bootstrap's imports and package manifests.
// Build each graph independently so added, removed or redirected imports cannot hide drift.
const closure=read=>{
  const contents=new Map();
  const visit=file=>{
    if(contents.has(file))return;
    const value=read(file);assert.notEqual(value,null,'Missing runtime source: '+file);
    contents.set(file,normalize(value));
    if(!/\.[cm]?js$/.test(file))return;
    for(const match of value.matchAll(/\brequire\s*\(([^)]*)\)/g)) {
      const literal=match[1].trim().match(/^(['"])([^'"]+)\1$/);
      assert.ok(literal,'Unresolved runtime dependency in '+file);
      const dependency=literal[2];if(!dependency.startsWith('.'))continue;
      const resolved=path.posix.normalize(path.posix.join(path.posix.dirname(file),dependency));
      assert.ok(!resolved.startsWith('../')&&!path.posix.isAbsolute(resolved),'Runtime dependency outside functions');
      const target=[resolved,resolved+'.js',resolved+'.cjs',resolved+'.json',resolved+'/index.js'].find(candidate=>read(candidate)!==null);
      assert.ok(target,'Missing local runtime dependency in '+file);visit(target);
    }
  };
  visit('package.json');visit('bootstrap.js');visit('projectAuthority.js');
  if(read('package-lock.json')!==null)visit('package-lock.json');
  return contents;
};
const memo=read=>{const values=new Map();return file=>{if(!values.has(file))values.set(file,read(file));return values.get(file);};};
const observed=closure(memo(file=>archiveFiles.has(file)?run('unzip',['-p',zip,file]):null));
const baselineRead=memo(file=>baselineFiles.has(file)?run('git',['show',`${baseline}:functions/${file}`]):null);
const reviewed=closure(baselineRead);
const guard=fs.readFileSync(path.join('functions','projectCommercialGuard.js'),'utf8');
const candidate=closure(file=>file==='projectCommercialGuard.js'?guard:baselineRead(file));
const matches=other=>observed.size===other.size&&[...observed].every(([file,value])=>other.get(file)===value);
assert.ok(matches(reviewed)||matches(candidate),'Deployed Project dependency tree differs from reviewed baseline and candidate; reconcile before deployment');
// Patch only the guard onto its verified deployed generation. Do not upgrade
// Project's unrelated Booking/Field dependencies to the newer Office source.
const stage=path.join(process.env.RUNNER_TEMP,'appointment-charges-project-source');
fs.mkdirSync(stage);
const archive=path.join(process.env.RUNNER_TEMP,'appointment-charges-project-source.tar');
run('git',['archive','--format=tar','--output='+archive,baseline+':functions']);
run('tar',['-xf',archive,'-C',stage]);
fs.writeFileSync(path.join(stage,'projectCommercialGuard.js'),guard);
const staged=closure(memo(file=>{const target=path.join(stage,file);return fs.existsSync(target)&&fs.statSync(target).isFile()?fs.readFileSync(target,'utf8'):null;}));
assert.ok(staged.size===candidate.size&&[...staged].every(([file,value])=>candidate.get(file)===value),'Staged Project source differs from reviewed guard-only patch');
const config=fn=>({runtime:fn.buildConfig.runtime,entryPoint:fn.buildConfig.entryPoint,service:Object.fromEntries(Object.entries(fn.serviceConfig).filter(([key])=>!['revision','uri','service'].includes(key))),trigger:fn.eventTrigger||null});
const fresh=describe();assert.deepEqual(fresh.buildConfig.source,before.buildConfig.source,'Concurrent Project deployment');assert.equal(fresh.serviceConfig.revision,before.serviceConfig.revision);assert.equal(main(),sourceSha);
run('gcloud',['functions','deploy',name,'--project='+project,'--gen2','--region=us-central1','--runtime=nodejs22','--source='+stage,'--entry-point='+name,'--quiet']);
const stable=value=>value&&typeof value==='object'?Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const after=describe();assert.equal(after.state,'ACTIVE');assert.ok(JSON.stringify(stable(config(after)))===JSON.stringify(stable(config(before))),'Runtime configuration changed during source-only deployment');
(async()=>{const response=await fetch(`https://us-central1-${project}.cloudfunctions.net/${name}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'list',data:{}})});assert.equal(response.status,401,'Anonymous Project access must remain denied');fs.writeFileSync(path.join(process.env.RUNNER_TEMP,'appointment-charges-project-release.json'),JSON.stringify({sourceSha,baseline,before:{revision:before.serviceConfig.revision,source:before.buildConfig.source},after:{revision:after.serviceConfig.revision,source:after.buildConfig.source},state:after.state,anonymousStatus:response.status},null,2));console.log('Project Authority source updated; configuration preserved; anonymous access denied.');})().catch(error=>{console.error(error.message);process.exitCode=1;});
