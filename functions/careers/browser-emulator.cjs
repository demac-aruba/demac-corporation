'use strict';
// End-to-end tests use local demo emulators; no production records or messages.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {chromium,webkit}=require('playwright');
const flow=require('../../apps/erp-next/scripts/careers-question-driver.cjs');
const project='demo-demac-careers';
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^127\.0\.0\.1:\d+$/.test(process.env[key]||''))throw Error('Local demo emulators required.');
if(process.env.GCLOUD_PROJECT!==project)throw Error('Production is forbidden in this test.');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore'),{getAuth}=require('firebase-admin/auth'),{getStorage}=require('firebase-admin/storage');
const {createService,COLLECTIONS}=require('./service'),{createFiles}=require('./files'),{createHandler}=require('./http'),C=require('./core');
const app=initializeApp({projectId:project,storageBucket:`${project}.appspot.com`}),db=getFirestore(app),auth=getAuth(app),bucket=getStorage(app).bucket();
const site='http://127.0.0.1:4174',api='http://127.0.0.1:4175',output='careers-live-results',testPassword=crypto.randomBytes(24).toString('hex');
fs.mkdirSync(output,{recursive:true});
const infra={blockers:()=>[],signature:s=>C.digest(`${s?.from}|${s?.privacyVersion}`),verify:async()=>{},send:async()=>{throw Error('Email transport is forbidden in this test.');}};
const files=createFiles({bucket,sharp:require('sharp'),scanner:async()=>{}}),service=createService({db,files,infrastructure:infra});
const env={DEMAC_CAREERS_BACKEND_ENABLED:'true',CAREERS_ALLOWED_ORIGINS:site,CAREERS_RATE_SALT:crypto.randomBytes(32).toString('hex')};
let interrupt=false,interrupted=false;
const handlers={'/careersPublic':createHandler({service,auth,env}),'/careersAdmin':createHandler({service,auth,env,admin:true})};
const server=http.createServer(async(req,res)=>{
  const handler=handlers[req.url];if(!handler){res.writeHead(404);res.end();return;}
  let raw=Buffer.alloc(0);for await(const chunk of req){raw=Buffer.concat([raw,chunk]);if(raw.length>15*1024*1024){res.writeHead(413);res.end();return;}}
  try{
    const request={method:req.method,body:raw.length?JSON.parse(raw):{},rawBody:raw,ip:clients.requestAddress(req.method,req.headers[clients.header]),get:k=>req.headers[k.toLowerCase()],is:type=>String(req.headers['content-type']||'').startsWith(type)};
    const response={set(k,v){res.setHeader(k,v);return this;},status(n){res.statusCode=n;return this;},json(body){
      // Return a deterministic gateway error after the real transaction commits.
      // Closing a socket instead allows Chromium to retry invisibly at HTTP level.
      if(interrupt&&!interrupted&&request.body.action==='application.submit'&&body.ok){interrupted=true;res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:false,code:'connection-error',message:'Connection interrupted after saving. Please retry.'}));return this;}
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));return this;
    },send(value){res.end(value);return this;}};
    await handler(request,response);
  }catch(error){res.statusCode=500;res.end(JSON.stringify({ok:false,message:'Test server failure'}));console.error(error);}
});
const results=[];
const clients=require('./test-support/browser-clients.cjs').createBrowserClients();
async function context(browser,admin,viewport){
  const ctx=await browser.newContext({viewport,reducedMotion:'reduce'});
  const client=clients.register();
  await ctx.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin===api)return route.continue({headers:{...route.request().headers(),[clients.header]:client}});
    if([site,api].includes(u.origin)||u.protocol==='data:'||u.protocol==='blob:'&&[site,api].includes(new URL(u.pathname).origin))return route.continue();
    if(u.hostname==='firestore.googleapis.com'&&u.pathname.startsWith(`/v1/projects/${project}/`)){
      const response=await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}${u.pathname}${u.search}`,{method:route.request().method(),headers:route.request().headers(),...(route.request().postData()?{body:route.request().postData()}:{})});
      return route.fulfill({status:response.status,headers:{'Content-Type':'application/json'},body:await response.text()});
    }
    return route.abort();
  });
  if(admin){
    const response=await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test-api-key`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'qa-admin@example.test',password:testPassword,returnSecureToken:true})});
    const token=await response.json();assert(token.idToken,'Auth emulator must sign in the test administrator');
    await ctx.addInitScript(session=>{ if (window !== window.top) return; sessionStorage.setItem('demac.erp-next.firebase.session.v1',JSON.stringify(session)); },{uid:'qa-admin',email:'qa-admin@example.test',idToken:token.idToken,refreshToken:token.refreshToken,expiresAt:Date.now()+3600000});
  }
  return ctx;
}
(async()=>{
  await auth.createUser({uid:'qa-admin',email:'qa-admin@example.test',password:testPassword});
  await db.collection('users').doc('qa-admin').set({role:'admin',active:true,name:'QA Administrator'});
  const settings={intakeEnabled:false,privacyText:'QA notice for emulator tests only. Never a live policy.',privacyVersion:'qa-v1',retentionDays:7,talentRetentionDays:14,from:'careers@example.test',replyTo:'careers@example.test',senderName:'QA'};
  await service.saveSettings('qa-admin',{requestId:crypto.randomUUID(),expectedVersion:0,settings});await service.verifySetup('qa-admin');
  await service.saveSettings('qa-admin',{requestId:crypto.randomUUID(),expectedVersion:1,settings:{...settings,intakeEnabled:true}});
  await new Promise(resolve=>server.listen(4175,'127.0.0.1',resolve));
  for(const [name,type]of [['chromium',chromium],['webkit',webkit]]){
    const browser=await type.launch({headless:true}),admin=await context(browser,true,{width:1440,height:1000}),candidate=await context(browser,false,{width:390,height:844});
    const office=await admin.newPage(),person=await candidate.newPage(),errors=[];
    let dismissDialog=false;
    for(const page of [office,person]){page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>dismissDialog?d.dismiss():d.accept());}
    async function shot(page,label){
      await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
      const notice=page.locator('[data-candidate-email-notice]');
      if(await notice.count()&&await notice.isVisible()){
        const outer=await notice.boundingBox(),copy=await notice.locator(':scope > span').boundingBox();
        assert(copy&&outer&&copy.width>=outer.width-12,'candidate email notice must flow as one readable paragraph, not narrow flex columns');
      }
      await page.screenshot({path:path.join(output,`${name}-${label}.png`),fullPage:true});
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');
    }
    async function settled(){await office.getByText('Loading from DEMAC…',{exact:true}).waitFor({state:'hidden'});}
    // A title also appears as the English source inside the Spanish editor. It is
    // not a save acknowledgement. Wait for the real write, list route and row
    // before reloading, then independently read the canonical emulator record.
    async function saveFromEditor(button,status,title,spanishTitle,expectedVersion){
      const responsePromise=office.waitForResponse(response=>{
        if(response.url()!==`${api}/careersAdmin`||response.request().method()!=='POST')return false;
        return response.request().postDataJSON()?.action==='vacancies.save';
      });
      await office.getByRole('button',{name:button,exact:true}).click();
      const response=await responsePromise,body=await response.json();
      assert.equal(response.status(),200,'the server must acknowledge the vacancy write');
      assert.equal(body.ok,true,'failed saves must never be treated as committed');
      assert.equal(body.result.version,expectedVersion,'each save advances the canonical version exactly once');
      await office.waitForURL(url=>url.pathname==='/recruitment/'&&url.searchParams.get('tab')==='vacancies'&&!url.searchParams.has('edit'),{waitUntil:'domcontentloaded'});
      await office.getByRole('button',{name:'＋ New vacancy',exact:true}).waitFor();
      await office.getByText(title,{exact:true}).waitFor();
      const saved=await service.getVacancy('qa-admin',body.result.id);
      assert.equal(saved.status,status);assert.equal(saved.version,expectedVersion);
      assert.equal(saved.title,title);assert.equal(saved.translations.es.title,spanishTitle);
      const duplicates=await db.collection(COLLECTIONS.jobs).where('title','==',title).get();
      assert.equal(duplicates.size,1,'saving or reloading must not duplicate a vacancy');
      return saved;
    }
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
      // Exercise types that previously existed only in the server contract.
      for(const [index,label,kind]of [[1,'Earliest start date','date'],[2,'Portfolio URL','url']]){
        await office.getByRole('button',{name:'＋ Add role question',exact:true}).click();
        await office.getByLabel('Question',{exact:true}).nth(index).fill(label);
        await office.getByLabel('Answer format',{exact:true}).nth(index).selectOption(kind);
      }
      // Authenticated, manually authored Spanish lives on the same record. No AI or
      // browser-injected translations; every field below uses the actual editor.
      await office.getByRole('button',{name:'Español — Traducción',exact:true}).click();
      await office.getByRole('button',{name:'Add Spanish translation',exact:true}).click();
      const spanishTitle=`Especialista VRF QA ${name}`;
      for(const [label,value] of [
        ['Título del puesto · Español',spanishTitle],['Departamento · Español','Técnica'],['Ubicación · Español','Aruba'],
        ['Contratación · Español','Tiempo completo'],['Acerca del puesto · Español','Puesto de prueba creado desde la administración.'],
        ['Responsabilidades · Una por línea','Inspeccionar y mantener equipos.\nDocumentar el trabajo técnico.'],
        ['Requisitos esenciales · Una por línea','Experiencia pertinente.'],
        ['Pregunta 1 · Español','¿Has trabajado con sistemas VRF?'],['Yes · Español','Sí'],['No · Español','No'],
        ['Pregunta 2 · Español','Fecha de inicio más temprana'],['Pregunta 3 · Español','URL del portafolio'],
      ]) await office.getByLabel(label,{exact:true}).fill(value);
      const reviewed=office.getByLabel('I reviewed this Spanish translation against the current English version.',{exact:true});
      await office.getByLabel('Request certificates',{exact:true}).check();
      await office.getByLabel('Require certificates before submission',{exact:true}).check();
      await office.getByLabel('Request government id',{exact:true}).check();
      const idPurpose=office.getByLabel('Purpose / applicant help · Government ID · English',{exact:true});
      await idPurpose.fill('  Proposed purpose only  ');
      assert.equal(await idPurpose.inputValue(),'  Proposed purpose only  ','incomplete category edits keep exact entered text');
      await office.getByLabel('Request government id',{exact:true}).uncheck();
      await require('./browser-editor-preview.cjs')({office,title,spanishTitle,output,name});
      await reviewed.check();await shot(office,'01-vacancy-editor');
      await saveFromEditor('Save draft','Draft',title,spanishTitle,1);
      await office.reload({waitUntil:'domcontentloaded'});await office.getByRole('button',{name:'＋ New vacancy',exact:true}).waitFor();await office.getByText(title,{exact:true}).waitFor();
      const row=()=>office.locator('div').filter({has:office.getByText(title,{exact:true})}).filter({has:office.getByRole('button',{name:'Edit position',exact:true})}).last();
      await row().getByRole('button',{name:'Edit position',exact:true}).click();await settled();
      await office.getByRole('button',{name:'Español — Traducción',exact:true}).click();
      assert.equal(await office.getByLabel('Título del puesto · Español',{exact:true}).inputValue(),spanishTitle);
      assert(await reviewed.isChecked(),'reviewed translation survives a real server reload');
      await office.getByLabel('About the role',{exact:true}).fill('Test role created through the administrative interface. Updated.');
      await office.getByLabel('Publication status',{exact:true}).selectOption('Open');
      assert(!(await reviewed.isChecked()),'English editing invalidates the previous Spanish review');
      assert(await office.getByRole('button',{name:'Save & open vacancy',exact:true}).isDisabled(),'stale review is explained before publication');
      dismissDialog=true;const editUrl=office.url();
      await office.getByRole('button',{name:'Open Careers Settings',exact:true}).click();
      dismissDialog=false;assert.equal(office.url(),editUrl,'cancelling the warning preserves the editor');
      assert.equal(await office.getByLabel('Título del puesto · Español',{exact:true}).inputValue(),spanishTitle);
      await reviewed.check();await shot(office,'01b-spanish-reviewed');
      await office.setViewportSize({width:390,height:844});await shot(office,'01c-spanish-mobile');await office.setViewportSize({width:1440,height:1000});
      // Configuration changes after preflight must still be rejected by the server,
      // retaining the editor and offering an explicit draft save rather than data loss.
      let cfg=(await service.getSettings('qa-admin')).settings;
      await service.saveSettings('qa-admin',{requestId:crypto.randomUUID(),expectedVersion:cfg.version,settings:{...cfg,intakeEnabled:false}});
      await office.getByRole('button',{name:'Save & open vacancy',exact:true}).click();
      await office.getByRole('alert').filter({hasText:'Complete Careers setup'}).waitFor();
      assert.equal(await office.getByLabel('Título del puesto · Español',{exact:true}).inputValue(),spanishTitle);
      dismissDialog=true;await office.getByRole('button',{name:'Reload',exact:true}).click();dismissDialog=false;
      assert.equal(await office.getByLabel('Título del puesto · Español',{exact:true}).inputValue(),spanishTitle,'cancelled Reload retains every edited field');
      await saveFromEditor('Save draft','Draft',title,spanishTitle,2);
      cfg=(await service.getSettings('qa-admin')).settings;
      await service.saveSettings('qa-admin',{requestId:crypto.randomUUID(),expectedVersion:cfg.version,settings:{...cfg,intakeEnabled:true}});
      await row().getByRole('button',{name:'Edit position',exact:true}).click();await settled();
      await office.getByLabel('Publication status',{exact:true}).selectOption('Open');
      await saveFromEditor('Save & open vacancy','Open',title,spanishTitle,3);await shot(office,'02-vacancies');
      const published=(await service.publicJobs()).jobs.find(j=>j.title===title);
      assert.equal(published.translations.es.title,spanishTitle);assert.equal(published.editorialVersion,2);
      assert.deepEqual(published.availableLocales,['en','es']);
      const spanishChecks=await require('./browser-locale.cjs')({browser,makeContext:context,job:published,site,output,name,service,db,collections:COLLECTIONS});
      await person.goto(`${site}/careers/`);await person.getByRole('heading',{name:title,exact:true}).waitFor();
      await person.getByRole('article').filter({has:person.getByRole('heading',{name:title,exact:true})}).getByRole('button',{name:`View ${title}`,exact:true}).click();
      assert(!(await person.locator('body').innerText()).includes('QA PRIVATE NOTE'),'private vacancy notes excluded');
      assert(await person.locator('[data-career-icon]').evaluateAll(icons=>icons.every(icon=>!icon.closest('.public-site'))),'Careers controls are outside marketing illustration styles');
      await person.getByRole('button',{name:'Apply now',exact:true}).click();
      // Exercise the public, server-backed one-question flow through real controls.
      // Every transition checks the stable question route and that no second
      // conceptual question is mounted. No prefilled browser state is injected.
      await flow.details(person,{first:'QA',last:`Candidate ${name}`,email:`candidate-${name}@example.test`,nationality:'NL'});
      await person.locator('#totalExperience').fill('6');await flow.next(person);
      await flow.question(person,'profile:relevantExperience');await person.locator('#relevantExperience').fill('3');await flow.next(person);
      await person.getByRole('group',{name:'Have you worked on VRF systems?',exact:true}).getByLabel('Yes',{exact:true}).check();await flow.next(person);
      const startDate=person.getByLabel('Earliest start date',{exact:true});
      assert.equal(await startDate.getAttribute('type'),'date');await startDate.fill('2026-10-01');await flow.next(person);
      const portfolio=person.getByLabel('Portfolio URL',{exact:true});
      assert.equal(await portfolio.getAttribute('type'),'url');await portfolio.fill('javascript:alert(1)');
      const invalidUrl=person.url();await person.getByRole('button',{name:'Continue',exact:true}).click();
      await person.getByText('Enter a valid http or https web address.',{exact:true}).waitFor();
      assert.equal(person.url(),invalidUrl,'invalid URL cannot advance to another question');
      await portfolio.fill('https://example.test/portfolio');await flow.next(person);
      await flow.question(person,'profile:languages');const languagesUrl=person.url();
      await person.locator('#languages').getByLabel('English',{exact:true}).check();
      await person.locator('#languages').getByLabel('Spanish',{exact:true}).check();
      assert.equal(person.url(),languagesUrl,'multiple selections wait for explicit Continue');await flow.next(person);
      await flow.question(person,'profile:availability');await person.locator('#availability').getByLabel('Within 2 weeks',{exact:true}).check();await flow.next(person);
      await person.getByRole('heading',{name:'Photo & documents',exact:true}).waitFor();
      const png=await require('sharp')({create:{width:96,height:96,channels:3,background:'#cbddee'}}).png().toBuffer();
      await person.locator('#photo').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:png});await person.getByText('Photo selected for review',{exact:true}).waitFor();
      await person.locator('#cv').setInputFiles({name:'qa-cv.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% QA test file\n%%EOF')});
      await person.locator('#files-certificate').setInputFiles({name:'qa-training.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Synthetic certificate\n%%EOF')});
      await shot(person,'03-documents');await person.getByRole('button',{name:'Review application',exact:true}).click();await person.locator('#privacy').check();
      // A real admin edit invalidates the public form version; recovery is explicit,
      // keeps contact/files and never reinterprets an answer to a changed question.
      const jobs=await db.collection(COLLECTIONS.jobs).where('title','==',title).get();
      const oldJob=jobs.docs[0].data();
      await service.saveVacancy('qa-admin',{id:oldJob.id,requestId:crypto.randomUUID(),expectedVersion:oldJob.version,vacancy:{...oldJob,translations:{es:{...oldJob.translations.es,status:'Draft'}},questions:oldJob.questions.map(q=>q.kind==='url'?{...q,label:'Portfolio URL (current)'}:q)}});
      await person.getByRole('button',{name:'Submit application',exact:true}).click();
      await person.getByRole('button',{name:'Review updated position',exact:true}).click();
      // Revisit each retained answer on its own screen, then answer only the
      // redefined question. Its old answer must not be silently reinterpreted.
      const dateId=oldJob.questions.find(q=>q.kind==='date').id;
      const urlId=oldJob.questions.find(q=>q.kind==='url').id;
      await flow.walkTo(person,`role:${dateId}`);
      assert.equal(await person.getByLabel('Earliest start date',{exact:true}).inputValue(),'2026-10-01');await flow.next(person);
      await flow.question(person,`role:${urlId}`);
      assert.equal(await person.getByLabel('Portfolio URL (current)',{exact:true}).inputValue(),'');
      await person.getByLabel('Portfolio URL (current)',{exact:true}).fill('https://example.test/reviewed-portfolio');await flow.next(person);
      await flow.question(person,'profile:languages');
      for(const language of ['English','Spanish'])assert(await person.locator('#languages').getByLabel(language,{exact:true}).isChecked(),'language selection survives vacancy revision');
      await flow.next(person);await flow.question(person,'profile:availability');
      assert(await person.locator('#availability').getByLabel('Within 2 weeks',{exact:true}).isChecked(),'availability survives vacancy revision');await flow.next(person);
      await person.getByAltText('Your selected profile photo').waitFor();
      await person.getByText('qa-cv.pdf',{exact:true}).waitFor();
      await person.getByRole('button',{name:'Review application',exact:true}).click();
      assert(!(await person.locator('#privacy').isChecked()),'revised privacy requires new acknowledgement');
      assert.equal(await person.locator('[data-reviewed-question="profile:email"] dd').textContent(),`candidate-${name}@example.test`);
      await person.locator('#privacy').check();
      await shot(person,'03b-revised-review');
      interrupt=true;interrupted=false;
      const interruptedResponse=person.waitForResponse(r=>r.url()===`${api}/careersPublic`&&r.request().method()==='POST'&&r.request().postDataJSON()?.action==='application.submit');
      await person.getByRole('button',{name:'Submit application',exact:true}).click();
      const interruptedResult=await interruptedResponse;
      assert.equal(interruptedResult.status(),503,'the injected gateway interruption, not a rate-limit error, must be exercised');
      assert.equal((await interruptedResult.json()).code,'connection-error');
      await person.getByRole('alert').filter({hasText:'Connection interrupted'}).waitFor();assert(interrupted,'gateway failure must occur after committed application');
      interrupt=false;await person.getByRole('button',{name:'Submit application',exact:true}).click();await person.getByRole('heading',{name:'Application submitted',exact:true}).waitFor();assert.equal(await person.getByText('The position or privacy notice changed. Your contact details and selected documents are preserved. Review the current questions and consent before submitting.',{exact:true}).count(),0,'successful receipt must not retain a stale revision warning');await shot(person,'04-receipt');
      await candidate.close();
      await office.getByRole('button',{name:'Applicants',exact:true}).click();await settled();await office.getByLabel('Search',{exact:true}).fill(`Candidate ${name}`);
      await Promise.all([office.waitForResponse(r=>r.url()===`${api}/careersAdmin`&&r.request().postDataJSON()?.action==='applications.list'&&r.request().postDataJSON()?.payload?.search===`Candidate ${name}`),office.getByRole('button',{name:'Apply filters',exact:true}).click()]);
      await settled();await office.getByText(`QA Candidate ${name}`,{exact:true}).waitFor();await office.waitForFunction(()=>Array.from(document.querySelectorAll('button')).filter(b=>b.textContent.trim()==='Open profile').length===1);
      assert.equal(await office.getByRole('button',{name:'Open profile',exact:true}).count(),1);
      await shot(office,'05-applicants');await office.getByRole('button',{name:'Open profile',exact:true}).click();await office.getByRole('heading',{name:`QA Candidate ${name}`,exact:true}).waitFor();
      await office.getByLabel('Recruitment stage',{exact:true}).selectOption('Interview');await office.getByText('Selection stage updated. No automated message was sent.',{exact:true}).waitFor();await settled();
      await office.getByLabel('Private note',{exact:true}).fill('QA reviewed after candidate browser closed.');await office.getByRole('button',{name:'Save note',exact:true}).click();await office.getByText('QA reviewed after candidate browser closed.',{exact:true}).waitFor();
      await office.reload();await office.getByText('QA reviewed after candidate browser closed.',{exact:true}).waitFor();assert.equal(await office.getByLabel('Recruitment stage',{exact:true}).inputValue(),'Interview');await office.getByAltText('Candidate profile photo').waitFor();
      await shot(office,'06-profile');await office.setViewportSize({width:390,height:844});await shot(office,'07-profile-mobile');
      const snapshot=await db.collection(COLLECTIONS.applications).where('profile.email','==',`candidate-${name}@example.test`).get();assert.equal(snapshot.size,1);assert.equal((await db.collection(COLLECTIONS.mail).doc(snapshot.docs[0].id).get()).data().status,'queued');
      for(const collection of ['appointments','customers','staffProfiles'])assert.equal((await db.collection(collection).get()).size,0);
      assert.deepEqual(errors,[]);results.push({name,result:'PASS',browser:browser.version(),verified:[...spanishChecks,'admin save/reload/edit/publish','Spanish editing and review persist on one vacancy','stale Spanish blocks Open but permits Draft','cancelled Settings and Reload retain unsaved editor','late setup rejection preserves translations and allows explicit draft save','single-question routes with explicit multiple-choice Continue','shared date and URL types validated before submit','stale vacancy recovery preserves details/files and clears redefined answers/consent','style ownership excludes marketing SVG rules','public form from saved vacancy','private notes excluded','actual private emulator storage','gateway failure after commit and retry without duplicate','candidate browser closed then admin reads persistent record','stage/note/photo after reload','mobile admin layout','no operational domain writes']});
    }catch(error){for(const [label,page]of [['office',office],['candidate',person]])await page.screenshot({path:path.join(output,`${name}-${label}-FAIL.png`),fullPage:true}).catch(()=>{});results.push({name,result:'FAIL',error:String(error),pageErrors:errors});console.error(error);}
    finally{await admin.close();await candidate.close().catch(()=>{});await browser.close();fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(results,null,2));}
  }
  if(results.some(r=>r.result==='FAIL'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{await new Promise(resolve=>server.close(resolve));await db.terminate();await deleteApp(app);console.log(JSON.stringify(results));});
