'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {TransactionalFirestore}=require('./test-support/transactionalFirestore');
const {createServiceCatalogEditing}=require('./serviceCatalogEditing');
function fixture(seed={}) {
 const db=new TransactionalFirestore({'users/office':{active:true,role:'office',name:'Synthetic office'},'users/admin':{active:true,role:'admin'},'users/other':{active:true,role:'office'},'users/reader':{active:true,role:'technician'},...seed});
 const api=createServiceCatalogEditing({db,clock:()=>new Date('2026-10-12T12:00:00Z')});
 const call=(action,data={},uid='office')=>api.execute({action,data,uid});
 const save=(id,patch,expectedToken=null,uid='office')=>call('save_catalog_item',{id,patch,expectedToken},uid);
 return {db,call,save};
}
const service=(overrides={})=>({name:'Synthetic service',itemType:'Servicio',durationMinutes:60,basePrice:125,active:true,category:'Service',serviceDefinition:{version:1,bookingCode:'synthetic_service',duration:{minutes:60}},...overrides});
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code);
test('uniqueness uses the booking consumer identity for versionless and fallback legacy definitions',async()=>{
 for(const legacy of [service({serviceDefinition:{bookingCode:'synthetic_service',duration:{minutes:60}}}),service({bookingCode:'synthetic_service',serviceDefinition:{}}),service({serviceDefinition:{}})]) {
  const {save}=fixture({'services/synthetic_service':legacy});await rejects(save('new',service()),'catalog_code_conflict');
 }
});
test('catalog reads are read-only; current active roles are checked on every mutation and retry',async()=>{
 const {db,call,save}=fixture();const before=[...db.store];await call('list_managed_catalog',{},'reader');assert.deepEqual([...db.store],before);
 for(const uid of ['reader','missing'])await rejects(save('one',service(),null,uid),'permission_denied');
 await save('one',service());db.write('users/office',{active:false,role:'office'});await rejects(save('one',service()),'permission_denied');
});
test('empty stays unpriced, explicit zero stays zero; corrupt/coerced prices are rejected atomically',async()=>{
 for(const price of [null,0,125.25]) {const {save}=fixture();const {item}=await save('one',service({basePrice:price}));assert.equal(item.basePrice,price);}
 for(const price of ['', ' ', false, [], {}, -1, 1.001, '125', 1000001]) {const {save,db}=fixture();const before=[...db.store];await rejects(save('one',service({basePrice:price})),'catalog_price');assert.deepEqual([...db.store],before);}
});
test('concurrent creates cannot claim the same booking identity',async()=>{
 const {save,db}=fixture();const results=await Promise.allSettled([save('one',service()),save('two',service(),null,'other')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'catalog_code_conflict');
 assert.equal([...db.store.keys()].filter(k=>/^services\/[^/]+$/.test(k)).length,1);
});
test('legacy duplicates fail closed and renaming/deactivating releases only the owner claim',async()=>{
 const {save,call,db}=fixture({'services/legacy':service()});await rejects(save('one',service()),'catalog_code_conflict');
 const legacy=(await call('list_managed_catalog')).items[0];const updated=(await save('legacy',{active:false},legacy.catalogToken)).item;
 const fresh=(await save('one',service())).item;assert.equal(fresh.active,true);
 await rejects(save('legacy',{active:true},updated.catalogToken),'catalog_code_conflict');assert.equal(db.read('services/legacy').active,false);
});
test('two stale editors cannot overwrite, unknown fields and creation metadata survive, payload identity is server-owned',async()=>{
 const old={...service(),custom:{preserve:true},createdAt:'2020-01-01',createdById:'original'};
 const {call,save,db}=fixture({'services/one':old});const opened=(await call('list_managed_catalog')).items[0];
 const results=await Promise.allSettled([save('one',{name:'First',createdById:'forged',custom:'discard'},opened.catalogToken),save('one',{description:'Other'},opened.catalogToken,'other')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'catalog_conflict');
 const item=db.read('services/one');assert.deepEqual(item.custom,old.custom);assert.equal(item.createdById,'original');assert.equal(item.createdAt,'2020-01-01');
});
test('exact retry survives response loss without duplicate items or audit; changed payload does not replay',async()=>{
 const {save,db}=fixture();const first=await save('one',service());const retry=await save('one',service());assert.equal(retry.replayed,true);assert.deepEqual(retry.item,first.item);
 await rejects(save('one',service({basePrice:126})),'catalog_replay');assert.equal([...db.store.keys()].filter(k=>k.includes('/catalogEvents/')).length,1);
 const patch={description:'Edited'};await save('one',patch,first.item.catalogToken);assert.equal((await save('one',patch,first.item.catalogToken)).replayed,true);
});
test('tokens include old records without revision and detect external changes; stale retry cannot adopt a fresh token',async()=>{
 const {call,save,db}=fixture({'services/one':service()});const old=(await call('list_managed_catalog')).items[0];db.write('services/one',{...service(),basePrice:150});
 await rejects(save('one',{description:'Stale'},old.catalogToken),'catalog_conflict');assert.equal(db.read('services/one').basePrice,150);
});
test('type, currency, invalid tiers and mismatched duration are protected; unknown pricing fields survive',async()=>{
 const {save}=fixture();const first=await save('one',service({pricingDefinition:{version:1,mode:'fixed',currency:'AWG',future:{preserve:true}}}));
 for(const patch of [{itemType:'Producto'},{pricingDefinition:{version:1,mode:'fixed',currency:'USD'}},{pricingDefinition:{version:1,mode:'tiered_btu',currency:'AWG',tiers:[{amount:null}]}},{serviceDefinition:{version:1,bookingCode:'changed',duration:{minutes:90}}}]) await assert.rejects(save('one',patch,first.item.catalogToken));
 const edited=await save('one',{pricingDefinition:{version:1,mode:'per_unit',currency:'AWG'}},first.item.catalogToken);assert.deepEqual(edited.item.pricingDefinition.future,{preserve:true});
});
test('deletion keeps role/linked work guards, exact retry and audit; direct unsafe recreations cannot replace history',async()=>{
 const {save,call,db}=fixture();const {item}=await save('one',service());
 const request={id:'one',expectedToken:item.catalogToken};await rejects(call('delete_catalog_item',request),'permission_denied');
 db.write('workOrders/linked',{serviceId:'one'});await rejects(call('delete_catalog_item',request,'admin'),'catalog_linked');db.store.delete('workOrders/linked');
 assert.equal((await call('delete_catalog_item',request,'admin')).item,null);assert.equal((await call('delete_catalog_item',request,'admin')).replayed,true);
 assert.equal(db.read('services/one'),undefined);assert.equal([...db.store.keys()].filter(k=>k.includes('/catalogEvents/')).length,2);
 await rejects(save('one',service(),null,'other'),'catalog_identity_retired');
});
test('partial duration patches and ambiguous or invalid BTU prices cannot corrupt definitions',async()=>{
 const {save}=fixture();const {item}=await save('one',service());
 for(const patch of [{durationMinutes:90},{serviceDefinition:null},{pricingDefinition:null},{pricingDefinition:{version:1,mode:'tiered_btu',currency:'AWG',tiers:[{minBtu:9000,maxBtu:18000,amount:125},{minBtu:18000,maxBtu:24000,amount:135}]}},{pricingDefinition:{version:1,mode:'tiered_btu',currency:'AWG',tiers:[{amount:1.001}]}},{pricingDefinition:{version:1,mode:'tiered_btu',currency:'AWG',tiers:[{minBtu:24000,maxBtu:9000,amount:100}]}}]) await assert.rejects(save('one',patch,item.catalogToken));
 const updated=await save('one',{durationMinutes:90,serviceDefinition:{version:1,bookingCode:'synthetic_service',duration:{minutes:90}}},item.catalogToken);assert.equal(updated.item.durationMinutes,90);
});
test('catalog pages preserve more than 1000 records and legacy uniqueness scans all pages',async()=>{
 const seed=Object.fromEntries(Array.from({length:1003},(_,i)=>[`services/item-${String(i).padStart(4,'0')}`,service({serviceDefinition:{version:1,bookingCode:`code_${i}`,duration:{minutes:60}}})]));
 const {call,save}=fixture(seed);let cursor=null,items=[];
 do{const page=await call('list_managed_catalog',{cursor});assert.ok(page.items.length<=200);items.push(...page.items);cursor=page.nextCursor;}while(cursor);
 assert.equal(items.length,1003);assert.equal(new Set(items.map(item=>item.id)).size,1003);
 await rejects(save('new',service({serviceDefinition:{version:1,bookingCode:'code_1002',duration:{minutes:60}}})),'catalog_code_conflict');
 assert.equal((await save('new',service())).success,true);
});
