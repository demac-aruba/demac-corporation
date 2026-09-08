'use strict';
const crypto = require('node:crypto');
const C = require('./core');
const COLLECTIONS = Object.freeze({ jobs:'careersVacancies', applications:'careersApplications', sessions:'careersSessions', settings:'careersSettings', operations:'careersOperations', audit:'careersAudit', mail:'careersEmailJobs', rate:'careersRateLimits', deletions:'careersFileDeletions' });
function createService({ db, files, infrastructure, now = Date.now }) {
  const ref = (kind,key) => db.collection(COLLECTIONS[kind]).doc(C.id(key));
  const configRef = ref('settings','default');
  const at = () => new Date(now()).toISOString();
  const assertAdmin = async (uid, reader = db) => {
    C.id(uid);
    const snapshot = await reader.get(db.collection('users').doc(uid));
    const actor = snapshot.data();
    C.requireValue(snapshot.exists && actor?.active === true && actor.role === 'admin', 'An active DEMAC administrator is required.', 'permission-denied',403);
    return { uid, name:actor.name || 'DEMAC administrator' };
  };
  const readAdmin = uid => assertAdmin(uid,{get:r=>r.get()});
  function sessionAccess(snapshot, token) {
    const value = snapshot.data();
    C.requireValue(snapshot.exists && value && C.verifySecret(token,value.secretHash) && value.expiresAt > now(), 'This application session has expired. Start again.', 'invalid-session',401);
    return value;
  }
  function configReady(settings) {
    const issues = infrastructure.blockers(settings || {});
    if (!settings?.privacyText || !settings.privacyVersion || !settings.retentionDays) issues.push('Approve the privacy notice and retention period.');
    if (!settings?.verification || settings.verification.signature !== infrastructure.signature(settings)) issues.push('Verify email and document security in Settings.');
    return issues;
  }
  async function adminMutation(uid, requestId, action, data, work) {
    C.id(requestId);
    const operation = ref('operations',C.digest(`${uid}|${action}|${requestId}`));
    const fingerprint = C.digest(C.stable(data));
    return db.runTransaction(async tx => {
      const actor = await assertAdmin(uid,tx);
      const prior = await tx.get(operation);
      if (prior.exists) {
        C.requireValue(prior.data().fingerprint === fingerprint,'This request identifier was already used for different data.','idempotency-conflict',409);
        return prior.data().result;
      }
      const result = await work(tx,actor);
      tx.create(operation,{fingerprint,action,result,createdAt:at(),expiresAt:now()+7*86400000});
      tx.create(ref('audit',operation.id),{action,actorUid:uid,resourceId:result.id || 'default',version:result.version || null,at:at()});
      return result;
    });
  }
  async function getSettings(uid) {
    await readAdmin(uid); const s = (await configRef.get()).data();
    return {settings:s || null,blockers:configReady(s),backend:'firestore'};
  }
  async function saveSettings(uid,p) {
    const clean=C.settings(p.settings);
    return adminMutation(uid,p.requestId,'settings.save',clean,async tx=>{
      const previous=(await tx.get(configRef)).data();
      C.requireValue((previous?.version || 0) === p.expectedVersion,'Settings changed. Reload before saving.','version-conflict',409);
      if (previous?.privacyText !== clean.privacyText && previous?.privacyVersion === clean.privacyVersion) throw C.fault('privacy-version','Change the notice version when editing privacy text.',409);
      const verification=previous?.verification?.signature === infrastructure.signature(clean) ? previous.verification : null;
      const next={...clean,verification,version:(previous?.version || 0)+1,updatedAt:at(),updatedBy:uid};
      C.requireValue(!clean.intakeEnabled || configReady(next).length===0,'Complete and verify setup before enabling applications.','setup-required',409);
      tx.set(configRef,next); return {id:'default',version:next.version};
    });
  }
  async function verifySetup(uid) {
    await readAdmin(uid);
    const current=(await configRef.get()).data();
    C.requireValue(current,'Save the Careers settings first.','setup-required',409);
    const signature=infrastructure.signature(current);
    await infrastructure.verify(current);
    return db.runTransaction(async tx=>{
      await assertAdmin(uid,tx); const latest=(await tx.get(configRef)).data();
      C.requireValue(latest && infrastructure.signature(latest)===signature && latest.version===current.version,'Settings changed during verification. Retry.','version-conflict',409);
      tx.update(configRef,{verification:{signature,at:now()},updatedAt:at()});
      tx.create(ref('audit',crypto.randomUUID()),{action:'settings.verify',actorUid:uid,resourceId:'default',at:at()});
      return {verified:true};
    });
  }
  async function saveVacancy(uid,p) {
    const key=C.id(p.id), clean=C.vacancy(p.vacancy);
    return adminMutation(uid,p.requestId,'vacancy.save',{key,clean,expectedVersion:p.expectedVersion},async tx=>{
      const document=ref('jobs',key), existing=(await tx.get(document)).data();
      C.requireValue((existing?.version || 0)===p.expectedVersion,'This vacancy changed. Reload before saving.','version-conflict',409);
      if(clean.status==='Open') {
        const config=(await tx.get(configRef)).data();
        C.requireValue(config?.intakeEnabled===true && configReady(config).length===0,'Complete Careers setup before opening a vacancy.','setup-required',409);
      }
      const version=(existing?.version || 0)+1;
      tx.set(document,{...clean,id:key,version,createdAt:existing?.createdAt || at(),createdBy:existing?.createdBy || uid,updatedAt:at(),updatedBy:uid});
      return {id:key,version};
    });
  }
  async function publicJobs() {
    const config=(await configRef.get()).data();
    if(!config?.intakeEnabled || configReady(config).length) return {jobs:[],available:false};
    const snapshot=await db.collection(COLLECTIONS.jobs).where('status','==','Open').limit(100).get();
    return {available:true,jobs:snapshot.docs.map(d=>d.data()).filter(j=>C.isOpen(j,now())).map(C.publicVacancy),privacy:{text:config.privacyText,version:config.privacyVersion}};
  }
  async function list(uid,kind,p={}) {
    await readAdmin(uid);
    C.requireValue(['jobs','applications'].includes(kind),'Invalid list.');
    const count=C.integer(p.limit ?? 25,'page size',1,50);
    let query=db.collection(COLLECTIONS[kind]).orderBy('__name__');
    if(p.cursor) query=query.startAfter(C.id(p.cursor));
    const scan=await query.limit(200).get();
    const items=[]; let cursor=null; let processed=0;
    const search=typeof p.search==='string'?p.search.trim().toLowerCase().slice(0,120):'';
    const minimum=p.minExperience == null || p.minExperience===''?null:Number(p.minExperience);
    C.requireValue(minimum===null || Number.isFinite(minimum)&&minimum>=0&&minimum<=70,'Check minimum experience.');
    for(const doc of scan.docs) {
      processed++; cursor=doc.id; const d=doc.data(); if(kind==='applications' && (d.expiresAt<=now() || d.deleting))continue;
      const matches=kind==='jobs'
        ? (!p.status || d.status===p.status) && (!search || `${d.title} ${d.department}`.toLowerCase().includes(search))
        : (!p.jobId || d.jobId===p.jobId) && (!p.stage || d.stage===p.stage) && (!p.country || d.profile.residence===p.country) && (minimum===null || Number(d.profile.relevantExperience)>=minimum) && (!search || `${d.profile.givenName} ${d.profile.familyName} ${d.jobSnapshot.title} ${Object.values(d.profile.answers).flat().join(' ')}`.toLowerCase().includes(search));
      if(matches) items.push(kind==='jobs'?d:{id:d.id,jobId:d.jobId,title:d.jobSnapshot.title,name:`${d.profile.givenName} ${d.profile.familyName}`,stage:d.stage,version:d.version,experience:d.profile.relevantExperience,country:d.profile.residence,createdAt:d.createdAt});
      if(items.length===count) break;
    }
    return {items,nextCursor:processed<scan.size || scan.size===200?cursor:null};
  }
  async function getVacancy(uid,key){await readAdmin(uid);const doc=await ref('jobs',key).get();C.requireValue(doc.exists,'Vacancy not found.','not-found',404);return doc.data();}
  async function getApplication(uid,key) {await readAdmin(uid); const snap=await ref('applications',key).get();C.requireValue(snap.exists && snap.data().expiresAt>now() && !snap.data().deleting,'Application not found.','not-found',404); const notes=await snap.ref.collection('notes').orderBy('at','desc').limit(50).get();const events=await snap.ref.collection('events').orderBy('at','desc').limit(50).get();const mail=(await ref('mail',key).get()).data();return {...snap.data(),notes:notes.docs.map(d=>({id:d.id,...d.data()})),events:events.docs.map(d=>({id:d.id,...d.data()})),emailStatus:mail?.status || 'unavailable'};}
  async function updateApplication(uid,p) {
    const key=C.id(p.id); C.requireValue(p.note != null || C.STAGES.includes(p.stage),'Select a valid stage.');
    const note=p.note == null?null:C.text(p.note,'note',2000);
    return adminMutation(uid,p.requestId,note?'application.note':'application.stage',{key,stage:p.stage || null,note,expectedVersion:p.expectedVersion},async(tx,actor)=>{
      const document=ref('applications',key), current=(await tx.get(document)).data();
      C.requireValue(current,'Application not found.','not-found',404);
      C.requireValue(current.version===p.expectedVersion,'Another reviewer updated this application. Reload.','version-conflict',409);
      const version=current.version+1;
      tx.update(document,{...(note?{}:{stage:p.stage}),version,updatedAt:at()});
      if(note) tx.create(document.collection('notes').doc(C.id(p.requestId)),{text:note,actorUid:uid,actorName:actor.name,at:at()});
      tx.create(document.collection('events').doc(C.id(p.requestId)),{action:note?'Note added':`Stage: ${p.stage}`,actorUid:uid,at:at()});
      return {id:key,version};
    });
  }
  async function rateLimit(key) {
    const minute=Math.floor(now()/60000); const r=ref('rate',C.digest(`${key}|${minute}`));
    await db.runTransaction(async tx=>{const d=(await tx.get(r)).data(); C.requireValue((d?.count || 0)<30,'Too many requests. Please wait a minute.','rate-limited',429);tx.set(r,{count:(d?.count || 0)+1,expiresAt:now()+120000});});
  }
  async function startSession(p) {
    const jobId=C.id(p.jobId); C.requireValue(!p.website,'Unable to start this application.');
    const sessionId=crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex');
    await db.runTransaction(async tx=>{
      const [config,job]=await Promise.all([tx.get(configRef),tx.get(ref('jobs',jobId))]);
      const settings=config.data(), vacancy=job.data();
      C.requireValue(settings?.intakeEnabled && configReady(settings).length===0,'Applications are temporarily unavailable.','intake-paused',409);
      C.requireValue(C.isOpen(vacancy,now()),'This position is no longer open.','vacancy-closed',409);
      C.requireValue(vacancy.version===p.version,'The vacancy has changed. Reload its information.','version-conflict',409);
      tx.create(ref('sessions',sessionId),{id:sessionId,jobId,jobVersion:vacancy.version,secretHash:C.digest(token),expiresAt:now()+86400000,createdAt:at(),files:{},status:'draft'});
    });
    return {sessionId,token,expiresAt:now()+86400000};
  }
  async function sessionStatus(p) {
    const session=sessionAccess(await ref('sessions',p.sessionId).get(),p.token);
    const mail=session.status==='submitted'?(await ref('mail',session.applicationId).get()).data():null;
    return {files:Object.values(session.files).map(files.publicFile),...(session.status==='submitted'?{receipt:{id:session.applicationId,reference:session.reference,emailStatus:mail?.status || 'unavailable'}}:{})};
  }
  async function upload(p) {
    const sessionRef=ref('sessions',p.sessionId);
    const bytes=files.decode(p.base64), kind=p.kind;
    C.requireValue(['photo','cv','document'].includes(kind),'Invalid document category.');
    const name=C.text(p.name,'file name',180); const key=C.digest(`${kind}|${C.digest(bytes)}`), lease=crypto.randomUUID();
    const reserved=await db.runTransaction(async tx=>{
      const session=sessionAccess(await tx.get(sessionRef),p.token);
      C.requireValue(session.status==='draft','This application was already submitted.','already-submitted',409);
      const existing=session.files[key];
      if(existing?.status==='clean') return existing;
      C.requireValue(!existing || existing.status!=='uploading' || existing.leaseUntil<now(),'This file is still being processed. Retry shortly.','upload-busy',409);
      const active=Object.values(session.files).filter(f=>f.id!==key && ['clean','uploading'].includes(f.status));
      C.requireValue(Object.keys(session.files).length<16 || !!existing,'Too many upload attempts. Start another application session.','file-limit',409);
      C.requireValue(active.reduce((n,f)=>n+f.size,0)+bytes.length<=C.MAX_TOTAL,'Combined files exceed 30 MB.');
      C.requireValue(kind==='document'?active.filter(f=>f.kind==='document').length<5:!active.some(f=>f.kind===kind),'Remove the previous file before replacing it.','file-slot',409);
      const file={id:key,kind,name,size:bytes.length,status:'uploading',lease,leaseUntil:now()+120000};
      tx.update(sessionRef,{[`files.${key}`]:file}); return file;
    });
    if(reserved.status==='clean') return files.publicFile(reserved);
    let stored;
    try {
      const prepared=await files.prepare(bytes,name,kind);
      stored=await files.store(p.sessionId,key,prepared,lease);
      const record={id:key,kind,name,size:bytes.length,storedSize:prepared.bytes.length,mime:prepared.mime,status:'clean',path:stored.path,generation:stored.generation,sha256:C.digest(prepared.bytes),scannedAt:at(),lease};
      await db.runTransaction(async tx=>{
        const session=sessionAccess(await tx.get(sessionRef),p.token);
        C.requireValue(session.status==='draft' && session.files[key]?.lease===lease,'Upload session changed.','upload-conflict',409);
        tx.update(sessionRef,{[`files.${key}`]:record});
      });
      return files.publicFile(record);
    } catch(error) {
      if(stored) await ref('deletions',C.digest(stored.path)).set({...stored,createdAt:at()});
      await db.runTransaction(async tx=>{const s=(await tx.get(sessionRef)).data();if(s?.status==='draft' && s.files[key]?.lease===lease)tx.update(sessionRef,{[`files.${key}`]:{id:key,kind,name,size:bytes.length,status:'rejected'}});}).catch(()=>{});
      throw error;
    }
  }
  async function removeUpload(p) {
    const sref=ref('sessions',p.sessionId), key=C.id(p.fileId);
    const record=await db.runTransaction(async tx=>{
      const session=sessionAccess(await tx.get(sref),p.token); C.requireValue(session.status==='draft','Application was submitted.','already-submitted',409);
      const file=session.files[key]; C.requireValue(file && file.status!=='uploading','File cannot be removed during upload.','upload-busy',409);
      const remaining={...session.files}; delete remaining[key]; tx.update(sref,{files:remaining}); if(file.path)tx.set(ref('deletions',C.digest(file.path)),{path:file.path,generation:file.generation,createdAt:at()}); return file;
    });
    if(record.path) {try{await files.remove(record);await ref('deletions',C.digest(record.path)).delete();}catch{ }} return {removed:true};
  }
  async function submit(p) {
    const sref=ref('sessions',p.sessionId); const fingerprint=C.digest(C.stable(p.profile));
    return db.runTransaction(async tx=>{
      const session=sessionAccess(await tx.get(sref),p.token);
      if(session.status==='submitted') { C.requireValue(session.fingerprint===fingerprint,'This session has already been submitted.','already-submitted',409);const mail=(await tx.get(ref('mail',session.applicationId))).data();return {id:session.applicationId,reference:session.reference,emailStatus:mail?.status || 'unavailable'}; }
      const [jobSnap,configSnap]=await Promise.all([tx.get(ref('jobs',session.jobId)),tx.get(configRef)]);
      const job=jobSnap.data(),config=configSnap.data();
      C.requireValue(config?.intakeEnabled && configReady(config).length===0,'Applications are temporarily paused.','intake-paused',409);
      C.requireValue(C.isOpen(job,now()),'This vacancy is no longer open.','vacancy-closed',409);
      C.requireValue(job.version===session.jobVersion,'The vacancy was updated. Review the current version before applying.','version-conflict',409);
      const profile=C.profile(p.profile,job,config), docs=Object.values(session.files);
      C.requireValue(!docs.some(d=>d.status==='uploading'),'Wait for document processing to finish.','upload-busy',409);
      const clean=docs.filter(d=>d.status==='clean');
      C.requireValue(clean.filter(d=>d.kind==='photo').length===1,'A recent profile photo is required.');
      C.requireValue(clean.some(d=>d.kind==='cv') || (!job.cvRequired && profile.noCv),'Your CV is required.');
      const id=session.id, reference=`DEMAC-${new Date(now()).getUTCFullYear()}-${id.slice(0,8).toUpperCase()}`;
      const expiresAt=now()+(profile.futureTalent?config.talentRetentionDays:config.retentionDays)*86400000;
      tx.create(ref('applications',id),{id,reference,jobId:job.id,jobSnapshot:C.publicVacancy(job),profile,documents:clean,stage:'New',version:1,createdAt:at(),updatedAt:at(),expiresAt});
      tx.create(ref('mail',id),{id,applicationId:id,status:'queued',attempts:0,notBefore:now(),createdAt:at(),expiresAt});
      tx.create(ref('applications',id).collection('events').doc('submitted'),{action:'Application received',at:at(),actorUid:null});
      tx.update(sref,{status:'submitted',applicationId:id,reference,fingerprint});
      return {id,reference,emailStatus:'queued'};
    });
  }
  async function document(uid,applicationId,fileId) {
    const a=await getApplication(uid,applicationId); const file=a.documents.find(f=>f.id===C.id(fileId));
    C.requireValue(file?.status==='clean' && a.expiresAt>now(),'This document is unavailable.','not-found',404);
    return files.read(file);
  }
  return {getSettings,saveSettings,verifySetup,saveVacancy,getVacancy,publicJobs,list,getApplication,updateApplication,rateLimit,startSession,sessionStatus,upload,removeUpload,submit,document,readAdmin,configReady};
}
module.exports={COLLECTIONS,createService};
