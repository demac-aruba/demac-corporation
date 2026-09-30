'use strict';
// Actual visible controls and HTTP adapters; deterministic backend, not physical-device proof.
const assert=require('node:assert/strict'),zlib=require('node:zlib');
const views={before:'ANTES',after:'DESPUÉS',during:'Durante el servicio',condition:'Condición observada',exterior:'Vista exterior',interior:'Vista interior',instrument:'Instrumento legible'};
function png(index){
 const crc=b=>{let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
 const chunk=(name,body)=>{const data=Buffer.concat([Buffer.from(name),body]),length=Buffer.alloc(4),checksum=Buffer.alloc(4);length.writeUInt32BE(body.length);checksum.writeUInt32BE(crc(data));return Buffer.concat([length,data,checksum]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(1);ihdr.writeUInt32BE(1,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(Buffer.from([0,index%256,(index*7)%256,(index*13)%256]))),chunk('IEND',Buffer.alloc(0))]);
}
module.exports=async function({browser,companion,type,launchOptions,origin,reset,getState,browserName}){
 reset();const state=getState();await state.claim('indoor');await state.claim('outdoor');
 const contexts=await Promise.all([browser.newContext({viewport:{width:390,height:844}}),companion.newContext({viewport:{width:390,height:844}})]);
 const errors=[],external=[];let officeBrowser;
 for(const context of contexts)await context.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external.push(route.request().url());return route.abort();});
 try{
  const pages=await Promise.all(contexts.map(c=>c.newPage())),[lead,helper]=pages;
  pages.forEach(p=>p.on('pageerror',e=>errors.push(e.message)));
  await Promise.all([lead.goto(origin+'/?actor=test-tech'),helper.goto(origin+'/?actor=test-helper')]);
  async function open(page,part){
   await page.getByRole('button',{name:part==='indoor'?/Evaporadora · Indoor/:/Condensadora · Outdoor/}).click();
   await page.getByRole('button',{name:'Abrir procedimientos',exact:true}).click();
   await page.getByRole('heading',{name:'Procedimientos del servicio',exact:true}).waitFor();
  }
  async function refresh(page){await page.getByRole('button',{name:'Actualizar',exact:true}).click();await page.waitForFunction(()=>!document.body.textContent.includes('Confirmando coordinación con el servidor'));}
  await Promise.all([open(lead,'indoor'),open(helper,'outdoor')]);
  const definition=(await state.read()).workflow.protocol;let imageId=0;
  async function step(page,part,d){
   await refresh(page);
   await page.getByRole('button').filter({hasText:d.title}).click();
   await page.getByRole('heading',{name:d.title,exact:true}).waitFor();
   const photoViews=d.measurement&&!d.views.includes('instrument')?[...d.views,'instrument']:d.views;
   for(const view of photoViews){
    const before=state.store.all('fieldEvidence').length;
    if(d.id==='I01'){
      await page.evaluate(()=>{
        const original=IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add=function(value,...args){
          if(this.name==='captures'){IDBObjectStore.prototype.add=original;throw new DOMException('Synthetic device quota','QuotaExceededError');}
          return original.call(this,value,...args);
        };
      });
      await page.getByLabel('Seleccionar Foto: '+views[view],{exact:true}).setInputFiles({name:'synthetic-quota.png',mimeType:'image/png',buffer:png(++imageId)});
      await page.getByRole('button',{name:'Reintentar protección del original',exact:true}).waitFor();
      await page.getByRole('button',{name:'Volver a procedimientos',exact:true}).click();
      assert.equal(await page.getByRole('heading',{name:d.title,exact:true}).count(),1,'unprotected original blocks step navigation');
      assert.equal(state.store.all('fieldEvidence').length,before);
    }
    const linked=page.waitForResponse(response=>response.request().method()==='POST' && response.request().postData()?.startsWith('{') && response.request().postDataJSON()?.data?.command?.action==='commit_media');
    if(d.id==='I01')await page.getByRole('button',{name:'Reintentar protección del original',exact:true}).click();
    else await page.getByLabel('Seleccionar Foto: '+views[view],{exact:true}).setInputFiles({name:`synthetic-${++imageId}.png`,mimeType:'image/png',buffer:png(imageId)});
    assert.equal((await linked).status(),200);
    assert.equal(state.store.all('fieldEvidence').length,before+1);
   }
   if(d.id==='I01'){
    await page.getByRole('button',{name:'Abrir archivo privado',exact:true}).click();
    const image=page.getByAltText('Evidencia privada del procedimiento');await image.waitFor();
    assert.equal(await image.evaluate(img=>new Promise(resolve=>{if(img.complete)return resolve(img.naturalWidth===1);img.onload=()=>resolve(img.naturalWidth===1);img.onerror=()=>resolve(false);})),true,'actual private PNG decodes');
    assert.match(await image.getAttribute('src'),/^blob:/);
    await page.getByRole('button',{name:'Cerrar archivo',exact:true}).click();
   }
   await page.getByLabel('Observación técnica').fill('Observación sintética exclusiva de '+d.id);
   if(d.options.length)await page.getByLabel('Resultado observado').selectOption(d.options.includes('buen_estado')?'buen_estado':d.options[0]);
   if(d.measurement)await page.getByLabel(d.id==='O02'?'Presión medida':'Medición',{exact:true}).fill(d.id==='O02'?'110':'18');
   if(d.competent)await page.getByLabel(/Confirmo que esta verificación/).check();
   await page.getByRole('button',{name:'Guardar procedimiento',exact:true}).click();
   await page.getByText('Procedimiento documentado y confirmado.',{exact:true}).waitFor();
   const saved=state.store.get('workInterventions','WI-1').procedureWorkflow.parts[part].steps[d.id];
   assert.equal(saved.status,'documented');assert.equal(saved.note,'Observación sintética exclusiva de '+d.id);
   await page.getByRole('button',{name:'Volver a procedimientos',exact:true}).click();
  }
  for(const [part,page] of [['indoor',lead],['outdoor',helper]])for(const d of definition.parts[part].steps.filter(d=>d.stage==='initial'))await step(page,part,d);
  // Review a real requested exception using the actual Office queue and editor.
  await lead.getByRole('button').filter({hasText:'Verificar flapper'}).click();
  await lead.getByText('No pude completar o documentar este procedimiento',{exact:true}).click();
  await lead.getByLabel('Motivo de la excepción',{exact:true}).fill('Limitación documental sintética para revisión');
  await lead.getByRole('button',{name:'Solicitar revisión de excepción',exact:true}).click();
  await lead.getByText('Pendiente de oficina',{exact:true}).waitFor();
  officeBrowser=await type.launch(launchOptions);const officeContext=await officeBrowser.newContext({viewport:{width:1365,height:1000}});
  await officeContext.route('**/*',route=>{if(route.request().url().startsWith(origin+'/'))return route.continue();external.push(route.request().url());return route.abort();});
  const office=await officeContext.newPage();office.on('pageerror',e=>errors.push(e.message));await office.goto(origin+'/?actor=test-office');
  await office.getByRole('button').filter({hasText:'WO-1 · Verificar flapper'}).click();
  await office.getByLabel('Motivo de la revisión',{exact:true}).fill('Revisión documental sintética; no ejecución ficticia');
  await office.getByLabel('Disposición al aprobar',{exact:true}).selectOption('not_documented');
  await office.getByRole('button',{name:'Aprobar excepción con disposición',exact:true}).click();
  await office.getByText('Aprobada por oficina',{exact:true}).waitFor();
  assert.equal(state.store.get('workInterventions','WI-1').procedureWorkflow.parts.indoor.steps.I02.exception.disposition,'not_documented');
  await lead.getByRole('button',{name:'Volver a procedimientos',exact:true}).click();await refresh(lead);
  await lead.getByText('Coordinación para aislamiento',{exact:true}).click();
  await lead.getByLabel(/La verificación fue realizada por persona competente/).check();
  await lead.getByLabel('Nota de coordinación',{exact:true}).fill('Aislamiento físico sintético documentado');
  await lead.getByRole('button',{name:'Confirmar aislamiento documentado',exact:true}).click();
  await lead.getByText('Cambio confirmado por el servidor.',{exact:true}).waitFor();
  for(const [part,page] of [['indoor',lead],['outdoor',helper]]){
   for(const d of definition.parts[part].steps.filter(d=>d.stage==='isolated'))await step(page,part,d);
   await page.getByLabel(/Confirmo que, según lo documentado/).check();
   await page.getByRole('button',{name:'Finalizar mi parte',exact:true}).click();
   await page.getByText('Documentación de parte finalizada. Esto no envía el cierre global del servicio.',{exact:true}).waitFor();
  }
  await refresh(lead);await lead.getByText('Prueba final coordinada — técnico responsable',{exact:true}).click();
  await lead.getByLabel('Resultado de prueba final',{exact:true}).selectOption('no_enfria');
  await lead.getByLabel('Nota de prueba',{exact:true}).fill('Falla sintética persiste; no afirmar reparación');
  await lead.getByLabel(/La prueba fue coordinada y verificada/).check();
  await lead.getByRole('button',{name:'Registrar prueba final',exact:true}).click();
  await lead.getByText('Prueba final confirmada por el servidor.',{exact:true}).waitFor();
  const completed=await state.read();assert.equal(completed.readiness.complete,true);assert.equal(completed.workflow.safety.finalTest.result,'no_enfria');
  const actors=require('../../../functions/test-support/fieldProcedureFixture.cjs');
  const {createTransitionWorkInterventionCommand}=require('../../../functions/fieldOperationsInterventionMutation');
  const {createSubmitOfficeReviewCommand}=require('../../../functions/fieldOperationsOfficeReview');
  const dependencies={db:state.store.db,resolveAssignment:state.resolveAssignment,appendAuditInTransaction:state.appender};
  await createTransitionWorkInterventionCommand(dependencies)({...state.input(),to:'completed',expectedVersion:completed.interventionVersion,requestId:'ui-complete-service'});
  const submit=createSubmitOfficeReviewCommand(dependencies),request={identity:actors.lead,visitId:'VISIT-1',expectedVersion:state.store.get('workVisits','VISIT-1').version,requestId:'ui-office-submit'};
  await assert.rejects(()=>submit({...request,identity:actors.helper}),e=>e.code==='permission_denied');
  const sent=await submit(request);
  const frozen=JSON.stringify(state.store.all('fieldOfficeReviewRevisions'));
  await office.evaluate(raw=>window.showFrozenReview(raw),{success:true,version:1,reviews:[{...sent.review,currentRevision:sent.revision}]});
  await office.getByRole('heading',{name:'Procedimientos · revisión 1',exact:true}).waitFor();
  assert.match(await office.locator('section[aria-label="Procedimientos de la revisión inmutable"]').innerText(),/Prueba final: No enfría/);
  await office.getByText('I01 · Vista amplia inicial · Documentado',{exact:true}).click();
  await office.getByRole('button',{name:'Abrir archivo privado',exact:true}).click();
  await office.getByAltText('Evidencia privada del procedimiento').waitFor();
  assert.equal(JSON.stringify(state.store.all('fieldOfficeReviewRevisions')),frozen,'viewing frozen private evidence creates no revision write');
  assert.equal(Object.keys(completed.workflow.pendingCaptures).length,0);assert.equal(state.store.all('workInterventions').length,1);assert.equal(state.store.all('workVisits').length,1);
  for(const c of ['invoices','inventoryMovements','whatsappOutboundQueue'])assert.equal(state.store.all(c).length,0);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  console.log('PASS complete visible 14/9 workflow, private capture/view, office exception and coordinated final test '+browserName);
  return{browser:browserName,passed:true,checks:['all 14 indoor/9 outdoor controls','unique per-step text and original photo bytes','indoor measurement instrument photo','private hash-verified PNG decoding','Office queue exception approval with disposition','both part completions','coordinated final failure preserved','no invoice/inventory/message effects']};
 }finally{await Promise.all(contexts.map(c=>c.close()));await officeBrowser?.close();}
};
