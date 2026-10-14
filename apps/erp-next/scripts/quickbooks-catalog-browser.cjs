'use strict';
// Full page and real scan/matching/components; synthetic data and blocked external traffic.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), http = require('node:http'), os = require('node:os');
const app = path.resolve(__dirname, '..'), tooling = process.env.QBO_TEST_TOOLS, output = process.env.QBO_TEST_OUTPUT;
if (![tooling, output].every(value => value && path.isAbsolute(value))) throw Error('Absolute tooling/output paths required.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const { chromium } = require(path.join(tooling, 'node_modules/playwright'));
async function main() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'qbo-comparison-browser-')); fs.mkdirSync(output, { recursive: true });
  await build({ absWorkingDir: app, tsconfig: path.join(app, 'tsconfig.json'), bundle: true, outfile: path.join(folder, 'fixture.js'), jsx: 'automatic',
    stdin: { resolveDir: app, loader: 'tsx', contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{QuickBooksComparisonPage}from'./components/firebase/quickbooks-comparison-page';import'./app/globals.css';
      function Harness(){const[visible,setVisible]=useState(true);window.hide=()=>setVisible(false);return visible?<QuickBooksComparisonPage/>:<p>Cerrado</p>;}createRoot(document.getElementById('root')).render(<React.StrictMode><Harness/></React.StrictMode>);` },
    plugins: [{ name: 'synthetic-catalog', setup(builder) {
      builder.onResolve({ filter: /lib\/firebase\/quickbooks-catalog$/ }, () => ({ path: 'catalog', namespace: 'synthetic' }));
      builder.onResolve({ filter: /lib\/firebase\/quickbooks-connection$/ }, () => ({ path: 'connection', namespace: 'synthetic' }));
      builder.onResolve({ filter: /components\/auth\/auth-provider$/ }, () => ({ path: 'auth', namespace: 'synthetic' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'synthetic' }));
      builder.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ loader: 'js', resolveDir: app, contents: args.path === 'link' ? `import React from'react';export default function Link({children,...props}){return React.createElement('a',props,children);}` : args.path === 'auth' ? `import{useState}from'react';export function useAuth(){const[uid,setUid]=useState('owner');window.changeUid=setUid;return{mode:'firebase',status:'ready',principal:{userId:uid,active:uid!=='signed-out',role:uid==='unauthorized'?'technician':'super_admin'}};}` : args.path === 'connection' ? `export async function readConnectionStatus(){window.statusReads++;return{configured:true,phase:window.disconnected?'disconnected':'connected',connection:{companyName:'DEMAC · Ficticio',connectedAt:'2026-10-14T12:00:00Z'}};}` : `
        export const catalogFailureMessage=()=> 'No se pudo preparar la comparación. Revisa la conexión y vuelve a consultar.';
        const customer=(id,name)=>({id,name,active:true,email:null,company:null,currency:'AWG',parentId:null,isJob:false});
        const item=(id,name,sku,type)=>({id,name,sku,type,active:true,incomeAccountId:'demo-income',expenseAccountId:null,assetAccountId:null});
        export async function readProductionCatalog(uid,input){window.calls.push({uid,input});if(window.waiting)await new Promise(resolve=>window.release=resolve);
          if(window.holdLater&&input.entity==='Customer'&&input.startPosition===101)await new Promise(resolve=>window.releaseLater=resolve);
          if(window.fail)throw Error('private provider text');
          const records=input.entity==='Customer'?(input.startPosition===1?Array.from({length:100},(_,i)=>({...customer('qbo-'+i,i<2?'Cliente de prueba':'Cliente QBO '+i),active:i!==1})):[customer('late','Zoe Demonstration')]):input.entity==='Item'?[item('svc','Mantenimiento QBO','svc-demo','Service'),item('product','Producto QBO','prod-demo','Inventory'),item('mismatch','Tipo distinto','wrong-type','NonInventory')]:[{id:'account',name:'Cuenta ficticia',active:true,type:'Income',subType:'ServiceFeeIncome',currency:'AWG'}];
          return{environment:'production',realmId:'9130352327074466',companyName:'DEMAC · Ficticio',fetchedAt:'2026-10-14T12:00:00Z',request:input,accountingWritesEnabled:false,syncEnabled:false,
            catalog:{pageSize:100,nextStartPosition:records.length===100?101:null,atLimit:false,endOfCurrentQuery:records.length<100,records}};}
        export async function readErpComparisonRows(uid,entity){window.erpReads.push(entity);return entity==='Customer'?[...Array.from({length:250},(_,i)=>({id:'erp-'+i,name:i===0?'Cliente de prueba':'Cliente ERP '+i,active:true})),{id:'erp-late',name:'Zoe Demonstration',active:true}]:entity==='Item'?[{id:'svc-erp',name:'Servicio ERP',sku:'svc-demo',type:'Servicio',active:true},{id:'product-erp',name:'Producto ERP',sku:'prod-demo',type:'Producto',active:true},{id:'mismatch-erp',name:'Servicio con otro tipo',sku:'wrong-type',type:'Servicio',active:true}]:[];}` }));
    } }],
  });
  const server = http.createServer((req,res) => { const asset = req.url === '/fixture.js' ? 'fixture.js' : req.url === '/fixture.css' ? 'fixture.css' : null;
    res.setHeader('Content-Type',asset?.endsWith('.js')?'text/javascript':asset?'text/css':'text/html');res.end(asset?fs.readFileSync(path.join(folder,asset)):'<!doctype html><html lang="es"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>'); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,...(process.env.QBO_TEST_CHROMIUM?{executablePath:process.env.QBO_TEST_CHROMIUM}:{})});
  try {
    for(const width of [1440,375]) {
      const context=await browser.newContext({viewport:{width,height:1000}}), page=await context.newPage(), errors=[],external=[];
      page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>{if(r.request().url().startsWith(origin))return r.continue();external.push(r.request().url());return r.abort();});
      await page.addInitScript(()=>{window.calls=[];window.erpReads=[];window.statusReads=0;window.fail=false;window.waiting=false;window.holdLater=true;const original=window.setTimeout;window.setTimeout=(fn,ms,...args)=>original(fn,ms===5100?10:ms,...args);});
      await page.goto(origin);await page.getByRole('button',{name:'Cargar catálogos',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),0);
      await page.evaluate(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Cargar catálogos');button.click();button.click();});
      await page.waitForFunction(()=>typeof window.releaseLater==='function');assert.equal(await page.evaluate(()=>window.calls.length),2);
      await page.getByRole('searchbox',{name:'Buscar en ambos sistemas'}).fill('Zoe');
      await page.getByRole('row').filter({hasText:'Zoe Demonstration'}).getByText('Sin coincidencia en los registros recibidos todavía',{exact:true}).waitFor();
      await page.evaluate(()=>{window.holdLater=false;window.releaseLater();});await page.getByRole('button',{name:'Actualizar catálogos',exact:true}).waitFor();
      assert.equal(await page.getByRole('cell').filter({hasText:'Zoe Demonstration'}).count(),2);
      assert.deepEqual(await page.evaluate(()=>window.erpReads),['Customer','Item','Account']);
      assert.equal(await page.getByRole('button',{name:'Página siguiente'}).count(),0);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page horizontal overflow');
      await page.getByRole('row').filter({hasText:'Zoe Demonstration'}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`comparison-customer-${width}.png`),fullPage:true});
      await page.evaluate(()=>document.documentElement.dataset.theme='dark');
      const theme=await page.getByRole('table').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el.querySelector('strong')).color}));assert.equal(theme.background,'rgb(16, 28, 45)');assert.equal(theme.color,'rgb(244, 248, 253)');
      await page.screenshot({path:path.join(output,`comparison-customer-dark-${width}.png`),fullPage:true});await page.evaluate(()=>document.documentElement.dataset.theme='light');
      await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:'Inactivos 1',exact:true}).click();await page.getByText('Inactivo',{exact:true}).waitFor();await page.getByRole('button',{name:/Varias coincidencias/}).click();await page.getByText('Varias coincidencias',{exact:true}).waitFor();
      await page.getByRole('button',{name:/^Todos /}).click();
      const table=page.getByRole('table',{name:'Comparación provisional'});await page.waitForFunction(()=>document.querySelectorAll('[role=table] [role=row]').length===101);
      for(let i=0;i<3;i++){const before=await table.locator('[role=row]').count();await page.getByText(/La lista continúa al bajar/).scrollIntoViewIfNeeded();await page.waitForFunction(count=>document.querySelectorAll('[role=table] [role=row]').length>count,before);}
      await page.getByText('349 resultados mostrados',{exact:true}).waitFor();
      assert.equal(await table.getByRole('row',{includeHidden:true}).count(),350,'All ERP/QBO unmatched rows reachable by scroll, no cap');
      const beforeTabs=await page.evaluate(()=>window.calls.length);
      await page.getByRole('button',{name:/^Productos y servicios/}).click();await page.getByText('Servicio ERP',{exact:true}).waitFor();
      await page.getByText('Los tipos de artículo difieren. Revisar antes de vincular.',{exact:true}).waitFor();
      await page.getByLabel('Tipo de artículo',{exact:true}).selectOption('Producto');await page.getByText('Producto ERP',{exact:true}).waitFor();assert.equal(await page.getByText('Servicio ERP',{exact:true}).count(),0);
      await page.getByLabel('Tipo de artículo',{exact:true}).selectOption('all');await page.getByRole('searchbox').fill('svc-demo');await page.getByText('Mantenimiento QBO',{exact:true}).waitFor();
      await page.getByRole('row').filter({hasText:'Mantenimiento QBO'}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,`comparison-items-${width}.png`),fullPage:true});
      assert.equal(await page.evaluate(()=>window.calls.length),beforeTabs,'Tabs/search reuse in-memory observations');
      await page.getByRole('searchbox').fill('');await page.getByRole('button',{name:/^Cuentas contables/}).click();await page.getByRole('table',{name:'Cuentas de QuickBooks'}).waitFor();
      await page.evaluate(()=>window.fail=true);await page.getByRole('button',{name:'Actualizar catálogos',exact:true}).click();await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('table').count(),0);assert.equal(await page.getByText('private provider text').count(),0);
      await page.evaluate(()=>{window.fail=false;window.waiting=true;});await page.getByRole('button',{name:'Cargar catálogos',exact:true}).click();await page.waitForFunction(()=>typeof window.release==='function');
      const readsBefore=await page.evaluate(()=>window.erpReads.length);await page.evaluate(()=>window.changeUid('other'));await page.getByRole('button',{name:'Cargar catálogos',exact:true}).waitFor();
      await page.evaluate(()=>{window.waiting=false;window.release();});await page.waitForTimeout(30);assert.equal(await page.getByRole('table').count(),0);assert.equal(await page.evaluate(()=>window.erpReads.length),readsBefore);
      await page.evaluate(()=>{window.waiting=true;window.release=undefined;});await page.getByRole('button',{name:'Cargar catálogos',exact:true}).click();await page.waitForFunction(()=>typeof window.release==='function');
      await page.getByRole('button',{name:'Detener carga',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Cargando catálogos…',exact:true}).isDisabled(),true);await page.evaluate(()=>{window.waiting=false;window.release();});await page.getByText('Carga detenida. Los resultados recibidos son parciales.',{exact:true}).waitFor();
      const beforeDenied=await page.evaluate(()=>window.calls.length);await page.evaluate(()=>window.changeUid('unauthorized'));await page.getByRole('alert').waitFor();assert.equal(await page.getByRole('button',{name:'Cargar catálogos',exact:true}).count(),0);await page.evaluate(()=>window.changeUid('signed-out'));await page.getByRole('link',{name:'Iniciar sesión en DEMAC ERP'}).waitFor();await page.evaluate(()=>{window.disconnected=true;window.changeUid('disconnected-owner');});await page.getByRole('link',{name:'Ver conexión',exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),beforeDenied);await page.evaluate(()=>{window.disconnected=false;window.changeUid('owner');});await page.getByRole('button',{name:'Cargar catálogos',exact:true}).waitFor();
      await page.evaluate(()=>{window.waiting=true;window.release=undefined;});await page.getByRole('button',{name:'Cargar catálogos',exact:true}).click();await page.waitForFunction(()=>typeof window.release==='function');await page.evaluate(()=>window.hide());await page.getByText('Cerrado',{exact:true}).waitFor();await page.evaluate(()=>window.release());
      assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await context.close();console.log(`Comparison page ${width}: PASS (all-page late match, 251 ERP rows, full scroll, products/SKU/type review, cached tabs, cancellation, identity/unmount/privacy, no external traffic).`);
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(folder,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
