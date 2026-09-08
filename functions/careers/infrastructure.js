'use strict';
const C=require('./core');
const {privateScannerAddress,scan}=require('./files');
function createInfrastructure(env,createTransport) {
  const scannerAddress=privateScannerAddress(env);
  const smtpOptions=()=>({host:env.CAREERS_SMTP_HOST,port:Number(env.CAREERS_SMTP_PORT || 465),secure:Number(env.CAREERS_SMTP_PORT || 465)===465,requireTLS:true,auth:{user:env.CAREERS_SMTP_USER,pass:env.CAREERS_SMTP_PASSWORD},connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,disableFileAccess:true,disableUrlAccess:true,logger:false,debug:false,tls:{minVersion:'TLSv1.2',rejectUnauthorized:true}});
  function blockers(s={}) {
    const b=[];
    if(env.CAREERS_RELEASE_APPROVED!=='true')b.push('Production activation has not been approved in the deployment configuration.');
    if(env.CAREERS_RETENTION_APPROVED!=='true')b.push('Approve the configured retention/deletion policy before accepting documents.');
    if(!scannerAddress)b.push('Configure a private antivirus service.');
    if(!env.CAREERS_SMTP_HOST || !env.CAREERS_SMTP_USER || !env.CAREERS_SMTP_PASSWORD || ![465,587].includes(Number(env.CAREERS_SMTP_PORT || 465)))b.push('Configure the secure Careers email transport.');
    if(!s.from || !env.CAREERS_VERIFIED_FROM || s.from.toLowerCase()!==env.CAREERS_VERIFIED_FROM.toLowerCase())b.push('Use the verified Careers sender selected by DEMAC.');
    return b;
  }
  function signature(s) {return C.digest(C.stable({from:s.from||'',replyTo:s.replyTo||'',privacyVersion:s.privacyVersion||'',privacyText:s.privacyText||'',host:env.CAREERS_SMTP_HOST||'',port:env.CAREERS_SMTP_PORT||'',user:env.CAREERS_SMTP_USER||'',credentialHash:C.digest(env.CAREERS_SMTP_PASSWORD||''),scanner:scannerAddress,verifiedFrom:env.CAREERS_VERIFIED_FROM||'',approved:env.CAREERS_RELEASE_APPROVED||''}));}
  async function verify(s) {
    C.requireValue(blockers(s).length===0,blockers(s).join(' '),'setup-required',409);
    await scan(Buffer.from('DEMAC Careers scanner connectivity check.'),scannerAddress);
    const transport=createTransport(smtpOptions());try{await transport.verify();}finally{transport.close();}
  }
  async function send(application,s) {
    C.requireValue(blockers(s).length===0,'Email settings are unavailable.','setup-required',409);
    const transport=createTransport(smtpOptions());
    try{return await transport.sendMail({from:{name:s.senderName,address:s.from},replyTo:s.replyTo,to:application.profile.email,subject:`Application received — ${application.jobSnapshot.title}`,text:`Hello ${application.profile.givenName},\n\nThank you for your interest in DEMAC Professional Cooling Solutions. We received your application for ${application.jobSnapshot.title}.\n\nReference: ${application.reference}\n\nOur recruitment team will review your information and contact you if your application advances to the next stage.\n\nDEMAC Recruitment Team`,messageId:`<careers.${application.id}@${s.from.split('@')[1]}>`,disableFileAccess:true,disableUrlAccess:true});}finally{transport.close();}
  }
  return {blockers,signature,verify,send,scanner:bytes=>scan(bytes,scannerAddress)};
}
module.exports={createInfrastructure};
