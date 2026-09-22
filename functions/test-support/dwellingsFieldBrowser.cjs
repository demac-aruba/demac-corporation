const fs=require('node:fs'),assert=require('node:assert/strict');const {chromium,webkit,devices}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const credentials=JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE,'utf8'));const base=process.env.PREVIEW_URL||'http://127.0.0.1:4397';
if(!/^http:\/\/127\.0\.0\.1:4397$/.test(base)&&!/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base))throw Error('Synthetic gateway only');
(async()=>{for(const[name,engine,device]of[['android',chromium,'Pixel 7'],['iphone',webkit,'iPhone 13']]){
const browser=await engine.launch({headless:true});const page=await browser.newPage({...devices[device]});page.setDefaultTimeout(25000);const errors=[],outside=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(base)&&!r.url().startsWith('data:'))outside.push(new URL(r.url()).origin)});
try{
await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(credentials.technician);await page.getByLabel('Password',{exact:true}).fill(credentials.password);await page.getByRole('button',{name:'Sign in securely'}).click();await page.waitForURL(u=>!u.pathname.includes('/login'));if(!new URL(page.url()).pathname.startsWith('/field'))await page.goto(base+'/field');
await page.getByRole('button',{name:/Continuar trabajo|Abrir próximo trabajo|Ver trabajo/}).first().click();await page.getByText('DEMO Garden House · Apartment 1',{exact:true}).waitFor();await page.getByText('DEMO Requester',{exact:true}).waitFor();await page.getByText('DEMO Access contact',{exact:true}).waitFor();await page.screenshot({path:process.env.PREVIEW_EVIDENCE_DIR+'/field-'+name+'.png',fullPage:true});assert.deepEqual(errors,[]);assert.deepEqual(outside,[]);
console.log('PASS public '+name+' Field: dwelling, requester, access, current visit persisted');
await page.getByRole('button',{name:/Registrar servicio|Servicio/}).first().click();console.log('FIELD_SERVICE', (await page.locator('body').ariaSnapshot()).slice(-7000));
}catch(e){await page.screenshot({path:process.env.PREVIEW_EVIDENCE_DIR+'/field-failure-'+name+'.png',fullPage:true});console.log((await page.locator('body').ariaSnapshot()).slice(-10000));throw e}finally{await browser.close()}
}})().catch(e=>{console.error(e);process.exitCode=1});
