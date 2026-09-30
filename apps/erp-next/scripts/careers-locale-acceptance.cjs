'use strict';
// LANG-01 and LANG-02 candidate browser checks. Synthetic jobs/files only; no live Firebase or mail.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const { chromium,webkit,firefox }=require('playwright');
const flow=require('./careers-question-driver.cjs');
const base=process.env.CAREERS_TEST_URL||'http://127.0.0.1:4173',origin=new URL(base).origin;
const output=process.env.CAREERS_TEST_OUTPUT||path.join(process.cwd(),'careers-ui-results');
fs.mkdirSync(output,{recursive:true});
const results=[];
(async()=>{
 for(const [name,type,width] of [['chromium',chromium,390],['webkit',webkit,390],['firefox',firefox,1366]]){
  const browser=await type.launch({headless:true});
  const context=await browser.newContext({locale:'en-US',viewport:{width,height:844},reducedMotion:'reduce'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.dismiss());
  const locale=async value=>{assert.equal(await page.locator('html').getAttribute('lang'),value);assert.equal(new URL(page.url()).searchParams.get('lang'),value);};
  const switchTo=async(name,value)=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForFunction(v=>document.documentElement.lang===v,value);};
  const shot=async suffix=>{await page.screenshot({path:path.join(output,`${name}-locale-${suffix}.png`),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow');};
  try{
   await page.goto(`${base}/careers/?lang=es`,{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:'Ver Técnico HVAC',exact:true}).waitFor();await locale('es');
   await shot('01-es-list');
   const length=await page.evaluate(()=>history.length);
   await page.locator('#department-filter').selectOption('Field Operations');
   await switchTo('English','en');
   assert.equal(await page.locator('#department-filter').inputValue(),'Field Operations');
   assert.equal(await page.evaluate(()=>history.length),length);
   await switchTo('Español','es');
   assert.equal(await page.locator('#department-filter').inputValue(),'Field Operations');
   await page.getByRole('button',{name:'Ver Técnico HVAC',exact:true}).click();
   await page.getByRole('heading',{name:'Técnico HVAC',exact:true}).waitFor();await shot('02-es-role');
   await page.getByRole('button',{name:'Aplicar ahora',exact:true}).click();
   await page.getByRole('button',{name:'Continuar',exact:true}).click();
   await page.getByText('Escribe tu nombre.',{exact:true}).waitFor();
   await shot('02a-name-error');
   await flow.details(page,{first:'María',last:'Test',email:'candidate@example.test'});
   assert.equal(await page.locator('#totalExperience').getAttribute('type'),'number');
   await page.locator('#totalExperience').fill('-1');
   await page.getByRole('button',{name:'Continuar',exact:true}).click();
   await page.getByText('Escribe los años de experiencia, entre 0 y 70.',{exact:true}).waitFor();
   await page.locator('#totalExperience').fill('4');await flow.next(page);
   await page.locator('#relevantExperience').fill('3');await flow.next(page);
   await flow.question(page,'role:systems');
   await page.getByLabel('Unidades split',{exact:true}).check();await page.getByLabel('VRF / VRV',{exact:true}).check();
   await page.getByRole('heading',{name:'¿Con qué sistemas has trabajado?',exact:true}).waitFor();
   await shot('02b-multiple-choice');
   const question=new URL(page.url()).searchParams.get('question'),count=await page.evaluate(()=>history.length);
   await switchTo('English','en');assert.equal(new URL(page.url()).searchParams.get('question'),question);
   assert.equal(await page.evaluate(()=>history.length),count);assert.ok(await page.getByLabel('VRF / VRV',{exact:true}).isChecked());
   await switchTo('Español','es');await flow.next(page);
   await page.getByLabel('Sí',{exact:true}).check();await flow.next(page);
   await page.locator('#q-project').fill('  Trabajé 4 años.\nI also repaired VRF.  ');await flow.next(page);
   await page.locator('#languages').getByLabel('Inglés',{exact:true}).check();await page.locator('#languages').getByLabel('Español',{exact:true}).check();await flow.next(page);
   await page.getByLabel('Inmediatamente',{exact:true}).check();await flow.next(page);
   await page.locator('#cv').setInputFiles({name:'cv-synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
   await page.locator('#cv').setInputFiles({name:'Continue.exe',mimeType:'application/octet-stream',buffer:Buffer.from('synthetic rejected file')});
   await page.getByRole('alert').filter({hasText:'Continue.exe: Usa PDF o DOCX.'}).waitFor();
   await switchTo('English','en');
   await page.getByRole('alert').filter({hasText:'Continue.exe: Use PDF or DOCX.'}).waitFor();
   await switchTo('Español','es');
   await page.getByRole('alert').filter({hasText:'Continue.exe: Usa PDF o DOCX.'}).waitFor();
   assert.equal(await page.getByText('cv-synthetic.pdf',{exact:true}).count(),1);
   await page.goBack({waitUntil:'domcontentloaded'});await flow.question(page,'profile:availability');await locale('es');
   assert.ok(await page.getByLabel('Inmediatamente',{exact:true}).isChecked());
   await page.goForward({waitUntil:'domcontentloaded'});await page.locator('#cv').waitFor();await locale('es');
   assert.equal(await page.getByText('cv-synthetic.pdf',{exact:true}).count(),1);
   await shot('03-preserved-file');
   // Re-read the original paragraph after both toggles and history traversal.
   for (const id of ['profile:availability', 'profile:languages', 'role:project']) { await page.goBack({waitUntil:'domcontentloaded'}); await flow.question(page,id); }
   assert.equal(await page.locator('#q-project').inputValue(),'  Trabajé 4 años.\nI also repaired VRF.  ');
   await locale('es');
   // Resume the existing forward history, then finish the actual localized form.
   for (const id of ['profile:languages', 'profile:availability']) { await page.goForward({waitUntil:'domcontentloaded'}); await flow.question(page,id); }
   await page.goForward({waitUntil:'domcontentloaded'}); await page.locator('#photo').waitFor();
   const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAALUlEQVR4nGM8ffcdAy0BE01NH7Vg1IJRC0YtGLVg1IJRC0YtGLVg1IJRC6gIAOdxAtaKe4s8AAAAAElFTkSuQmCC','base64');
   await page.locator('#photo').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:image});
   await page.getByText('Foto seleccionada para revisión',{exact:true}).waitFor();
   await shot('04-documents-complete');
   await page.getByRole('button',{name:'Revisar solicitud',exact:true}).click();
   await page.getByRole('heading',{name:'Revisa tu solicitud',exact:true}).waitFor();
   const original=page.locator('dd').filter({hasText:'I also repaired VRF.'});
   assert.equal(await original.textContent(),'  Trabajé 4 años.\nI also repaired VRF.  ');
   assert.equal(await page.locator('#privacy').isChecked(),false);
   assert.equal(await page.getByLabel('Conservar mi perfil para futuras vacantes (opcional; simulado en esta vista previa).',{exact:true}).isChecked(),false);
   await page.getByRole('button',{name:'Enviar solicitud de prueba',exact:true}).click();
   await page.getByText('Lee y acepta la información de privacidad de esta vista previa.',{exact:true}).waitFor();
   await page.getByRole('button',{name:'Editar Cuéntanos brevemente sobre un proyecto relacionado.',exact:true}).click();
   await flow.question(page,'role:project');
   assert.equal(await page.locator('#q-project').inputValue(),'  Trabajé 4 años.\nI also repaired VRF.  ');
   await page.locator('button[type="submit"]').filter({hasText:'Volver a la revisión'}).click();
   await page.getByRole('heading',{name:'Revisa tu solicitud',exact:true}).waitFor();
   await page.locator('#privacy').check();await shot('05-review');
   await page.getByRole('button',{name:'Enviar solicitud de prueba',exact:true}).click();
   await page.getByRole('heading',{name:'Solicitud de prueba completada',exact:true}).waitFor();
   await page.getByText('Solo vista previa. No se ha enviado ningún correo ni se ha guardado una candidatura real.',{exact:true}).waitFor();
   await shot('06-confirmation');
   const receipt=new URL(page.url()).searchParams.get('receipt');
   await switchTo('English','en');await page.getByRole('heading',{name:'Application completed',exact:true}).waitFor();
   await switchTo('Español','es');assert.equal(new URL(page.url()).searchParams.get('receipt'),receipt);
   await page.getByText('Review tools', {exact:false}).first().click();
   await page.getByRole('button',{name:'Review this candidate',exact:true}).click();
   await page.locator('[data-submitted-locale="es"]').waitFor();
   assert.equal(await page.locator('[data-submitted-question="role:project"] dd').textContent(),'  Trabajé 4 años.\nI also repaired VRF.  ');
   assert.equal(await page.locator('[data-submitted-question="role:drawings"] dt').textContent(),'¿Puedes leer planos técnicos?');
   await shot('07-original-expedient');
   assert.deepEqual(errors,[]);
   results.push({browser:name,status:'PASS',scenarios:['campaign ES','canonical department survives toggle','approved Spanish profile','explicit language does not add history','selected options retained','mixed original paragraph retained in session','file retained','Back/Forward retains manual ES','localized standard and role questions','localized invalid number and file feedback','selected file is not misreported as stored','original paragraph is unchanged in review and edit','explicit consent and no preselected future opt-in','localized preview receipt without mail claim','frozen Spanish original evidence in the English admin preview']});
  }catch(e){await page.screenshot({path:path.join(output,`${name}-locale-FAIL.png`),fullPage:true});results.push({browser:name,status:'FAIL',error:e.message});throw e;}
  finally{await context.close();await browser.close();fs.writeFileSync(path.join(output,'locale-report.json'),JSON.stringify(results,null,2));}
 }
 const browser=await chromium.launch({headless:true});
 try{
  for(const scenario of [
   {id:'saved-over-browser',saved:'es',language:'en-US',query:'',expected:'es'},
   {id:'explicit-over-saved',saved:'es',language:'es-VE',query:'?lang=en',expected:'en'},
   {id:'regional-browser',language:'es-VE',query:'',expected:'es'},
   {id:'invalid-query',language:'es-VE',query:'?lang=invalid',expected:'es'},
   {id:'blocked-storage',language:'es-VE',query:'',blocked:true,expected:'es'},
   {id:'unsupported-browser',language:'nl-NL',query:'',expected:'en'},
  ]){
   const ctx=await browser.newContext({locale:scenario.language});
   await ctx.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
   if(scenario.saved)await ctx.addInitScript(value=>localStorage.setItem('demac-careers-language',value),scenario.saved);
   if(scenario.blocked)await ctx.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Test blocked','SecurityError');}}));
   const page=await ctx.newPage();await page.goto(`${base}/careers/${scenario.query}`,{waitUntil:'domcontentloaded'});
   await page.getByRole('button',{name:scenario.expected==='es'?'Ver Técnico HVAC':'View HVAC Technician',exact:true}).waitFor();
   assert.equal(await page.locator('html').getAttribute('lang'),scenario.expected);
   await page.getByRole('button',{name:scenario.expected==='es'?'English':'Español',exact:true}).click();
   await page.waitForFunction(value=>document.documentElement.lang===value,scenario.expected==='es'?'en':'es');
   results.push({scenario:scenario.id,status:'PASS'});await ctx.close();
  }
 }finally{await browser.close();fs.writeFileSync(path.join(output,'locale-report.json'),JSON.stringify(results,null,2));}
 console.log('PASS: locale routing, selection, canonical filters and retained in-tab data. Localized form, review and synthetic receipt are covered; snapshot admin rendering is covered; production privacy and email remain separate.');
})().catch(e=>{console.error(e);process.exitCode=1;});
