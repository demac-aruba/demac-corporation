// Fault-injection/component regression, not a hosted preview or Firebase backend UAT.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const tools = process.env.FIELD_PORTAL_TEST_TOOLS;
if (!tools) throw new Error('FIELD_PORTAL_TEST_TOOLS must point to the isolated test installation.');
const esbuild = require(path.join(tools,'node_modules/esbuild'));
const {chromium, webkit} = require(path.join(tools,'node_modules/playwright'));
const app = path.resolve(__dirname,'..');
const output = path.resolve(process.env.AUTH_SESSION_EVIDENCE || path.join(app,'.auth-session-evidence'));
fs.mkdirSync(output,{recursive:true});
const settings = {
  NEXT_PUBLIC_ISOLATED_PREVIEW:'true', NEXT_PUBLIC_FIREBASE_API_KEY:'demo-key',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID:'demo-demac-dwellings',NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN:'demo-demac-dwellings.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET:'demo-demac-dwellings.appspot.com',NEXT_PUBLIC_FIREBASE_APP_ID:'demo-fixture',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:'000000', NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID:'',
};
const define = Object.fromEntries(Object.entries(settings).map(([key,value])=>[`process.env.${key}`,JSON.stringify(value)]));
const common = {bundle:true,write:false,tsconfig:path.join(app,'tsconfig.json'),nodePaths:[path.join(tools,'node_modules')],define};
const moduleCode = esbuild.buildSync({...common,stdin:{contents:"export * as session from './lib/firebase/session'; export * as transport from './lib/firebase/request-error';",resolveDir:app,loader:'ts'},platform:'node',format:'cjs'}).outputFiles[0].text;
const modulePath=path.join(output,'session-module.cjs');fs.writeFileSync(modulePath,moduleCode);
const built=esbuild.buildSync({...common,entryPoints:[path.join(__dirname,'auth-session-browser.fixture.tsx')],outfile:path.join(output,'fixture.js'),jsx:'automatic',platform:'browser',format:'iife'});
const js=built.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css=built.outputFiles.find(file=>file.path.endsWith('.css')).text;
const report={kind:'component and deterministic transport fault injection; not backend/public acceptance',unitCases:0,browsers:[],status:'running'};
const record=()=>fs.writeFileSync(path.join(output,'auth-session-results.json'),JSON.stringify(report,null,2));record();
let state;
const reset=()=>{state={profileStatus:200,profileInactive:false,role:'technician',staff:true,profiles:0,holdProfile:false,pending:[]};};reset();
const server=http.createServer(async(req,res)=>{
  if(req.url==='/fixture.js'){res.setHeader('content-type','text/javascript');return res.end(js);}
  if(req.url==='/fixture.css'){res.setHeader('content-type','text/css');return res.end(css);}
  if(req.url==='/'){res.setHeader('content-type','text/html');return res.end('<html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;font:16px system-ui}main{padding:16px}output{display:block}input{display:block;max-width:95%;padding:10px}button{min-height:44px;margin:5px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');}
  if(req.url==='/favicon.ico'){res.statusCode=204;return res.end();}
  res.setHeader('content-type','application/json');
  const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  if(req.url.includes('accounts:signInWithPassword')){
    let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);const uid=input.email.startsWith('helper')?'synthetic-helper':'synthetic-tech';
    return send(200,{localId:uid,email:input.email,idToken:`synthetic-${uid}-token`,refreshToken:`synthetic-${uid}-refresh`,expiresIn:'3600'});
  }
  if(req.url.includes('securetoken.googleapis.com'))return send(400,{error:{message:'INVALID_REFRESH_TOKEN'}});
  if(req.url.includes('/documents/users/')){
    state.profiles++;const savedState=state;
    if(savedState.holdProfile)await new Promise(resolve=>savedState.pending.push(resolve));
    if(res.destroyed)return;
    if(savedState.profileStatus!==200)return send(savedState.profileStatus,{error:{status:savedState.profileStatus===403?'PERMISSION_DENIED':savedState.profileStatus===401?'UNAUTHENTICATED':'UNAVAILABLE'}});
    const helper=req.url.includes('synthetic-helper');
    const values={name:helper?'DEMO · Ayudante':'DEMO · Técnico',role:savedState.role,active:!savedState.profileInactive,...(savedState.staff?{staffId:helper?'DEMO-HELPER':'DEMO-TECH'}:{})};
    return send(200,{name:req.url,fields:Object.fromEntries(Object.entries(values).map(([key,value])=>[key,typeof value==='boolean'?{booleanValue:value}:{stringValue:value}]))});
  }
  return send(404,{error:{status:'NOT_FOUND'}});
});
const waitFor=async(fn)=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw Error('Expected test event was not observed.');};
(async()=>{
  const {session,transport}=require(modulePath);
  report.unitCases=await require('./auth-session-acceptance.cjs')(session,transport);record();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const engines=process.env.AUTH_SESSION_ENGINES==='chromium'?[['chromium',chromium]]:[['chromium',chromium],['webkit',webkit]];
  for(const [name,engine] of engines){
    const browser=await engine.launch({headless:true,...(name==='chromium'&&process.env.FIELD_PORTAL_BROWSER_EXECUTABLE?{executablePath:process.env.FIELD_PORTAL_BROWSER_EXECUTABLE,args:['--no-sandbox']}:{})});
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage();page.setDefaultTimeout(10000);
    const outside=[],errors=[],checks=[];
    page.on('request',req=>{if(!req.url().startsWith(base+'/'))outside.push(new URL(req.url()).origin);});
    page.on('pageerror',error=>errors.push(error.message));
    const authState=()=>page.locator('[data-testid=auth-state]').innerText();
    const expected=async(uid='synthetic-tech')=>page.waitForFunction((uid)=>window.authHarness?.current?.mode==='firebase'&&window.authHarness.current.principal.userId===uid,uid);
    const locked=async()=>page.waitForFunction(()=>window.authHarness?.current?.mode==='signed_out'&&window.authHarness.current.status!=='loading');
    const saved=()=>page.evaluate(()=>window.authHarness.session.loadFirebaseWebSession());
    const login=async()=>{await page.getByRole('button',{name:'Sign in technician',exact:true}).click();await expected();};
    try{
      reset();await page.goto(base);await locked();assert.equal(await saved(),null);checks.push('fresh unauthenticated page stays locked');
      await login();await page.getByLabel('Capture draft').fill('DEMO · captura en progreso');
      const mounts=await page.evaluate(()=>window.draftMounts);const credential=await saved();
      state.profileStatus=503;await page.getByRole('button',{name:'Refresh profile',exact:true}).click();
      await page.getByRole('button',{name:'Reintentar conexión',exact:true}).waitFor();
      assert.equal(await authState(),'firebase:ready:synthetic-tech');assert.equal(await page.getByLabel('Capture draft').inputValue(),'DEMO · captura en progreso');
      assert.equal(await page.evaluate(()=>window.draftMounts),mounts);assert.deepEqual(await saved(),credential);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.screenshot({path:path.join(output,`session-recovery-${name}.png`),fullPage:true});checks.push('503 retains verified principal, credential, same mounted capture and explicit retry');
      state.profileStatus=200;await page.getByRole('button',{name:'Reintentar conexión',exact:true}).click();
      await page.waitForFunction(()=>!window.authHarness.current.error);assert.equal(await page.getByLabel('Capture draft').inputValue(),'DEMO · captura en progreso');checks.push('retry revalidates account without losing draft');
      for(const status of [408,429,502,504]){
        state.profileStatus=status;await page.getByRole('button',{name:'Refresh profile',exact:true}).click();await page.getByRole('button',{name:'Reintentar conexión',exact:true}).waitFor();
        assert.equal(await page.getByLabel('Capture draft').inputValue(),'DEMO · captura en progreso');state.profileStatus=200;await page.getByRole('button',{name:'Reintentar conexión',exact:true}).click();await page.waitForFunction(()=>!window.authHarness.current.error);
      }checks.push('408/429/502/504 are retryable, not revocations');
      await page.route('**/__preview/firebase/firestore.googleapis.com/**',route=>route.abort('failed'));
      await page.getByRole('button',{name:'Refresh profile',exact:true}).click();await page.getByRole('button',{name:'Reintentar conexión',exact:true}).waitFor();assert.equal(await page.getByLabel('Capture draft').inputValue(),'DEMO · captura en progreso');
      await page.unroute('**/__preview/firebase/firestore.googleapis.com/**');await page.getByRole('button',{name:'Reintentar conexión',exact:true}).click();await page.waitForFunction(()=>!window.authHarness.current.error);checks.push('network failure keeps an already verified capture');
      state.profileStatus=503;await page.reload();await locked();assert.equal(await page.getByLabel('Capture draft').count(),0);assert.ok(await saved());
      await page.getByRole('button',{name:'Reintentar conexión',exact:true}).waitFor();state.profileStatus=200;await page.getByRole('button',{name:'Reintentar conexión',exact:true}).click();await expected();checks.push('cached credential alone never grants fresh-load access; retry verifies before opening');
      await page.getByRole('button',{name:'Sign out',exact:true}).click();await locked();state.profileStatus=503;await page.getByRole('button',{name:'Sign in technician',exact:true}).click();await locked();assert.equal(await page.getByLabel('Capture draft').count(),0);assert.ok(await saved());state.profileStatus=200;await page.getByRole('button',{name:'Reintentar conexión',exact:true}).click();await expected();checks.push('password success plus unavailable profile stays locked and can retry profile only');
      for(const status of [401,403,404]){
        state.profileStatus=status;await page.getByRole('button',{name:'Refresh profile',exact:true}).click();await locked();assert.equal(await saved(),null);assert.equal(await page.getByRole('button',{name:'Reintentar conexión',exact:true}).count(),0);state.profileStatus=200;await login();
      }checks.push('401/403/missing profile lock and clear credentials');
      for(const change of [{profileInactive:true},{role:'unknown'},{staff:false}]){
        Object.assign(state,change);await page.getByRole('button',{name:'Refresh profile',exact:true}).click();await locked();assert.equal(await saved(),null);Object.assign(state,{profileInactive:false,role:'technician',staff:true});await login();
      }checks.push('inactive, unrecognized role and unlinked technician remain denied');
      state.holdProfile=true;const countBefore=state.profiles;
      await page.evaluate(()=>{void Promise.allSettled([window.authHarness.current.refreshPrincipal(),window.authHarness.current.refreshPrincipal()]);});
      await waitFor(()=>state.pending.length===1);assert.equal(state.profiles,countBefore+1);state.holdProfile=false;state.pending.splice(0).forEach(resolve=>resolve());await page.waitForTimeout(100);checks.push('concurrent profile verification shares one request and verdict');
      state.holdProfile=true;await page.getByRole('button',{name:'Refresh profile',exact:true}).click();await waitFor(()=>state.pending.length===1);
      await page.getByRole('button',{name:'Sign out',exact:true}).click();await locked();state.holdProfile=false;state.pending.splice(0).forEach(resolve=>resolve());await page.waitForTimeout(100);assert.equal(await authState(),'signed_out:ready:signed-out');assert.equal(await saved(),null);checks.push('late profile success cannot undo sign-out');
      await login();await page.getByLabel('Capture draft').fill('private to first identity');state.holdProfile=true;state.profileStatus=403;await page.getByRole('button',{name:'Refresh profile',exact:true}).click();await waitFor(()=>state.pending.length===1);
      const old=state;reset();await page.getByRole('button',{name:'Sign in helper',exact:true}).click();await expected('synthetic-helper');old.pending.splice(0).forEach(resolve=>resolve());await page.waitForTimeout(100);await expected('synthetic-helper');assert.equal((await saved()).uid,'synthetic-helper');assert.equal(await page.getByLabel('Capture draft').inputValue(),'');checks.push('late old-account denial cannot clear new login or expose old capture');
      await page.getByRole('button',{name:'Sign out',exact:true}).click();await locked();await page.reload();await locked();assert.equal(await saved(),null);checks.push('explicit sign-out remains signed out after reload');
      assert.deepEqual(outside,[]);assert.deepEqual(errors,[]);checks.push('no external requests, uncaught browser errors, or horizontal overflow');
      report.browsers.push({engine:name,viewport:'390x844 emulated',checks,status:'passed'});record();console.log(`PASS actual AuthProvider component: ${name} (${checks.length} groups).`);
    }catch(error){
      report.browsers.push({engine:name,status:'failed',completed:checks,error:String(error.message).slice(0,800)});report.status='failed';record();await page.screenshot({path:path.join(output,`failure-${name}.png`),fullPage:true}).catch(()=>{});throw error;
    }finally{state.pending.splice(0).forEach(resolve=>resolve());await context.close();await browser.close();}
  }
  report.status='passed';record();
})().catch(error=>{report.status='failed';record();console.error(error.message);process.exitCode=1;}).finally(()=>server.close());
