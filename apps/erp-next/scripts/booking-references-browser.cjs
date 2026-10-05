// Real reference editor, saved editor, technician reader and HTTP client; synthetic transport only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const APP = path.resolve(__dirname, '..');
const output = process.env.REFERENCE_TEST_OUTPUT;
const paths = [process.env.REFERENCE_TEST_TOOLS, process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES].filter(Boolean);
if (!output || !path.isAbsolute(output)) throw Error('Absolute REFERENCE_TEST_OUTPUT required');
const { build } = require(require.resolve('esbuild', { paths }));
const { chromium } = require(require.resolve('playwright', { paths }));
fs.mkdirSync(output, { recursive: true });
const entry = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {VisitReferenceEditor,SavedVisitReferences} from './components/scheduling/booking-visit-references';
import {emptyVisitReferences} from './lib/booking-visit-references';
window.referenceDb=emptyVisitReferences();window.uploads={};window.saves=0;
window.fetch=async function(url,init){const parsed=new URL(url);
 if(parsed.hostname!=='us-central1-demo-demac-references.cloudfunctions.net'||init.headers.Authorization!=='Bearer synthetic-only')throw Error('Unexpected external request');
 const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
 if(window.denyLoad&&init.method!=='POST')return json({error:{message:'Error de carga simulado'}},503);
 if(parsed.searchParams.get('action')==='upload'){const blob=init.body,id=parsed.searchParams.get('uploadId');
 const file={id,fileName:parsed.searchParams.get('fileName'),kind:blob.type.startsWith('image/')?'image':blob.type.startsWith('video/')?'video':'voice',mimeType:blob.type,size:blob.size,description:''};
 window.uploads[id]={file,blob};return json({success:true,file});}
 if(parsed.searchParams.has('fileId'))return new Response(window.uploads[parsed.searchParams.get('fileId')].blob);
 if(init.method==='POST'){if(window.denySave)return json({error:{message:'Error de guardado simulado'}},503);
 const command=JSON.parse(init.body);if(command.expectedVersion!==window.referenceDb.version)return json({error:{message:'Otra operadora actualizó el booking'}},409);
 window.referenceDb={...command.references,version:command.expectedVersion+1};window.saves++;}
 return json({success:true,references:window.referenceDb});
};
function Fixture(){const [value,setValue]=useState(emptyVisitReferences);const [busy,setBusy]=useState(false);const [mode,setMode]=useState('create');
 return <main style={{maxWidth:720,margin:'auto'}}><h1>Referencias del booking</h1><p>Booking de prueba · servicio de aire acondicionado</p>
 {mode==='create'?<><VisitReferenceEditor value={value} onChange={setValue} onBusyChange={setBusy}/><button disabled={busy} onClick={()=>{window.referenceDb={...value,version:1};setMode('saved')}}>Confirmar booking de prueba</button></>:<SavedVisitReferences key={mode} {...(mode==='reader'?{workOrderId:'WO-SYNTHETIC'}:{appointmentId:'APT-SYNTHETIC',canEdit:true})}/>}
 <nav><button onClick={()=>setMode('reader')}>Vista del técnico</button><button onClick={()=>setMode('saved')}>Editar booking</button></nav></main>;
}createRoot(document.getElementById('app')).render(<Fixture/>);`;
async function runCase(browser, origin, name, viewport, dark) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage(); const errors = [], external = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (route.request().url().startsWith(origin + '/')) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  try {
    await page.goto(origin); if (dark) await page.locator('body').evaluate(el => el.classList.add('dark'));
    await page.getByLabel('Indicaciones para el técnico y ayudante').fill('Revisar fuga del aire de la cocina.');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=', 'base64');
    for (const [label, filename, type, bytes] of [['Añadir fotos','cocina.png','image/png',png],['Añadir video','fuga.mp4','video/mp4',Buffer.from('synthetic-video')],['Añadir audio','cliente.opus','audio/ogg',Buffer.from('synthetic-voice')]]) {
      await page.getByLabel(label, { exact: true }).setInputFiles({ name: filename, mimeType: type, buffer: bytes });
      await page.getByRole('button', { name: new RegExp(filename.replace('.', '\\.')) }).first().waitFor();
      await page.getByText('Subiendo archivos… Espera antes de confirmar el booking.').waitFor({ state: 'hidden' });
    }
    await page.getByLabel('Explicación de esta foto').fill('Fuga en la conexión del lado derecho.');
    await page.getByLabel('Explicación de este video').fill('Ruido al encender.');
    await page.getByLabel('Explicación de este audio').fill('Indicaciones del cliente.');
    await page.getByLabel('Subir cliente.opus').click();
    await page.getByLabel('Ubicación GPS del trabajo').fill('https://maps.google.com/?q=12.52,-70.02');
    await page.getByLabel('Referencia de acceso').fill('Entrada lateral');
    await page.getByRole('button', { name: '1. Foto · cocina.png', exact: true }).click();
    await page.getByRole('img', { name: 'Fuga en la conexión del lado derecho.' }).waitFor();
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.screenshot({ path: path.join(output, name + '-create.png'), fullPage: true });
    await page.getByRole('button', { name: 'Confirmar booking de prueba' }).click();
    await page.getByRole('button', { name: 'Guardar referencias' }).waitFor();
    await page.getByLabel('Indicaciones para el técnico y ayudante').fill('El cliente envió nuevos detalles después del booking.');
    await page.evaluate(() => { window.denySave = true; });
    await page.getByRole('button', { name: 'Guardar referencias' }).click();
    await page.getByRole('alert').filter({ hasText: 'Error de guardado simulado' }).waitFor();
    assert.equal(await page.getByLabel('Indicaciones para el técnico y ayudante').inputValue(), 'El cliente envió nuevos detalles después del booking.');
    await page.evaluate(() => { window.denySave = false; });
    await page.getByRole('button', { name: 'Guardar referencias' }).click();
    await page.getByRole('status').filter({ hasText: 'Referencias guardadas.' }).waitFor();
    const saved = await page.evaluate(() => ({ refs: window.referenceDb, saves: window.saves }));
    assert.equal(saved.refs.version, 2); assert.equal(saved.saves, 1);
    assert.deepEqual(saved.refs.files.map(file => file.kind), ['image', 'voice', 'video']);
    assert.equal(saved.refs.files[0].description, 'Fuga en la conexión del lado derecho.');
    await page.screenshot({ path: path.join(output, name + '-edit.png'), fullPage: true });
    await page.getByRole('button', { name: 'Vista del técnico' }).click();
    await page.getByRole('link', { name: 'Cómo llegar · Entrada lateral' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Guardar referencias' }).count(), 0);
    assert.equal(await page.locator('textarea').count(), 0);
    await page.getByRole('button', { name: '1. cocina.png', exact: true }).click();
    await page.getByRole('img', { name: 'Fuga en la conexión del lado derecho.' }).waitFor();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
    await page.screenshot({ path: path.join(output, name + '-technician.png'), fullPage: true });
    await page.evaluate(() => { window.denyLoad = true; });
    await page.getByRole('button', { name: 'Editar booking' }).click();
    await page.getByRole('button', { name: 'Reintentar carga' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Guardar referencias' }).count(), 0);
    await page.evaluate(() => { window.denyLoad = false; });
    await page.getByRole('button', { name: 'Reintentar carga' }).click();
    await page.getByLabel('Explicación de esta foto').waitFor();
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    return { name, result: 'PASS', uploads: 3, saveRecovery: true, loadRecovery: true, externalRequests: 0 };
  } catch (error) { await page.screenshot({ path: path.join(output, name + '-failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally { await context.close(); }
}
async function main() {
  const stubs = { session: `export async function requireFirebaseWebSession(){return {idToken:'synthetic-only'};}`,
    'client-config': `export const firebaseClientConfig={projectId:'demo-demac-references'};`,
    'isolated-preview': `export function firebaseTransportUrl(url){return url;}`,
    'next/image': `export default function Image({unoptimized,...props}){return <img {...props}/>;}` };
  await build({ absWorkingDir: APP, tsconfig: path.join(APP, 'tsconfig.json'), stdin: { contents: entry, loader: 'tsx', resolveDir: APP }, outfile: path.join(output, 'app.js'), bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    plugins: [{ name: 'synthetic-reference-transport', setup(b) {
      b.onResolve({ filter: /.*/ }, args => { const key = args.path === 'next/image' ? args.path : path.basename(args.path); if (stubs[key]) return { path: key, namespace: 'synthetic' }; });
      b.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: stubs[args.path], loader: 'tsx', resolveDir: APP }));
    } }] });
  const server = http.createServer((req, res) => {
    if (['/app.js','/app.css'].includes(req.url)) { res.setHeader('Content-Type', req.url.endsWith('.js') ? 'application/javascript' : 'text/css'); return res.end(fs.readFileSync(path.join(output, req.url.slice(1)))); }
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Booking references — synthetic verification</title><link rel="stylesheet" href="/app.css"><style>*{box-sizing:border-box}body{font:15px Arial;margin:12px;background:var(--surface);color:var(--text);--surface:#fff;--text:#13233b;--muted:#55647a;--border:#cdd8e4;--brand:#1465ff}body.dark{--surface:#162033;--text:#f2f5fc;--muted:#acbbd2;--border:#465672}nav{display:flex;gap:8px;margin-top:20px;flex-wrap:wrap}main>button,nav button{padding:12px;margin-top:12px}h1{font-size:22px}</style></head><body><div id="app"></div><script src="/app.js"></script></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  console.log('Synthetic verification server: ' + origin);
  let browser;
  try {
    if (process.env.REFERENCE_AGENT_BROWSER) {
      const run = promisify(execFile); const cli = process.env.REFERENCE_AGENT_BROWSER;
      const args = ['--session','booking-reference-verification','--executable-path',process.env.REFERENCE_CHROMIUM,'--args','--no-sandbox'];
      try {
        await run(cli, [...args,'open',origin]);
        const snapshot = await run(cli, [...args,'snapshot','-i']);
        assert.match(snapshot.stdout, /Añadir fotos/);
        fs.writeFileSync(path.join(output,'agent-browser-snapshot.txt'), snapshot.stdout);
        await run(cli, [...args,'screenshot',path.join(output,'agent-browser-initial.png')]);
        const checked = await run(cli, [...args,'eval',`JSON.stringify({overlay:!!document.querySelector('nextjs-portal'),content:document.body.textContent.includes('Información para la visita')})`]);
        fs.writeFileSync(path.join(output,'agent-browser-check.txt'), checked.stdout);
      } finally { await run(cli, [...args,'close']).catch(() => {}); }
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.REFERENCE_CHROMIUM || undefined, args: ['--no-sandbox'] });
    const results = [];
    results.push(await runCase(browser, origin, 'desktop', { width: 1280, height: 960 }, false));
    results.push(await runCase(browser, origin, 'mobile-dark', { width: 320, height: 820 }, true));
    fs.writeFileSync(path.join(output,'results.json'), JSON.stringify(results,null,2)); console.log(JSON.stringify(results));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
