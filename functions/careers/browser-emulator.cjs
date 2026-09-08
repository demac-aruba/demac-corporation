'use strict';
// Actual compiled UI against local Firestore/Storage/Auth emulators only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium,webkit}=require('playwright');
const project='demo-demac-careers';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^127\.0\.0\.1:\d+$/.test(process.env[key]||''))throw Error('Only local demo emulators may be used.');
if(process.env.GCLOUD_PROJECT!==project)throw Error('Production is forbidden in Careers browser tests.');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth'),{getStorage}=require('firebase-admin/storage');
const {createService,COLLECTIONS}=require('./service'),{createFiles}=require('./files'),{createHandler}=require('./http'),C=require('./core');
const app=initializeApp({projectId:project,storageBucket:`${project}.appspot.com`}),db=getFirestore(app),auth=getAuth(app),bucket=getStorage(app).bucket();
const site='http://127.0.0.1:4174',api='http://127.0.0.1:4175',output='careers-live-results';fs.mkdirSync(output,{recursive:true});
const infra={blockers:()=>[],signature:s=>C.digest(`${s?.from}|${s?.privacyVersion}`),verify:async()=>{},send:async()=>{throw Error('No real email may be sent.');}};
const files=createFiles({bucket,sharp:require('sharp'),scanner:async()=>{}}),service=createService({db,files,infrastructure:infra});
const env={DEMAC_CAREERS_BACKEND_ENABLED:'true',CAREERS_ALLOWED_ORIGINS:site,CAREERS_RATE_SALT:'qa-only-isolated-emulator-salt-not-a-secret'};
let interrupt=false,interrupted=false;
const handlers={ '/careersPublic':createHandler({service,auth,env}), '/careersAdmin':createHandler({service,auth,env,admin:true}) };
const server=http.createServer(async(req,res)=>{
  const handler=handlers[req.url];if(!handler){res.writeHead(404);res.end();return;}
  let raw=Buffer.alloc(0);for await(const chunk of req){raw=Buffer.concat([raw,chunk]);if(raw.length>15*1024*1024){res.writeHead(413);res.end();return;}}
  try{
    const request={method:req.method,body:raw.length?JSON.parse(raw):{},rawBody:raw,ip:'127.0.0.1',get:k=>req.headers[k.toLowerCase()],is:type=>String(req.headers['content-type']||'').startsWith(type)};
    const response={set(k,v){res.setHeader(k,v);return this;},status(n){res.statusCode=n;return this;},json(body){
      if(interrupt && !interrupted && request.body.action==='application.submit' && body.ok){interrupted=true;res.destroy();return this;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return this;
    },send(value){res.end(value);return this;}};
    await handler(request,response);
  }catch(error){res.statusCode=500;res.end(JSON.stringify({ok:false,message:'Test server failure'}));console.error(error);}
});
const results=[];
async function context(browser,admin,viewport){
  const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});
  await ctx.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if([site,api].includes(u.origin) || u.protocol==='data:' || u.protocol==='blob:'&&[site,api].includes(new URL(u.pathname).origin))return route.continue();
    if(u.hostname==='firestore.googleapis.com'&&u.pathname.startsWith(`/v1/projects/${project}/`)){
      const response=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}${u.pathname}${u.search}`,{method:route.request().method(),headers:route.request().headers(),...(route.request().postData()?{body:route.request().postData()}: {})});
      return route.fulfill({status:response.status,headers:{'Content-Type':'application/json'},body:await response.text()});
    }
    return route.abort();
  });
  if(admin){
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-api-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'qa-admin@example.test',password:'QA-only-password-2026',returnSecureToken:true})});
    const token=await response.json();assert(token.idToken,'Auth emulator signs in test administrator');
    await ctx.addInitScript(session=>sessionStorage.setItem('demac.erp-next.firebase.session.v1',JSON.stringify(session)),{uid:'qa-admin',email:'qa-admin@example.test',idToken:token.idToken,refreshToken:token.refreshToken,expiresAt:Date.now()+3600000});
  }
  return ctx;
}
(async()=>{
  await auth.createUser({uid:'qa-admin',email:'qa-admin@example.test',password:'QA-only-password-2026'});
  await db.collection('users').doc('qa-admin').set({role:'admin',active:true,name:'QA Administrator'});
  const settings={intakeEnabled:false,privacyText:'QA notice for emulator tests only. Never a live policy.',privacyVersion:'qa-v1',retentionDays:7,talentRetentionDays:14,from:'careers@example.test',replyTo:'careers@example.test',senderName:'QA'};
  await service.saveSettings('qa-admin',{requestId:crypto.randomUUID(),expectedVersion:0,settings});await service.verifySetup('qa-admin');
  await service.saveSettings('qa-admin',{requestId:crypto.randomUUID(),expectedVersion:1,settings:{...settings,intakeEnabled:true}});
  await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
  for(const [name,type] of [['chromium',chromium],['webkit',webkit]]){
    const browser=await type.launch({headless:true});const admin=await context(browser,true,{width:1440,height:1000}),candidate=await context(browser,false,{width:390,height:844});
    const office=await admin.newPage(),person=await candidate.newPage(),errors=[];for(const page of [office,person]){page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());}
    async function shot(page,label){await page.screenshot({path:path.join(output,`${name}-${label}.png`),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');}
    try{
      const title=`QA VRF Specialist ${name}`;
      await office.goto(`${site}/recruitment/`);await office.getByRole('button',{name:'＋ New vacancy',exact:true}).click();
      await office.getByLabel('Job title',{exact:true}).fill(title);await office.getByLabel('Department',{exact:true}).fill('Technical');await office.getByLabel('Employment type',{exact:true}).fill('Full-time');
      await office.getByLabel('About the role',{exact:true}).fill('Test role created through the administrative interface.');
      await office.getByLabel('Responsibilities — one per line',{exact:true}).fill('Inspect and maintain systems.\nDocument technical work.');
      await office.getByLabel('Essential requirements — one per line',{exact:true}).fill('Relevant experience.');
      await office.getByLabel('Internal hiring notes — never shown to applicants',{exact:true}).fill('QA PRIVATE NOTE MUST NOT APPEAR PUBLICLY');
      await office.getByRole('button',{name:'＋ Add role question',exact:true}).click();
      await office.getByLabel('Question',{exact:true}).fill('Have you worked on VRF systems?');await office.getByLabel('Answer format',{exact:true}).selectOption('yesno');
      await shot(office,'01-vacancy-editor');await office.getByRole('button',{name:'Save vacancy',exact:true}).click();
      await office.getByText(title,{exact:true}).waitFor();await office.reload();await office.getByText(title,{exact:true}).waitFor();
      const row=office.locator('div').filter({has:office.getByText(title,{exact:true})}).filter({has:office.getByRole('button',{name:'Edit position',exact:true})}).last();
      await row.getByRole('button',{name:'Edit position',exact:true}).click();await office.getByLabel('Publication status',{exact:true}).selectOption('Open');await office.getByRole('button',{name:'Save & open vacancy',exact:true}).click();
      await office.getByText(title,{exact:true}).waitFor();await shot(office,'02-vacancies');
      await person.goto(`${site}/careers/`);await person.getByRole('heading',{name:title,exact:true}).waitFor();
      await person.getByRole('article').filter({has:person.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:'View position',exact:true}).click();
      assert(!(await person.locator('body').innerText()).includes('QA PRIVATE NOTE'),'private vacancy notes excluded');
      await person.getByRole('button',{name:'Apply now',exact:true}).click();
      for(const [id,value]of Object.entries({givenName:'QA',familyName:`Candidate ${name}`,email:`candidate-${name}@example.test`,phone:'2025550101',city:'Test City'}))await person.locator(`#${id}`).fill(value);
      await person.locator('#dialCode').selectOption('+1');await person.locator('#nationality').selectOption('NL');await person.locator('#applyingFrom').selectOption('AW');
      await person.getByRole('button',{name:'Continue',exact:true}).click();await person.locator('#totalExperience').fill('6');await person.locator('#relevantExperience').fill('3');
      await person.getByRole('group',{name:'Have you worked on VRF systems?',exact:true}).getByLabel('Yes',{exact:true}).check();await person.locator('#q-languages').getByLabel('English',{exact:true}).check();await person.locator('#availability').selectOption('Within 2 weeks');
      await person.getByRole('button',{name:'Continue',exact:true}).click();
      const png=await require('sharp')({create:{width:96,height:96,channels:3,background:'#cbddee'}}).png().toBuffer();
      await person.locator('#photo').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:png});await person.getByText('Photo selected for review',{exact:true}).waitFor();
      await person.locator('#cv').setInputFiles({name:'qa-cv.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% QA test file\n%%EOF')});
      await shot(person,'03-documents');await person.getByRole('button',{name:'Review application',exact:true}).click();await person.locator('#privacy').check();
      interrupt=true;interrupted=false;await person.getByRole('button',{name:'Submit application',exact:true}).click();await person.getByRole('alert').filter({hasText:'Connection interrupted'}).waitFor();assert(interrupted,'response interrupted only after committed application');
      interrupt=false;await person.getByRole('button',{name:'Submit application',exact:true}).click();await person.getByRole('heading',{name:'Application received',exact:true}).waitFor();await shot(person,'04-receipt');
      await candidate.close();
      await office.getByRole('button',{name:'Applicants',exact:true}).click();await office.getByLabel('Search',{exact:true}).fill(`Candidate ${name}`);await office.getByRole('button',{name:'Apply filters',exact:true}).click();
      await office.getByText(`QA Candidate ${name}`,{exact:true}).waitFor();assert.equal(await office.getByRole('button',{name:'Open profile',exact:true}).count(),1);
      await shot(office,'05-applicants');await office.getByRole('button',{name:'Open profile',exact:true}).click();await office.getByRole('heading',{name:`QA Candidate ${name}`,exact:true}).waitFor();
      await office.getByLabel('Recruitment stage',{exact:true}).selectOption('Interview');await office.getByText('Selection stage updated. No automated message was sent.',{exact:true}).waitFor();
      await office.getByLabel('Private note',{exact:true}).fill('QA reviewed after candidate browser closed.');await office.getByRole('button',{name:'Save note',exact:true}).click();await office.getByText('QA reviewed after candidate browser closed.',{exact:true}).waitFor();
      await office.reload();await office.getByText('QA reviewed after candidate browser closed.',{exact:true}).waitFor();assert.equal(await office.getByLabel('Recruitment stage',{exact:true}).inputValue(),'Interview');await office.getByAltText('Candidate profile photo').waitFor();
      await shot(office,'06-profile');
      const snapshot=await db.collection(COLLECTIONS.applications).where('profile.email','==',`candidate-${name}@example.test`).get();assert.equal(snapshot.size,1);assert.equal((await db.collection(COLLECTIONS.mail).doc(snapshot.docs[0].id).get()).data().status,'queued');
      for(const collection of ['appointments','customers','staffProfiles'])assert.equal((await db.collection(collection).get()).size,0);
      assert.deepEqual(errors,[]);results.push({name,result:'PASS',browser:browser.version(),verified:['admin save/reload/edit/publish','public form from saved vacancy','private notes excluded','actual private emulator storage','lost response retry without duplicate','candidate browser closed then admin reads persistent record','stage/note/photo after reload','no operational domain writes']});
    }catch(error){for(const [label,page]of [['office',office],['candidate',person]])await page.screenshot({path:path.join(output,`${name}-${label}-FAIL.png`),fullPage:true}).catch(()=>{});results.push({name,result:'FAIL',error:String(error),pageErrors:errors});console.error(error);}
    finally{await admin.close();await candidate.close().catch(()=>{});await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(results,null,2));}
  }
  if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await new Promise(resolve=>server.close(resolve));await db.terminate();await deleteApp(app);console.log(JSON.stringify(results));});
