'use strict';

const C = require('./whatsappMonitorCore');
const { role } = require('./performanceTelemetryService');
const { confirmationEligible, customerVisibleChanges, selectedRecipients } = require('./appointmentNotificationService');
const { normalizeWhatsAppPhone } = require('./whatsappTransactionalService');
const { sameDayScheduleChangeRequired, isAdhocSupportOrder, supportPrimaryOrder } = require('./technicianScheduleChangeService');
const { canonicalizeVanCatalog, resolveCanonicalVanId } = require('./bookingVanIdentity');
const { createOperatingCalendarService } = require('./operatingCalendarService');
const { createTechnicianDailyScheduleService, planVanDailyMessages, groupConfigForVan, deterministicQueueId,
  deterministicLunchQueueId, deterministicPendingQueueId } = require('./technicianDailyScheduleService');

const READ_ROLES = new Set(['super_admin','operations','office_operator']);
const LIMIT = 400;
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function boundedReader(db, max = 2000) {
  let reads = 0;
  const wrap = (source, limit = LIMIT + 1) => ({
    where: (...args) => wrap(source.where(...args), limit), limit: value => wrap(source.limit(Math.min(value,LIMIT + 1)), Math.min(value,LIMIT + 1)),
    async get() {
      if (reads >= max) fail('read_budget', 'Monitoring read budget reached.');
      const snap = await (source.limit ? source.limit(limit) : source).get();
      reads += snap.docs ? snap.docs.length : 1;
      if (reads > max || snap.docs?.length > LIMIT) fail('read_budget', 'Monitoring read budget reached.');
      return snap;
    },
    doc: id => wrap(source.doc(id)),
  });
  return { collection: name => wrap(db.collection(name)), count: () => reads };
}
function createMessagingMonitor({ db, verifyIdToken, timestamp = ms => new Date(ms), now = Date.now, enabled = false,
  readTransport = async () => ({ available: false }), publishSignals = async () => {} }) {
  const controlRef = db.doc(C.PATHS.control);
  const snapshotRef = db.doc(C.PATHS.snapshot);
  async function policy() {
    const record = (await controlRef.get()).data() || {};
    return { ...record, enabled: enabled && record.enabled === true && Number.isFinite(record.startedAtMs), configured: enabled };
  }
  async function observeOrder({ id, before, after, sourceAtMs }) {
    const control = await policy();
    if (!control.enabled || !after || sourceAtMs < control.startedAtMs || !Number.isFinite(sourceAtMs)) return { observed: false };
    const date = C.localDate(sourceAtMs);
    const clock = new Date(sourceAtMs - 4*3600000).toISOString().slice(11,16);
    const customer = confirmationEligible(after) && (!before || !confirmationEligible(before) || customerVisibleChanges(before,after).length > 0);
    const technician = sameDayScheduleChangeRequired(before,after,{ date, time: clock });
    if (!customer && !technician) return { observed: false };
    const targets = [];
    const reader = boundedReader(db,1000);
    if (customer) {
      const clientSnapshot = C.safeId(after.clientId) ? await reader.collection('clients').doc(after.clientId).get() : null;
      const client = clientSnapshot?.exists ? { id: clientSnapshot.id, ...clientSnapshot.data() } : null;
      const recipients = client ? selectedRecipients(after,client,'confirmation') : [];
      for (const recipient of recipients) targets.push({ flow: 'clients', recipientId: String(recipient.id || recipient.sourceId || normalizeWhatsAppPhone(recipient.whatsapp || recipient.phone)), notificationType: 'appointment-confirmation' });
      if (recipients.length) for (const recipient of (after.notificationRecipients || []).filter(item=>item.sendConfirmation===true)) {
        if (!normalizeWhatsAppPhone(recipient.whatsapp || recipient.phone)) targets.push({flow:'clients',recipientId:String(recipient.id || recipient.sourceId || ''),configurationError:true,notificationType:'appointment-confirmation'});
      }
      if (!recipients.length) targets.push({ flow: 'clients', recipientId: '', configurationError: true, notificationType: 'appointment-confirmation' });
    }
    if (technician) {
      const catalog = canonicalizeVanCatalog((await reader.collection('vans').get()).docs.map(doc => ({ id: doc.id, ...doc.data() })));
      const vanIds = [resolveCanonicalVanId(after.vanId,catalog.aliases) || String(after.vanId || '')];
      if (isAdhocSupportOrder(after)) {
        const siblings = (await reader.collection('workOrders').where('appointmentId','==',after.appointmentId || '').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const primary = supportPrimaryOrder({ workOrders: siblings },after);
        const primaryId = resolveCanonicalVanId(primary?.vanId || after.supportPrimaryVanId,catalog.aliases);
        if (primaryId && !vanIds.includes(primaryId)) vanIds.push(primaryId);
        else targets.push({ flow: 'technicians', vanId: '', configurationError: true, notificationType: 'van-adhoc-support-change' });
      }
      for (const vanId of vanIds) {
        const van = catalog.vans.find(item => item.id === vanId);
        const config = groupConfigForVan(van);
        if (van && !config.enabled) continue;
        targets.push({ flow: 'technicians', vanId, configurationError: !van || !config.valid,
          notificationType: isAdhocSupportOrder(after) ? 'van-adhoc-support-change' : 'van-same-day-schedule-change' });
      }
    }
    if (targets.length > 50) fail('target_budget', 'Recipient monitoring bound reached.');
    const ref = db.collection(C.PATHS.expectations).doc(C.hash(id));
    return db.runTransaction(async tx => {
      const [current, freshControl] = await tx.getAll(ref,controlRef);
      if (freshControl.data()?.enabled !== true || sourceAtMs < freshControl.data()?.startedAtMs || (current.data()?.sourceAtMs || 0) >= sourceAtMs) return { observed: false };
      tx.set(ref, { workOrderId: id, appointmentId: C.safeId(after.appointmentId), sourceAtMs, fingerprint: C.orderFingerprint(after),
        date: String(after.date || ''), active: true, targets, expiresAt: timestamp(sourceAtMs + 45*86400000) });
      return { observed: true };
    });
  }
  async function dailyPlan(reader, date, at, control) {
    const calendar = createOperatingCalendarService({ db: reader });
    const open = await calendar.isOpenDate(date);
    const dueAtMs = C.dayStart(date) + 8*3600000; // Existing canonical producer schedule; do not change it here.
    const ref = db.collection(C.PATHS.days).doc(date);
    const saved = (await ref.get()).data();
    const required = open && control.startedAtMs <= dueAtMs;
    let plan = saved || { date, entries: [], preflight: {}, capturedAtMs: null };
    const preflightWindow = at >= dueAtMs-15*C.MINUTE && at < dueAtMs;
    const capture = required && (preflightWindow || (at >= dueAtMs && !saved?.frozen));
    if (capture) {
      const day = await createTechnicianDailyScheduleService({ db: reader }).loadDay(date);
      const entries = [];
      for (const van of day.vans) {
        const config = groupConfigForVan(van);
        if (!config.enabled) continue;
        const planned = planVanDailyMessages({ van, dateKey: date, day });
        for (const item of planned.timeline) {
          const queueId = item.type === 'work' ? deterministicQueueId({ dateKey: date, vanId: van.id, order: item.order })
            : item.type === 'lunch' ? deterministicLunchQueueId({ dateKey: date, vanId: van.id }) : deterministicPendingQueueId({ dateKey: date, vanId: van.id, slot: item.slot });
          entries.push({ queueId, flow:'technicians', vanId:van.id, workOrderId:item.order?.id || '', appointmentId:item.order?.appointmentId || '', configurationError:!config.valid });
        }
      }
      if (entries.length > LIMIT) fail('read_budget','Daily plan exceeds monitoring bound.');
      plan = { ...plan, entries, capturedAtMs:at, frozen:at>=dueAtMs, late:at>dueAtMs+2*C.MINUTE, expiresAt:timestamp(at+45*86400000) };
    }
    const batch = (await reader.collection('technicianDailyScheduleBatches').doc(date).get()).data();
    return { ref, plan, state:{ required, open, dueAtMs, batchPresent:!!batch, batchStatus:batch?.status || null,
      capturedAtMs:plan.capturedAtMs, coverageLate:required && plan.late === true, preflight:plan.preflight || {} } };
  }
  async function run() {
    const control = await policy();
    if (!control.enabled) return { disabled:true };
    const at = now(); const date = C.localDate(at); const coverage=[]; const reader=boundedReader(db);
    let queue=[]; let expectations=[]; let day={ state:{required:false}, plan:{entries:[]} }; let transport={available:false};
    const rows=new Map();
    const addRows = snap => { for (const doc of snap.docs) rows.set(doc.id,{ id:doc.id,...doc.data() }); };
    // A failed source keeps coverage explicitly incomplete. Independent sources still contribute.
    const source = async (code, task) => { try { return await task(); } catch { coverage.push(code); return null; } };
    await Promise.all([
      source('queue_pending',async()=>addRows(await reader.collection('whatsappOutboundQueue').where('status','in',['queued','processing','failed']).where('createdAt','>=',timestamp(control.startedAtMs)).get())),
      source('queue_today',async()=>addRows(await reader.collection('whatsappOutboundQueue').where('completedAt','>=',timestamp(C.dayStart(date))).get())),
      source('queue_schedule',async()=>addRows(await reader.collection('whatsappOutboundQueue').where('scheduleDate','==',date).get())),
      source('expectations',async()=>{ expectations=(await reader.collection(C.PATHS.expectations).where('active','==',true).get()).docs; }),
      source('daily_plan',async()=>{ day=await dailyPlan(reader,date,at,control); }),
      source('transport',async()=>{ transport=await readTransport(at); }),
    ]);
    if (day.state.coverageLate) coverage.push('daily_snapshot_late');
    const missing=[]; const resolvedExpectations=[];
    const addMissing=(target, id, extra)=>missing.push({ ...target, id, ...extra });
    if (day.state.required && at>=day.state.dueAtMs-15*C.MINUTE && at<day.state.dueAtMs) {
      for (const target of day.plan.entries || []) if(target.configurationError) {
        addMissing(target,`preflight-${C.hash(target.queueId)}`,{dueAtMs:at});
      }
    }
    for (const doc of expectations) {
      await source('expectation_reconcile',async()=>{
        const expected=doc.data();
        const order=(await reader.collection('workOrders').doc(expected.workOrderId).get()).data();
        if (!order || C.orderFingerprint(order)!==expected.fingerprint || (expected.date && expected.date<date)) { resolvedExpectations.push({ ref:doc.ref, sourceAtMs:expected.sourceAtMs }); return; }
        const matches=()=>[...rows.values()].filter(record=>record.workOrderId===expected.workOrderId && record.monitoringSourceVersionMs===expected.sourceAtMs);
        let matching=matches();
        if (!matching.length) { addRows(await reader.collection('whatsappOutboundQueue').where('monitoringSourceVersionMs','==',expected.sourceAtMs).get()); matching=matches(); }
        let absent=false;
        for (const [index,target] of expected.targets.entries()) {
          const record=matching.find(value=>value.notificationType===target.notificationType && (target.flow==='clients'
            ? String(value.monitoringRecipientKey || value.recipientId || value.recipientSourceId || '')===target.recipientId : value.vanId===target.vanId));
          if (!record) { absent=true; addMissing(target,`expected-${doc.id}-${index}`,{dueAtMs:expected.sourceAtMs,workOrderId:expected.workOrderId,appointmentId:expected.appointmentId}); }
        }
        if (!absent) resolvedExpectations.push({ref:doc.ref,sourceAtMs:expected.sourceAtMs});
      });
    }
    if (day.state.required && at>=day.state.dueAtMs) {
      for (const target of day.plan.entries || []) {
        await source('daily_reconcile',async()=>{
          let record=rows.get(target.queueId);
          if (!record) { const found=await reader.collection('whatsappOutboundQueue').doc(target.queueId).get(); if(found.exists){record={id:found.id,...found.data()};rows.set(found.id,record);} }
          if (!record) addMissing(target,`daily-${C.hash(target.queueId)}`,{dueAtMs:day.state.dueAtMs});
        });
      }
    }
    for (const record of [...rows.values()]) if (record.dependsOnQueueId && !rows.has(record.dependsOnQueueId) && C.safeId(record.dependsOnQueueId)) {
      await source('dependencies',async()=>{const found=await reader.collection('whatsappOutboundQueue').doc(record.dependsOnQueueId).get();if(found.exists)rows.set(found.id,{id:found.id,...found.data()});});
    }
    queue=[...rows.values()];
    const result=C.evaluate({at,queue,missing,transport,coverage:[...new Set(coverage)],daily:day.state,policy:control});
    if(day.ref && day.plan) {
      const minutes=Math.floor((at-C.dayStart(date))/C.MINUTE);
      const slot=minutes>=475 && minutes<480 ? '07:55' : minutes>=465 && minutes<475 ? '07:45' : null;
      if(slot) day.plan.preflight={...day.plan.preflight,[slot]:{atMs:at,status:result.transport.status==='healthy'&&!result.coverage.length&&!day.plan.entries.some(x=>x.configurationError)?'healthy':'warning'}};
      result.daily.preflight=day.plan.preflight;
    }
    resolvedExpectations.splice(300);
    const previous=(await db.collection(C.PATHS.incidents).where('open','==',true).limit(81).get()).docs;
    if(previous.length>80) fail('incident_budget','Incident reconciliation is incomplete.');
    const ids=[...new Set([...previous.map(doc=>doc.id),...result.incidents.map(item=>item.id)])];
    const refs=ids.map(id=>db.collection(C.PATHS.incidents).doc(id));
    const committed=await db.runTransaction(async tx=>{
      const [current,freshControl,...history]=await tx.getAll(snapshotRef,controlRef,...refs);
      const expectedRows=resolvedExpectations.length?await tx.getAll(...resolvedExpectations.map(x=>x.ref)):[];
      if(freshControl.data()?.enabled!==true || freshControl.data()?.startedAtMs!==control.startedAtMs || (current.data()?.evaluatedAtMs || 0)>=at)return false;
      // Another evaluator may have opened an incident after our outside query.
      // Keep its snapshot until a new complete pass can reconcile that occurrence.
      if([...(current.data()?.incidents || []),...(current.data()?.unverifiedIncidents || [])].some(item=>!ids.includes(item.id)))return false;
      const old=new Map(history.map((doc,i)=>[ids[i],doc.data() || {}]));
      const active=new Set(result.incidents.map(x=>x.id));
      result.incidents=result.incidents.map(item=>{const last=old.get(item.id);return {...item,openedAtMs:last?.open?last.openedAtMs:at,acknowledgement:last?.open?last.acknowledgement || null:null};});
      for(const item of result.incidents)tx.set(db.collection(C.PATHS.incidents).doc(item.id),{...item,open:true,lastSeenAtMs:at,resolvedAtMs:null,expiresAt:timestamp(at+45*86400000)});
      // Incomplete coverage cannot turn an unresolved incident into a recovered one.
      if(!result.coverage.length) {
        for(const id of ids)if(!active.has(id)&&old.get(id)?.open)tx.set(db.collection(C.PATHS.incidents).doc(id),{open:false,resolvedAtMs:at,lastSeenAtMs:at},{merge:true});
      } else {
        result.unverifiedIncidents=ids.filter(id=>!active.has(id)&&old.get(id)?.open).map(id=>{
          const {expiresAt,...incident}=old.get(id);return {...incident,verificationUnknown:true};
        });
      }
      // Bound the snapshot independently of per-incident history and Firestore's 1 MiB limit.
      let itemBudget=300;
      for(const incident of [...result.incidents,...(result.unverifiedIncidents || [])]) {
        incident.items=incident.items.slice(0,itemBudget);itemBudget-=incident.items.length;
        if(incident.count>incident.items.length)incident.truncated=true;
      }
      result.queue=result.queue.slice(0,100);result.queueTruncated=result.queueTruncated||queue.length>100;
      for(let i=0;i<resolvedExpectations.length;i++)if(expectedRows[i].data()?.sourceAtMs===resolvedExpectations[i].sourceAtMs)tx.set(resolvedExpectations[i].ref,{active:false,reconciledAtMs:at},{merge:true});
      if(day.ref)tx.set(day.ref,day.plan);
      tx.set(snapshotRef,{...result,readCount:reader.count(),expiresAt:timestamp(at+2*86400000)});
      return true;
    });
    if(committed)await publishSignals(result); // Failure fails the scheduled run; external missing-metric policy can detect it.
    return {committed,snapshot:result};
  }
  async function identity(request) {
    const token=/^Bearer\s+(\S{1,4000})$/i.exec(request.headers?.authorization || '')?.[1];
    if(!token)fail('unauthenticated','Inicia sesión en DEMAC ERP.');
    let decoded;try{decoded=await verifyIdToken(token,true);}catch{fail('unauthenticated','Tu sesión no pudo verificarse.');}
    if(!C.safeId(decoded?.uid))fail('unauthenticated','Sesión inválida.');
    const user=(await db.collection('users').doc(decoded.uid).get()).data();
    const normalized=role(user?.role);
    if(user?.active!==true || !READ_ROLES.has(normalized))fail('permission_denied','No tienes acceso al monitor de mensajería.');
    return {uid:decoded.uid,role:normalized,name:String(user.displayName || user.name || 'Operaciones').slice(0,80)};
  }
  async function handle(request) {
    if(request.method==='OPTIONS')return {status:204,body:null};
    if(request.method!=='POST')return {status:405,body:{error:{code:'method_not_allowed',message:'POST requerido.'}}};
    try{
      if((request.rawBody?.length ?? Buffer.byteLength(JSON.stringify(request.body || {})))>12000)fail('invalid_request','Solicitud demasiado grande.');
      const actor=await identity(request);const action=request.body?.action;const data=request.body?.data || {};
      if(action==='dashboard') {
        const [control,stored]=await Promise.all([policy(),snapshotRef.get()]);
        return {status:200,body:{success:true,version:C.VERSION,enabled:control.enabled,configured:control.configured,canConfigure:actor.role==='super_admin',serverAtMs:now(),snapshot:control.enabled&&stored.exists?stored.data():null}};
      }
      if(action==='history') {
        const rows=(await db.collection(C.PATHS.incidents).orderBy('lastSeenAtMs','desc').limit(51).get()).docs;
        return {status:200,body:{success:true,version:C.VERSION,items:rows.slice(0,50).map(doc=>{const {expiresAt,...value}=doc.data();return value;}),truncated:rows.length>50}};
      }
      if(action==='acknowledge') {
        if(!enabled)fail('disabled','El monitor no está activo.');
        if(!/^[a-f0-9]{64}$/.test(data.incidentId || '')||!Number.isFinite(data.openedAtMs))fail('invalid_request','Identidad de incidencia inválida.');
        const ref=db.collection(C.PATHS.incidents).doc(data.incidentId);
        const audit=db.collection(C.PATHS.audit).doc(C.hash(`${actor.uid}:${data.incidentId}:${data.openedAtMs}`));
        const body=await db.runTransaction(async tx=>{
          const [incident,current,control,user]=await tx.getAll(ref,snapshotRef,controlRef,db.collection('users').doc(actor.uid));
          if(user.data()?.active!==true||!READ_ROLES.has(role(user.data()?.role)))fail('permission_denied','Tu acceso cambió.');
          if(control.data()?.enabled!==true)fail('disabled','El monitor no está activo.');
          if(!incident.data()?.open||incident.data().openedAtMs!==data.openedAtMs)fail('conflict','La incidencia cambió. Actualiza el panel.');
          if(incident.data().acknowledgement)return {success:true,replayed:true};
          const acknowledgement={uid:actor.uid,name:actor.name,atMs:now()};
          tx.set(ref,{acknowledgement},{merge:true});
          if(current.exists)tx.set(snapshotRef,{incidents:(current.data().incidents || []).map(item=>item.id===data.incidentId&&item.openedAtMs===data.openedAtMs?{...item,acknowledgement}:item)},{merge:true});
          tx.set(audit,{action:'acknowledge',incidentId:data.incidentId,openedAtMs:data.openedAtMs,actorUid:actor.uid,atMs:now(),expiresAt:timestamp(now()+45*86400000)});
          return {success:true,replayed:false};
        });return {status:200,body};
      }
      fail('invalid_request','Acción no disponible.');
    }catch(error){const status={unauthenticated:401,permission_denied:403,invalid_request:400,disabled:409,conflict:409}[error.code] || 503;
      return {status,body:{error:{code:status===503?'unavailable':error.code,message:status===503?'No se pudo comprobar el monitor. Los envíos no se han modificado.':error.message}}};}
  }
  return {run,observeOrder,handle,policy};
}
module.exports={createMessagingMonitor,boundedReader,READ_ROLES};
