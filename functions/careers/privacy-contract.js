'use strict';
/** Approved policy content is owned by the existing Careers settings record. */
const fail=message=>{throw Object.assign(new Error(message),{code:'privacy-version',status:409});};
function parsePrivacyFields(input) {
 const result={};
 if(Object.hasOwn(input,'privacyLocale')){
   if(![null,'en','es'].includes(input.privacyLocale))fail('Select the original privacy notice language.');
   result.privacyLocale=input.privacyLocale;
 }
 if(Object.hasOwn(input,'privacyTranslation')){
   const t=input.privacyTranslation;
   if(t===null){result.privacyTranslation=null;return result;}
   if(!t||typeof t!=='object'||Array.isArray(t)||!['Draft','Approved'].includes(t.status)||typeof t.text!=='string'||t.text.length>12000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t.text)||typeof t.sourceVersion!=='string'||t.sourceVersion.length>100)fail('Check the Spanish privacy notice and its review version.');
   if(t.status==='Approved'&&!t.text.trim())fail('Complete the Spanish privacy notice before approving it.');
   result.privacyTranslation={text:t.text.trim(),status:t.status,sourceVersion:t.sourceVersion};
 }
 return result;
}
function policyIdentity(settings) {
 const t=settings?.privacyTranslation;
 return JSON.stringify([settings?.privacyText||'',settings?.privacyLocale||null,t?{text:t.text,status:t.status,sourceVersion:t.sourceVersion}:null]);
}
function publicPrivacy(settings) {
 const t=settings.privacyTranslation;
 const approved=settings.privacyLocale==='en'&&t?.status==='Approved'&&t.sourceVersion===settings.privacyVersion&&!!t.text;
 return {text:settings.privacyText,version:settings.privacyVersion,locale:settings.privacyLocale||null,
   ...(approved?{spanishText:t.text}:{})};
}
function selectPrivacy(privacy,locale) {
 const spanish=locale==='es'&&!!privacy.spanishText;
 const contentLocale=spanish?'es':privacy.locale||null;
 return {text:spanish?privacy.spanishText:privacy.text,version:privacy.version,contentLocale,
   translationPending:locale==='es'&&contentLocale!=='es'};
}
module.exports={parsePrivacyFields,policyIdentity,publicPrivacy,selectPrivacy};
