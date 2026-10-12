'use strict';
// Reproducible offline review artifact. Actual UI/domain helpers; in-memory data only.
// This demonstration is not a server pricing implementation or a deployment target.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const APP = path.resolve(__dirname, '..');
const tooling = process.env.BOOKING_MODAL_TEST_TOOLS;
const destination = process.env.CATALOG_PREVIEW_OUTPUT;
if (!tooling || !destination || !path.isAbsolute(tooling) || !path.isAbsolute(destination)) throw Error('Absolute tooling and HTML output paths required.');
const { build } = require(path.join(tooling, 'node_modules/esbuild'));
const fixtures = [
  { id: 'demo-check', name: 'Revisión de ejemplo', itemType: 'Servicio', category: 'Diagnóstico', sku: 'DEMO-REV', description: 'Diagnóstico y revisión visual. Datos y precio ficticios.', durationMinutes: 60, basePrice: 55, active: true, serviceDefinition: { version: 1, bookingCode: 'demo_revision', duration: { minutes: 60 } } },
  { id: 'demo-deep', name: 'Limpieza de ejemplo · 18,000 BTU', itemType: 'Servicio', category: 'Mantenimiento', sku: 'DEMO-18K', description: 'Limpieza profunda con desmontaje. Ejemplo para probar la selección.', durationMinutes: 120, basePrice: 180, active: true, serviceDefinition: { version: 1, bookingCode: 'demo_limpieza', duration: { minutes: 120 } } },
  { id: 'demo-gas', name: 'Refrigerante de ejemplo', itemType: 'Producto', category: 'Refrigerantes', sku: 'DEMO-R410A', description: 'Precio ficticio por libra; permite cantidades decimales.', durationMinutes: 0, basePrice: 45, active: true },
];
const transport = `
function check(collection){if(collection!=='services')throw Error('Colección no disponible en la demostración');}
export async function listFirestoreCollection(collection){check(collection);return structuredClone(window.__catalog);}
export async function saveFirestoreDocument(collection,item){check(collection);window.__catalog=[...window.__catalog,structuredClone(item)];return structuredClone(item);}
export async function updateFirestoreDocument(collection,id,changes){check(collection);const item=window.__catalog.find(x=>x.id===id);if(!item)throw Error('Artículo inexistente');Object.assign(item,changes);return structuredClone(item);}
`;
const authority = `
import {resolveServicePriceSnapshot} from '../../functions/servicePricingAuthority.js';
export function officeBookingOutcomeUnknown(){return false;}
export async function callOfficeBookingAuthority(action,data){
 if(action==='list_charge_services')return {success:true,services:window.__catalog.filter(item=>item.active!==false).map(({id,name,itemType,description,category,sku,serviceDefinition,durationMinutes})=>({id,name,itemType,description,category,sku,durationMinutes:serviceDefinition?.duration.minutes||durationMinutes||null}))};
 if(action!=='quote_appointment_charges')throw Error('La demostración no registra citas, ventas ni pagos.');
 const capturedAt=new Date().toISOString();
 const lines=data.lines.map(line=>{
  const item=window.__catalog.find(item=>item.id===line.serviceId);let baseUnitCents=null,pendingReason='Selecciona un producto o servicio';
  if(item){try{baseUnitCents=Math.round(resolveServicePriceSnapshot({service:item,btu:line.btu,capturedAt}).unitPrice*100);pendingReason='';}catch(error){pendingReason=error.message;}}
  const manual=line.unitPrice!==''&&line.unitPrice!==null&&line.unitPrice!==undefined;
  if(manual&&!line.reason?.trim())throw Error('Indica el motivo del precio acordado.');
  const unitCents=manual?Math.round(Number(line.unitPrice)*100):baseUnitCents;
  const quantityMillis=Math.round(Number(line.quantity)*1000);
  if(!Number.isFinite(quantityMillis)||quantityMillis<=0)throw Error('La cantidad debe ser mayor que cero.');
  if(unitCents!==null&&(!Number.isFinite(unitCents)||unitCents<0))throw Error('Revisa el precio.');
  return {...line,quantityMillis,baseUnitCents,unitCents,totalCents:unitCents===null?null:Math.round(unitCents*quantityMillis/1000),manualPrice:manual,pendingReason:unitCents===null?pendingReason:'',pricingVersion:'demo',overrideCents:manual?unitCents:null};
 });
 const knownTotalCents=lines.reduce((total,line)=>total+(line.totalCents||0),0);
 return {success:true,quote:{lines,totalCents:lines.some(line=>line.totalCents===null)?null:knownTotalCents,knownTotalCents,currency:'AWG',capturedAt,quoteToken:JSON.stringify(data.lines)}};
}`;
const entry = `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{ServiceCatalogWorkspace}from'./components/service-catalog-workspace';
import{BookingChargesEditor}from'./components/scheduling/appointment-charges';
import'./app/globals.css';
window.__catalog=${JSON.stringify(fixtures)};
const seeds=[{id:'demo-work',workLineId:'demo-work',label:'Visita de servicio · ejemplo',quantity:1,serviceId:'demo-check'}];
function App(){const[tab,setTab]=useState('visit'),[draft,setDraft]=useState(null);
 return <><div className="demo-banner"><b>DEMOSTRACIÓN · Datos ficticios</b><span>Los cambios solo duran mientras esta vista está abierta. No se registran ventas ni pagos.</span></div><header className="demo-head"><div><span className="demo-brand">DEMAC <small>ERP</small></span><h1>Del catálogo al cobro</h1><p>Crea un artículo y selecciónalo en los conceptos de la visita.</p></div><nav aria-label="Vista de demostración"><button aria-pressed={tab==='catalog'} onClick={()=>setTab('catalog')}>1. Productos y servicios</button><button aria-pressed={tab==='visit'} onClick={()=>setTab('visit')}>2. Preparar importe</button></nav></header><main onClick={event=>{if(event.target.closest('a[href="/catalog/"]')){event.preventDefault();setTab('catalog');}}}>{tab==='catalog'?<><p className="demo-guide">Usa <b>+ Service</b> o <b>+ Product</b> para probar el alta. Después abre <b>Preparar importe</b>.</p><ServiceCatalogWorkspace/></>:<><p className="demo-guide">Abre <b>Producto o servicio del catálogo</b> para buscar. Usa <b>Añadir concepto / adicional</b> para agregar otro trabajo o producto. Los precios mostrados son ejemplos.</p><BookingChargesEditor seeds={seeds} value={draft} onChange={setDraft} disabled={false}/></>}</main></>;
}createRoot(document.getElementById('app')).render(<App/>);`;
async function main(){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'demac-catalog-preview-'));
 try{
  await build({absWorkingDir:APP,tsconfig:path.join(APP,'tsconfig.json'),stdin:{contents:entry,loader:'tsx',resolveDir:APP},outfile:path.join(folder,'app.js'),bundle:true,minify:true,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env':JSON.stringify({NODE_ENV:'production'})},plugins:[{name:'offline-only',setup(builder){
   builder.onResolve({filter:/(?:firebase\/(?:firestore-rest|principal)|office-booking-authority)$/},args=>({path:path.basename(args.path),namespace:'demo'}));
   builder.onLoad({filter:/.*/,namespace:'demo'},args=>({contents:args.path==='firestore-rest'?transport:args.path==='principal'?"export async function loadFirebasePrincipal(){return{userId:'demo',displayName:'Operador de ejemplo',role:'operations'};}":authority,loader:'js',resolveDir:APP}));
  }}]});
  const css=fs.readFileSync(path.join(folder,'app.css'),'utf8')+`\nbody{margin:0;background:#f3f6fb;color:#193352;font-family:Arial,sans-serif}button,a{cursor:pointer}.demo-banner{padding:12px 24px;background:#eaf2ff;color:#214a86;display:flex;gap:16px;justify-content:center;font-size:13px;flex-wrap:wrap}.demo-head{max-width:1250px;margin:30px auto 18px;padding:0 24px;display:flex;align-items:center;justify-content:space-between;gap:20px}.demo-brand{font-size:24px;font-weight:800;letter-spacing:2px}.demo-brand small{font-size:12px;color:#698096}.demo-head h1{font-size:24px;margin:10px 0}.demo-head p{color:#61738b;margin:0;font-size:14px}.demo-head nav{display:flex;gap:8px;flex-wrap:wrap}.demo-head button{border:1px solid #cfdded;border-radius:10px;padding:13px 16px;background:#fff;color:#325073;font-weight:700}.demo-head button[aria-pressed=true]{background:#176ce9;border-color:#176ce9;color:white;box-shadow:0 5px 15px #176ce925}main{max-width:1250px;margin:auto;padding:0 24px 40px}.demo-guide{background:white;border:1px solid #e1e8f1;border-radius:12px;font-size:13px;line-height:1.65;padding:16px 20px;color:#486079}@media(max-width:650px){.demo-head{display:block;padding:0 12px;margin-top:20px}.demo-head nav{margin-top:18px}.demo-head button{flex:1;font-size:12px;padding:12px 8px}main{padding:0 10px 24px}.demo-banner{padding:10px 14px;gap:5px}.demo-guide{padding:12px}}`;
  const js=fs.readFileSync(path.join(folder,'app.js'),'utf8').replaceAll('</script','<\\/script');
  const html='<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; font-src data:; connect-src \'none\'; form-action \'none\'"><title>DEMAC · Catálogo interactivo de ejemplo</title><style>'+css+'</style></head><body><div id="app"></div><script>'+js+'</script></body></html>';
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,html);console.log(destination);
 }finally{fs.rmSync(folder,{recursive:true,force:true});}
}main().catch(error=>{console.error(error);process.exitCode=1;});
