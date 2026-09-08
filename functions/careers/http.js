'use strict';
const C=require('./core');
function createHandler({service: serviceSource,auth,env,admin=false}) {
  const getService = () => typeof serviceSource === 'function' ? serviceSource() : serviceSource;
  const origins=(env.CAREERS_ALLOWED_ORIGINS || '').split(',').map(v=>v.trim()).filter(Boolean);
  return async(req,res)=>{
    res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');res.set('Referrer-Policy','no-referrer');
    const origin=req.get('origin');
    if(origin && !origins.includes(origin))return res.status(403).json({ok:false,code:'origin-denied',message:'This website is not approved for Careers.'});
    if(origin){res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');}
    res.set('Access-Control-Allow-Headers','Authorization, Content-Type');res.set('Access-Control-Allow-Methods','POST, OPTIONS');
    if(req.method==='OPTIONS')return res.status(204).send('');
    if(req.method!=='POST')return res.status(405).json({ok:false,code:'method',message:'Use POST.'});
    if(env.DEMAC_CAREERS_BACKEND_ENABLED!=='true')return res.status(503).json({ok:false,code:'not-configured',message:'The Careers backend is not enabled for this deployment.'});
    try{
      C.requireValue(req.is('application/json'),'Use JSON content.');
      C.requireValue((req.rawBody?.length || Buffer.byteLength(JSON.stringify(req.body || {}))) <= 15*1024*1024,'Request too large.','too-large',413);
      const {action,payload:p={}}=req.body || {};
      C.requireValue(p && typeof p==='object' && !Array.isArray(p),'Invalid request.');
      let result;
      if(admin){
        const match=/^Bearer (\S+)$/i.exec(req.get('authorization') || '');
        C.requireValue(match,'Sign in to DEMAC ERP.','unauthenticated',401);
        let decoded;try{decoded=await auth.verifyIdToken(match[1],true);}catch{throw C.fault('unauthenticated','Your session expired. Sign in again.',401);}
        const uid=decoded.uid;
        const service = getService();
        if(action==='settings.get')result=await service.getSettings(uid);
        else if(action==='settings.save')result=await service.saveSettings(uid,p);
        else if(action==='settings.verify')result=await service.verifySetup(uid);
        else if(action==='vacancies.list')result=await service.list(uid,'jobs',p);
        else if(action==='vacancies.get')result=await service.getVacancy(uid,C.id(p.id));
        else if(action==='vacancies.save')result=await service.saveVacancy(uid,p);
        else if(action==='applications.list')result=await service.list(uid,'applications',p);
        else if(action==='applications.get')result=await service.getApplication(uid,C.id(p.id));
        else if(action==='applications.update')result=await service.updateApplication(uid,p);
        else if(action==='documents.get'){
          const doc=await service.document(uid,C.id(p.applicationId),C.id(p.fileId));
          res.set('Content-Security-Policy',"sandbox; default-src 'none'");res.set('Content-Type',doc.mime);
          res.set('Content-Disposition',`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.name).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`);
          return res.status(200).send(doc.bytes);
        }else throw C.fault('unknown-action','Unknown administration action.');
      }else{
        C.requireValue(env.CAREERS_RATE_SALT && env.CAREERS_RATE_SALT.length>=32,'Careers protection is not configured.','not-configured',503);
        const service = getService();
        await service.rateLimit(C.digest(`${env.CAREERS_RATE_SALT}|${req.ip || req.socket?.remoteAddress || 'unknown'}`));
        if(action==='vacancies.list')result=await service.publicJobs();
        else if(action==='session.start')result=await service.startSession(p);
        else if(action==='session.status')result=await service.sessionStatus(p);
        else if(action==='file.upload')result=await service.upload(p);
        else if(action==='file.remove')result=await service.removeUpload(p);
        else if(action==='application.submit')result=await service.submit(p);
        else throw C.fault('unknown-action','Unknown application action.');
      }
      return res.status(200).json({ok:true,result});
    }catch(error){
      const status=Number.isInteger(error.status)?error.status:500;
      return res.status(status).json({ok:false,code:status<500?error.code:'service-unavailable',message:status<500?error.message:'The request could not be completed. Your data has not been reported as saved. Please retry.'});
    }
  };
}
module.exports={createHandler};
