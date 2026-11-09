// Build an isolated QA surface using the actual UI and transport. No production Firebase configuration.
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const output = process.env.SUPPLIER_PREVIEW_OUTPUT;
if (!output || !path.isAbsolute(output)) throw Error('Set SUPPLIER_PREVIEW_OUTPUT to an isolated absolute directory.');
const esbuild = require(path.join(process.env.SUPPLIER_TEST_TOOLS, 'node_modules/esbuild'));
fs.mkdirSync(path.join(output, 'dist'), { recursive: true });
const mocks = {
  'session': `export async function requireFirebaseWebSession(){return {uid:'synthetic-owner',idToken:'synthetic-token'}} export function loadFirebaseWebSession(){return {uid:'synthetic-owner'}}`,
  'client-config': `export const firebaseClientConfig={projectId:'demo-supplier-bills'};`,
  'isolated-preview': `export function firebaseTransportUrl(){return '/api'}`,
};
esbuild.build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {SupplierBillWorkspace} from './components/finance/supplier-bill-workspace';createRoot(document.getElementById('app')).render(<SupplierBillWorkspace close={()=>location.reload()}/>);`, resolveDir: app, loader: 'tsx' },
  outfile: path.join(output, 'dist/app.js'), bundle: true, format: 'iife', jsx: 'automatic', minify: false, tsconfigRaw: {},
  nodePaths: [path.join(app,'node_modules')],
  plugins: [{ name:'synthetic-session', setup(build) { build.onLoad({filter:/\/lib\/firebase\/(session|client-config|isolated-preview)\.ts$/},args=>({contents:mocks[path.basename(args.path,'.ts')],loader:'ts'})); } }],
}).catch(error=>{console.error(error.message);process.exitCode=1;});

fs.writeFileSync(path.join(output, "dist/index.html"), "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>DEMAC Compras \u2014 prueba aislada</title><link rel=\"stylesheet\" href=\"/app.css\"><style>:root{--text:#182f4b;--muted:#65758a;--surface:#fff;--surface-2:#f4f7fb;--border:#e2e9f1;--border-strong:#cbd6e4;--brand:#1670e9;--brand-soft:#edf4ff;--purple:#7b4de1;--success-soft:#e7f7ee;--warning:#cf8d06;--warning-soft:#fff6dc;--danger:#c32f36;--radius-md:12px;--shadow-soft:0 4px 16px #192e4a08}*{box-sizing:border-box}body{margin:0;background:#eef3f9;font:14px Arial,sans-serif}nav{padding:16px 25px;background:#0c2341;color:white;display:flex;gap:20px;align-items:center}nav b{font-size:22px}#testing{padding:12px 25px;background:#e3ecf8;display:flex;gap:10px;flex-wrap:wrap}#testing button{padding:7px;border:1px solid #b7c9e1;border-radius:6px;background:white;color:#24456d;cursor:pointer}</style><nav><b>DEMAC</b><span>Compras \u00b7 Prueba aislada con datos ficticios</span></nav><div id=\"testing\"><button onclick=\"mode('drop')\">Simular corte despu\u00e9s de guardar</button><button onclick=\"mode('conflict')\">Simular edici\u00f3n simult\u00e1nea</button><button onclick=\"mode('finance',true)\">Rol Finanzas</button><button onclick=\"mode('admin',true)\">Rol Administrador</button><span id=\"test-status\"></span></div><div id=\"app\"></div><script>async function mode(name,reload){await fetch('/__test/'+name,{method:'POST'});document.getElementById('test-status').textContent='Simulaci\u00f3n preparada';if(reload)location.reload()}</script><script src=\"/app.js\"></script></html>");
fs.writeFileSync(path.join(output, 'package.json'), JSON.stringify({name:'supplier-drafts-isolated-qa',private:true,scripts:{dev:'node server.cjs'}}));
esbuild.buildSync({entryPoints:[path.join(__dirname,'supplier-bill-preview-server.cjs')],bundle:true,platform:'node',outfile:path.join(output,'server.cjs'),tsconfigRaw:{}});
