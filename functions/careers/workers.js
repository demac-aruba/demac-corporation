'use strict';
const crypto=require('node:crypto');
const {COLLECTIONS}=require('./service');
function createWorkers({db,files,infrastructure,now=Date.now}){
  async function sendOne(document){
    const owner=crypto.randomUUID();
    const task=await db.runTransaction(async tx=>{
      const snap=await tx.get(document),m=snap.data();if(!m)return null;
      if(m.status==='sending' && m.leaseUntil<=now()){tx.update(document,{status:'delivery_unknown',updatedAt:now()});return null;}
      if(m.status!=='queued' || m.notBefore>now())return null;
      const [a,s]=await Promise.all([tx.get(db.collection(COLLECTIONS.applications).doc(m.applicationId)),tx.get(db.collection(COLLECTIONS.settings).doc('default'))]);
      const application=a.data(),settings=s.data();
      if(!application || application.expiresAt<=now() || application.deleting){tx.update(document,{status:'cancelled'});return null;}
      if(infrastructure.blockers(settings).length || settings?.verification?.signature!==infrastructure.signature(settings))return null;
      tx.update(document,{status:'sending',owner,leaseUntil:now()+90000,attempts:m.attempts+1});
      return {application,settings,attempts:m.attempts+1};
    });
    if(!task)return;
    let status='delivery_unknown';
    try{
      const response=await infrastructure.send(task.application,task.settings);
      status=response.accepted?.some(v=>String(v).toLowerCase()===task.application.profile.email.toLowerCase())?'smtp_accepted':'rejected';
    }catch(error){
      const beforeSend=error.code==='EDNS' || error.code==='ECONNECTION' || error.code==='ESOCKET' && error.command==='CONN';
      status=beforeSend && task.attempts<4?'queued':beforeSend?'failed':'delivery_unknown';
    }
    await db.runTransaction(async tx=>{
      const m=(await tx.get(document)).data(); if(m?.owner!==owner || m.status!=='sending')return;
      tx.update(document,{status,owner:null,leaseUntil:null,updatedAt:now(),notBefore:now()+Math.min(3600000,60000*2**task.attempts)});
    });
  }
  async function emailTick(){
    for(const status of ['queued','sending']){
      const batch=await db.collection(COLLECTIONS.mail).where('status','==',status).limit(20).get();
      for(const doc of batch.docs)await sendOne(doc.ref);
    }
  }
  async function cleanup(){
    const deletionJobs=await db.collection(COLLECTIONS.deletions).limit(30).get();
    for(const job of deletionJobs.docs){if((job.data().notBefore || 0)>now())continue;await files.remove(job.data());await job.ref.delete();}
    const sessions=await db.collection(COLLECTIONS.sessions).where('expiresAt','<=',now()).limit(20).get();
    for(const doc of sessions.docs){
      const session=doc.data();
      if(session.status!=='submitted')for(const f of Object.values(session.files))if(f.path)await files.remove(f);
      await doc.ref.delete();
    }
    const expired=await db.collection(COLLECTIONS.applications).where('expiresAt','<=',now()).limit(10).get();
    for(const doc of expired.docs){
      const a=doc.data();await doc.ref.update({deleting:true});
      for(const f of a.documents)await files.remove(f);
      await db.recursiveDelete(doc.ref);await db.collection(COLLECTIONS.mail).doc(doc.id).delete();
    }
    for(const name of [COLLECTIONS.operations,COLLECTIONS.rate]){
      const expired=await db.collection(name).where('expiresAt','<=',now()).limit(100).get();
      if(expired.size){const batch=db.batch();expired.docs.forEach(d=>batch.delete(d.ref));await batch.commit();}
    }
  }
  return {sendOne,emailTick,cleanup};
}
module.exports={createWorkers};
