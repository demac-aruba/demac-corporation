'use strict';
// Actual compiled ERP, synthetic data only; every non-local request is intercepted.
const fs=require('node:fs');const path=require('node:path');const http=require('node:http');const assert=require('node:assert/strict');
const {chromium}=require(process.env.MONITOR_PLAYWRIGHT||'playwright');
const ROOT=path.resolve(__dirname,'../../..');const OUT=path.join(__dirname,'../out');const ART=process.env.MONITOR_ARTIFACT_DIR||path.join(ROOT,'messaging-test-artifacts');
const C=require(path.join(ROOT,'functions/whatsappMonitorCore'));fs.mkdirSync(ART,{recursive:true});
const server=http.createServer((req,res)=>{const pathname=decodeURIComponent(new URL(req.url,'http://local').pathname);let file=path.resolve(OUT,`.${pathname}`);if(!file.startsWith(OUT+path.sep))return res.writeHead(403).end();try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'text/plain');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}});
async function main(){
  await new Promise(resolve=>server.listen(4178,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.MONITOR_CHROMIUM?{executablePath:process.env.MONITOR_CHROMIUM,args:['--no-sandbox']}:{})});
  const at=Date.now();const snapshot=C.evaluate({at,queue:[{id:'synthetic-van',notificationType:'van-daily-schedule',vanId:'VAN-2',status:'queued',createdAt:new Date(at-180000),messages:[{},{}],messageIndex:1}],missing:[1,2,3].map(i=>({id:`synthetic-missing-${i}`,flow:'clients',workOrderId:`DEMO-WO-${i}`,appointmentId:`DEMO-CITA-${i}`,dueAtMs:at-320000})),transport:{available:true,lastSuccessAtMs:at-12000},daily:{required:true,batchPresent:true,preflight:{'07:45':{atMs:at,status:'healthy'},'07:55':{atMs:at,status:'healthy'}}}});
  snapshot.incidents=snapshot.incidents.map(x=>({...x,openedAtMs:at,open:true,acknowledgement:null}));
  let unavailable=false;let requests=0;let acknowledgements=0;const errors=[];
  const context=await browser.newContext({viewport:{width:1600,height:1160},serviceWorkers:'block'});
  await context.addInitScript(value=>sessionStorage.setItem('demac.erp-next.firebase.session.v1',JSON.stringify(value)),{uid:'synthetic-operator',email:'qa@example.test',idToken:'synthetic-token',refreshToken:'never-use',expiresAt:at+3600000});
  await context.route('**/*',async route=>{const request=route.request();const url=new URL(request.url());if(url.hostname==='127.0.0.1')return route.continue();const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,content-type','content-type':'application/json'};if(request.method()==='OPTIONS')return route.fulfill({status:204,headers,body:''});
    if(url.hostname==='firestore.googleapis.com'&&/\/users\/[^/]+$/.test(url.pathname))return route.fulfill({status:200,headers,body:JSON.stringify({fields:{role:{stringValue:'office'},active:{booleanValue:true},name:{stringValue:'Operaciones · DEMO'}}})});
    if(url.pathname==='/whatsappMessagingMonitor'){
      const input=request.postDataJSON();requests++;let result;
      if(unavailable)return route.fulfill({status:503,headers,body:JSON.stringify({error:{message:'Comprobación no disponible — prueba aislada'}})});
      if(input.action==='dashboard')result={success:true,version:1,enabled:true,configured:true,canConfigure:false,serverAtMs:Date.now(),snapshot};
      else if(input.action==='history')result={success:true,version:1,items:snapshot.incidents,truncated:false};
      else if(input.action==='acknowledge'){acknowledgements++;const target=snapshot.incidents.find(x=>x.id===input.data.incidentId);target.acknowledgement={uid:'synthetic-operator',name:'Operaciones · DEMO',atMs:Date.now()};result={success:true};}
      else throw Error('Unexpected monitor mutation');
      return route.fulfill({status:200,headers,body:JSON.stringify(result)});
    }
    return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);
  try{
    await page.goto('http://127.0.0.1:4178/settings/system/messaging/');await page.getByRole('heading',{name:'Monitor de mensajería',exact:true}).waitFor();await page.getByText('Hay envíos que requieren atención',{exact:true}).waitFor();assert.equal(requests,1,'shell and panel share one request');
    await page.screenshot({path:path.join(ART,'DEMAC-monitor-implementado-datos-simulados.png'),fullPage:true});
    await page.getByRole('button',{name:'Estoy atendiendo',exact:true}).click();await page.getByRole('dialog').waitFor();await page.getByRole('dialog').getByRole('button',{name:'Estoy atendiendo',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});assert.equal(acknowledgements,1);await page.getByText('En seguimiento · Operaciones · DEMO').waitFor();
    for(const tab of ['Clientes','Técnicos / Vans','Historial','Resumen'])await page.getByRole('button',{name:tab,exact:true}).click();
    await page.getByRole('button',{name:'Avisos externos',exact:true}).click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});
    snapshot.evaluatedAtMs=Date.now()-240000;await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByText('No se puede confirmar el estado de la mensajería',{exact:true}).waitFor();
    unavailable=true;await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByText(/Comprobación no disponible — prueba aislada/).waitFor();
    unavailable=false;snapshot.evaluatedAtMs=Date.now();await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.getByText('Hay envíos que requieren atención',{exact:true}).waitFor();
    await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('heading',{name:'Monitor de mensajería',exact:true}).waitFor();await page.waitForFunction(()=>document.documentElement.scrollWidth<=window.innerWidth+2);
    await page.screenshot({path:path.join(ART,'DEMAC-monitor-movil-datos-simulados.png'),fullPage:true});assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(ART,'summary.json'),JSON.stringify({productionRequests:0,fixture:'synthetic only',passed:['actual ERP route','single shared query','office role','five views','acknowledgement','dialog Escape','stale unknown','API outage','recovery','390px overflow'],requests},null,2));
    console.log('Messaging browser checks passed. Synthetic data; no production requests.');
  }catch(error){await page.screenshot({path:path.join(ART,'failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(0,3000),errors);throw error;}finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
