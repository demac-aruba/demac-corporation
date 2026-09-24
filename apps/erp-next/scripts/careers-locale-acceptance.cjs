'use strict';
// Scoped LANG-01 browser checks. Synthetic jobs/files only; no live Firebase or mail.
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
   await flow.details(page,{first:'María',last:'Test',email:'candidate@example.test'});
   await page.locator('#totalExperience').fill('4');await flow.next(page);
   await page.locator('#relevantExperience').fill('3');await flow.next(page);
   await flow.question(page,'role:systems');
   await page.getByLabel('Split units',{exact:true}).check();await page.getByLabel('VRF / VRV',{exact:true}).check();
   const question=new URL(page.url()).searchParams.get('question'),count=await page.evaluate(()=>history.length);
   await switchTo('English','en');assert.equal(new URL(page.url()).searchParams.get('question'),question);
   assert.equal(await page.evaluate(()=>history.length),count);assert.ok(await page.getByLabel('VRF / VRV',{exact:true}).isChecked());
   await switchTo('Español','es');await flow.next(page);
   await page.getByLabel('Yes',{exact:true}).check();await flow.next(page);
   await page.locator('#q-project').fill('Trabajé 4 años.\nI also repaired VRF.');await flow.next(page);
   await page.getByLabel('English',{exact:true}).check();await page.getByLabel('Spanish',{exact:true}).check();await flow.next(page);
   await page.getByLabel('Immediately',{exact:true}).check();await flow.next(page);
   await page.locator('#cv').setInputFiles({name:'cv-synthetic.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n%%EOF')});
   await switchTo('English','en');await switchTo('Español','es');
   assert.equal(await page.getByText('cv-synthetic.pdf',{exact:true}).count(),1);
   await page.goBack({waitUntil:'domcontentloaded'});await flow.question(page,'profile:availability');await locale('es');
   assert.ok(await page.getByLabel('Immediately',{exact:true}).isChecked());
   await page.goForward({waitUntil:'domcontentloaded'});await page.locator('#cv').waitFor();await locale('es');
   assert.equal(await page.getByText('cv-synthetic.pdf',{exact:true}).count(),1);
   await shot('03-preserved-file');
   // Re-read the original paragraph after both toggles and history traversal.
   for (const id of ['profile:availability', 'profile:languages', 'role:project']) { await page.goBack({waitUntil:'domcontentloaded'}); await flow.question(page,id); }
   assert.equal(await page.locator('#q-project').inputValue(),'Trabajé 4 años.\nI also repaired VRF.');
   await locale('es');
   assert.deepEqual(errors,[]);
   results.push({browser:name,status:'PASS',scenarios:['campaign ES','canonical department survives toggle','approved Spanish profile','explicit language does not add history','selected options retained','mixed original paragraph retained in session','file retained','Back/Forward retains manual ES']});
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
 console.log('PASS: locale routing, selection, canonical filters and retained in-tab data. Form/receipt localization is not certified by this block.');
})().catch(e=>{console.error(e);process.exitCode=1;});
