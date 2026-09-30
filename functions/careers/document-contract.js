'use strict';
/** Category metadata extends existing private `document` objects, never their storage authority. */
const CATEGORIES = Object.freeze(['document','diploma','certificate','id']);
const LABELS = Object.freeze({
  document:{en:'Additional documents',es:'Documentos adicionales'},
  diploma:{en:'Diplomas',es:'Diplomas'}, certificate:{en:'Certificates',es:'Certificados'},
  id:{en:'Government ID',es:'Identificación oficial'},
});
const HELP = Object.freeze({
  document:{en:'Other relevant supporting documents.',es:'Otros documentos de apoyo pertinentes.'},
  diploma:{en:'Diplomas for relevant technical or professional education.',es:'Diplomas de formación técnica o profesional pertinente.'},
  certificate:{en:'Relevant training, manufacturer or safety certificates.',es:'Certificados pertinentes de capacitación, fabricantes o seguridad.'},
  id:{en:'Identity documents are accepted only under the approved recruitment policy.',es:'Las identificaciones solo se reciben conforme a la política de reclutamiento aprobada.'},
});
const fail = message => { throw Object.assign(new Error(message),{code:'document-policy',status:409}); };
function bounded(value) {
  if (value === undefined) return '';
  if(typeof value!=='string'||value.length>600||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail('Check the document help text.');
  return value.trim();
}
function parseDocumentRequirements(raw) {
  if(!Array.isArray(raw)||raw.length>4)fail('Configure up to four supporting document categories.');
  const seen=new Set();
  return raw.map(item=>{
    if(!item||!CATEGORIES.includes(item.category)||seen.has(item.category)||typeof item.required!=='boolean')fail('Use unique supported document categories.');
    seen.add(item.category);
    const helpEn=bounded(item.helpEn),helpEs=bounded(item.helpEs),reviewedSource=bounded(item.reviewedSource);
    if(item.category==='id'&&!helpEn)fail('Explain the approved purpose for requesting identification.');
    return {category:item.category,required:item.required,helpEn,helpEs,reviewedSource};
  });
}
function requirementsFor(job) {
  return job.documentRequirements === undefined ? [{category:'document',required:false,helpEn:'',helpEs:'',reviewedSource:''}] : parseDocumentRequirements(job.documentRequirements);
}
function categoryLabel(category,locale='en'){return LABELS[category]?.[locale==='es'?'es':'en']||LABELS.document[locale==='es'?'es':'en'];}
function requirementPresentation(item,locale='en') {
  const translated=locale==='es'&&!!item.helpEs&&item.reviewedSource===item.helpEn;
  return {label:categoryLabel(item.category,locale),help:item.helpEn?(translated?item.helpEs:item.helpEn):HELP[item.category][locale==='es'?'es':'en'],contentLocale:item.helpEn?(translated?'es':'en'):locale,translationPending:locale==='es'&&!!item.helpEn&&!translated};
}
function documentTranslationIssues(job) {
  let requirements;
  try { requirements=requirementsFor(job); } catch(error) { return [error.message]; }
  return requirements.filter(item=>item.helpEn&&(!item.helpEs||item.reviewedSource!==item.helpEn)).map(item=>`Review Spanish document help: ${categoryLabel(item.category)}.`);
}
function categoryFor(kind,raw) {
  if(kind!=='document'){if(raw!==undefined)fail('Only supporting documents can have a supporting category.');return undefined;}
  const category=raw===undefined?'document':raw;
  if(!CATEGORIES.includes(category))fail('Invalid supporting document category.');
  return category;
}
function uploadIdentityMaterial(kind,hash,category) {
  return kind==='document'&&category&&category!=='document'?`${kind}:${category}|${hash}`:`${kind}|${hash}`;
}
function validateCategory(job,category,idAllowed=false) {
  if(!requirementsFor(job).some(item=>item.category===category))fail('This document category is not requested for this vacancy.');
  if(category==='id'&&!idAllowed)fail('Identification uploads are unavailable until DEMAC approves the identification policy.');
}
function missingDocumentCategories(job,documents) {
  return requirementsFor(job).filter(item=>item.required&&!documents.some(file=>file.kind==='document'&&(file.category||'document')===item.category)).map(item=>item.category);
}
function validateDocuments(job,documents,idAllowed=false) {
  for(const doc of documents)if(doc.kind==='document')validateCategory(job,doc.category||'document',idAllowed);
  if(missingDocumentCategories(job,documents).length)fail('Complete the required document categories.');
}
module.exports={CATEGORIES,categoryLabel,parseDocumentRequirements,requirementsFor,requirementPresentation,documentTranslationIssues,categoryFor,uploadIdentityMaterial,validateCategory,missingDocumentCategories,validateDocuments};
