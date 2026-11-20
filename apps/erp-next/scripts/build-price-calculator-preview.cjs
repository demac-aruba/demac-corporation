// Isolated preview/export of the production calculator component. No Firebase session or API.
const fs = require('node:fs');
const path = require('node:path');
const app = path.resolve(__dirname, '..');
const output = process.env.PRICE_CALCULATOR_OUTPUT;
if (!output || !path.isAbsolute(output)) throw Error('Set PRICE_CALCULATOR_OUTPUT to an absolute output directory.');
const esbuild = require(path.join(process.env.PRICE_CALCULATOR_TOOLS, 'node_modules/esbuild'));
// An owner-private preview can start with the operator's saved example.
// The ERP bundle and the default standalone export start with an empty purchase.
const examplePath = process.env.PRICE_CALCULATOR_EXAMPLE;
const exampleDraft = examplePath
  ? require('../../../functions/supplierBillCosting.js').openDraft(fs.readFileSync(examplePath, 'utf8'))
  : undefined;
const temporary = path.join(output, '.bundle');
fs.mkdirSync(temporary, { recursive: true });
esbuild.buildSync({ stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import { PriceCalculator } from './components/finance/price-calculator'; createRoot(document.getElementById('calculator')).render(<PriceCalculator exampleDraft={${JSON.stringify(exampleDraft)}}/>);`, resolveDir: app, loader: 'tsx' },
  outfile: path.join(temporary, 'app.js'), bundle: true, format: 'iife', jsx: 'automatic', tsconfigRaw: {}, minify: true,
  define: { 'process.env.NODE_ENV': '"production"' }, nodePaths: [path.join(app, 'node_modules')],
});
const script = fs.readFileSync(path.join(temporary, 'app.js'), 'utf8').replace(/<\/script/gi, '<\\/script');
const style = fs.readFileSync(path.join(app, 'app/globals.css'), 'utf8') + '\n' + fs.readFileSync(path.join(temporary, 'app.css'), 'utf8');
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>DEMAC · Cálculo de precios</title><style>${style}\n.erp-content{padding:10px}.erp-topbar{justify-content:space-between}.preview-note{color:var(--muted);font-size:12px}.preview-brand{display:flex;align-items:center;gap:10px}.theme-toggle{padding:7px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);cursor:pointer}@media(max-width:1000px){.erp-sidebar{display:none}.erp-main{margin-left:0}.erp-topbar{flex-wrap:wrap;height:auto;min-height:62px;padding:12px}}@media print{.erp-sidebar,.erp-topbar{display:none}.erp-main{margin:0}.erp-content{padding:0}}</style></head><body><div class="erp-frame"><aside class="erp-sidebar"><div class="brand-block"><div class="brand-mark">D</div><div><strong>DEMAC</strong><span>ERP NEXT</span></div></div><nav class="side-nav" aria-label="Calculadora"><div class="nav-group-label">COMPRAS</div><a href="#calculator" class="nav-item active"><span class="nav-glyph">CP</span><span>Cálculo de precios</span></a></nav><div class="sidebar-footer"><strong>Cálculo independiente</strong><small>Trabaja con tus propios datos.</small></div></aside><div class="erp-main"><header class="erp-topbar"><div class="preview-brand"><strong>DEMAC</strong><span class="preview-note">Calculadora independiente · lista para usar</span></div><button class="theme-toggle" onclick="document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark'">Cambiar tema</button></header><main class="erp-content" id="calculator"></main></div></div><script>${script}</script></body></html>`;
fs.writeFileSync(path.join(output, 'DEMAC_Calculo_de_Precios.html'), html);
fs.mkdirSync(path.join(output, 'dist'), { recursive: true });
fs.writeFileSync(path.join(output, 'dist/index.html'), html);
fs.mkdirSync(path.join(output, '.openai'), { recursive: true });
fs.writeFileSync(path.join(output, '.openai/hosting.json'), JSON.stringify({ static: { directory: 'dist' } }));
console.log(path.join(output, 'DEMAC_Calculo_de_Precios.html'));
