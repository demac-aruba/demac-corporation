const fs=require('node:fs'),assert=require('node:assert/strict');const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const credentials=JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE,'utf8'));const base=process.env.PREVIEW_URL||'http://127.0.0.1:4397';
if(!/^http:\/\/127\.0\.0\.1:4397$/.test(base)&&!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base))throw Error('Synthetic gateway only');
const output=process.env.PREVIEW_EVIDENCE_DIR;const createdName='DEMO Mobile '+Date.now();
async function login(p,email=credentials.office){await p.goto(base+'/login');await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Password',{exact:true}).fill(credentials.password);await p.getByRole('button',{name:'Sign in securely'}).click();await p.waitForURL(u=>!u.pathname.includes('/login'))}
(async()=>{
for(const [name,engine,device]of [['android',chromium,'Pixel 7'],['iphone',webkit,'iPhone 13']]){
 const browser=await engine.launch({headless:true});const context=await browser.newContext({...devices[device]});const page=await context.newPage();page.setDefaultTimeout(20000);page.on('dialog',d=>d.accept());const errors=[],outside=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))outside.push(new URL(r.url()).origin)});
 try{
 await login(page);await page.goto(base+'/crm');await page.getByRole('button',{name:/DEMO Owner C 1 property/}).click();await page.getByRole('button',{name:'Properties',exact:true}).click();await page.getByRole('combobox',{name:'Open property dwellings & areas'}).selectOption({label:'DEMO Palm Court'});
 const panel=page.getByRole('region',{name:'Property dwellings and areas'});await panel.getByText('40 dwelling(s) · 0 area(s)',{exact:true}).waitFor();
 await panel.getByLabel('Find dwelling').fill('Apartment 40');await panel.getByRole('button',{name:'Apartment 40 40 · apartment',exact:true}).click();await panel.getByRole('button',{name:'Edit dwelling & contacts'}).waitFor();
 await page.screenshot({path:output+'/crm-'+name+'.png',fullPage:true});console.log('PASS '+name+' authenticated CRM, 40 dwellings, explicit search');
 await page.goto(base+'/scheduling');await page.getByRole('region',{name:'Van 2 schedule',exact:true}).getByRole('button',{name:'BOOK',exact:true}).first().click();const d=page.getByRole('dialog',{name:'Create appointment'});
 if(name==='android'){
 await d.getByRole('button',{name:/^Standard Service 1 hour/}).click();await d.getByRole('textbox',{name:'Technician instructions',exact:true}).fill('DEMO preserve this work and van while creating');
 await d.getByRole('button',{name:'＋ Create customer',exact:true}).click();await d.getByLabel('Customer name *',{exact:true}).fill(createdName);await d.getByLabel('Phone / WhatsApp *',{exact:true}).fill('+1999'+String(Date.now()).slice(-7));await d.getByLabel('Property name (optional)').fill('DEMO Mobile first property');await d.getByLabel('Street / area *',{exact:true}).fill('DEMO Avenue');await d.getByLabel('House / unit').fill('77');await d.getByLabel('Area / zone').fill('Santa Cruz');
 await d.getByRole('button',{name:'Create & select',exact:true}).click();await d.getByRole('button',{name:/DEMO Mobile first property/}).waitFor();
 await d.getByRole('button',{name:/Add property/}).click();await d.getByLabel('Property name (optional)').fill('DEMO Mobile second property');await d.getByLabel('Street / area *',{exact:true}).fill('DEMO Avenue');await d.getByLabel('House / unit').fill('88');await d.getByLabel('Area / zone').fill('Santa Cruz');await d.getByRole('button',{name:'Add & select',exact:true}).click();
 await d.getByRole('button',{name:/DEMO Mobile second property/}).waitFor();
 const locations=d.getByRole('region',{name:'Property dwellings and areas'});await locations.getByText('Add independent dwellings',{exact:true}).click();await locations.getByRole('button',{name:'Review 1 dwellings',exact:true}).click();await locations.getByLabel('Code',{exact:true}).fill('7B');await locations.getByLabel('Name',{exact:true}).fill('DEMO Annex 7B');await locations.getByRole('combobox',{name:'Dwelling type',exact:true}).selectOption('annex');await locations.getByRole('button',{name:'Save locations',exact:true}).click();await locations.getByRole('button',{name:'DEMO Annex 7B 7B · annex',exact:true}).waitFor();
 assert.equal(await locations.getByRole('button',{name:'DEMO Annex 7B 7B · annex'}).getAttribute('aria-pressed'),'true');
 assert.equal(await d.getByRole('textbox',{name:'Technician instructions',exact:true}).inputValue(),'DEMO preserve this work and van while creating');
 assert.match(await d.innerText(),/Van 2/);assert.match(await d.innerText(),/1 line · 1 item/);
 console.log('PASS H Android customer + two properties + dwelling inside booking; service, van, notes retained');
 await locations.scrollIntoViewIfNeeded();await page.screenshot({path:output+'/booking-'+name+'.png',fullPage:true});await d.getByRole('button',{name:'Close',exact:true}).click();
 await page.goto(base+'/crm');await page.getByRole('textbox',{name:'Search customers'}).fill(createdName);await page.getByRole('button',{name:new RegExp(createdName+' 2 properties')}).waitFor();
 console.log('PASS canonical booking master data visible in CRM without page reload');
 }else{
 await d.getByRole('textbox',{name:/Search customer/i}).fill('DEMO Test Lane 100');await d.getByRole('button',{name:/DEMO Owner A.*SELECT/}).click();await d.getByRole('button',{name:/DEMO Garden House/}).click();
 await d.getByRole('button',{name:'Apartment 2 2 · apartment',exact:true}).click();await d.getByRole('combobox',{name:'Access contact · this visit'}).selectOption('contact:DEMO-access');await d.getByRole('region',{name:'Property dwellings and areas'}).scrollIntoViewIfNeeded();await page.screenshot({path:output+'/booking-'+name+'.png',fullPage:true});await d.getByRole('button',{name:'Close',exact:true}).click();
 await page.goto(base+'/crm');await page.getByRole('textbox',{name:'Search customers'}).fill(createdName);await page.getByRole('button',{name:new RegExp(createdName+' 2 properties')}).waitFor();console.log('PASS N independent WebKit session sees saved customer and both properties');
 }
 assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'horizontal overflow');
 }catch(e){await page.screenshot({path:output+'/failure-'+name+'.png',fullPage:true});console.log((await page.locator('body').ariaSnapshot()).slice(-16000));throw e;}finally{await browser.close()}
}
const browser=await chromium.launch({headless:true});const context=await browser.newContext({...devices['Pixel 7']});const page=await context.newPage();
try{await login(page,credentials.technician);await page.goto(base+'/field');console.log('FIELD',await page.locator('body').ariaSnapshot());await page.screenshot({path:output+'/field-android.png',fullPage:true})}finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
