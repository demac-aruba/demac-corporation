'use strict';
const crypto = require('node:crypto');
const STAGES = ['New','In review','Shortlisted','Interview','Technical test','Offer','Hired','Not selected','Withdrawn'];
const KINDS = ['select','multiselect','yesno','text','textarea','number','date','url'];
const MAX_FILE = 10 * 1024 * 1024;
const MAX_TOTAL = 30 * 1024 * 1024;
function fault(code, message, status = 400) { return Object.assign(new Error(message), { code, status }); }
function requireValue(ok, message, code = 'invalid-input', status = 400) { if (!ok) throw fault(code, message, status); }
function text(value, name, max = 200, optional = false) {
  requireValue(typeof value === 'string', `${name} must be text.`);
  const result = value.trim();
  requireValue((optional || result.length > 0) && result.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result), `Check ${name}.`);
  return result;
}
function id(value) { const result = text(value, 'identifier', 100); requireValue(/^[a-zA-Z0-9_-]{1,100}$/.test(result) && !['__proto__','constructor','prototype'].includes(result), 'Invalid identifier.'); return result; }
function integer(value, name, min, max) { requireValue(Number.isSafeInteger(value) && value >= min && value <= max, `Check ${name}.`); return value; }
function boolean(value, name) { requireValue(typeof value === 'boolean', `Check ${name}.`); return value; }
function list(value, name, max = 30, length = 300) {
  requireValue(Array.isArray(value) && value.length <= max, `Check ${name}.`);
  return value.map(v => text(v, name, length));
}
function email(value) { const result = text(value, 'email', 254).toLowerCase(); requireValue(/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(result), 'Check email address.'); return result; }
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function date(value) {
  if (value === '' || value == null) return null;
  const d = typeof value === 'string' && /^\d{4}-\d\d-\d\d$/.test(value) ? new Date(`${value}T00:00:00Z`) : null;
  requireValue(d && Number.isFinite(d.getTime()) && d.toISOString().slice(0,10) === value, 'Check the date.');
  return value;
}
function vacancy(input) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Vacancy is required.');
  requireValue(['Draft','Open','Paused','Closed','Archived'].includes(input.status), 'Check publication status.');
  const questions = input.questions;
  requireValue(Array.isArray(questions) && questions.length <= 30, 'Use up to 30 role questions.');
  const earlier = new Map();
  const normalized = questions.map(q => {
    requireValue(q && typeof q === 'object' && !Array.isArray(q), 'Invalid question.');
    const key = id(q.id);
    requireValue(!earlier.has(key) && KINDS.includes(q.kind), 'Question identifiers and types must be valid.');
    const clean = { id:key, label:text(q.label,'question',240), kind:q.kind, required:boolean(q.required,'required') };
    if (['select','multiselect'].includes(q.kind)) {
      clean.options = list(Array.isArray(q.options)?q.options.filter(v=>typeof v!=='string'||v.trim()):q.options,'options',40,120);
      requireValue(clean.options.length >= 1 && new Set(clean.options).size === clean.options.length, 'Options must be non-empty and unique.');
    }
    if (q.when) {
      requireValue(earlier.get(q.when.questionId)?.kind === 'yesno' && ['Yes','No'].includes(q.when.value), 'Conditional questions must reference an earlier Yes / No answer.');
      clean.when = { questionId:q.when.questionId, value:q.when.value };
    }
    earlier.set(key,clean); return clean;
  });
  const clean = {
    title:text(input.title,'title',100), department:text(input.department,'department',80),
    location:text(input.location,'location',100), contract:text(input.contract,'contract',80),
    summary:text(input.summary,'summary',1500), responsibilities:list(Array.isArray(input.responsibilities)?input.responsibilities.filter(v=>typeof v!=='string'||v.trim()):input.responsibilities,'responsibilities'),
    requirements:list(Array.isArray(input.requirements)?input.requirements.filter(v=>typeof v!=='string'||v.trim()):input.requirements,'requirements'), desired:list(Array.isArray(input.desired)?input.desired.filter(v=>typeof v!=='string'||v.trim()):[],'desired requirements'),
    internalNotes:text(input.internalNotes || '','internal notes',3000,true),
    openings:integer(input.openings ?? 1,'openings',1,100),
    publishFrom:date(input.publishFrom), publishUntil:date(input.publishUntil),
    cvRequired:boolean(input.cvRequired,'CV requirement'), photoRequired:true,
    status:input.status, questions:normalized,
  };
  requireValue(!clean.publishFrom || !clean.publishUntil || clean.publishFrom <= clean.publishUntil, 'The closing date must follow the publication date.');
  if (clean.status === 'Open') requireValue(clean.responsibilities.length && clean.requirements.length, 'Add responsibilities and requirements before opening this vacancy.');
  return clean;
}
function isOpen(job, now = Date.now()) {
  const day = new Date(now - 4*3600000).toISOString().slice(0,10);
  return !!job && job.status === 'Open' && (!job.publishFrom || job.publishFrom <= day) && (!job.publishUntil || job.publishUntil >= day);
}
function publicVacancy(job) {
  const { internalNotes, createdBy, updatedBy, ...rest } = job;
  const allowed = ['id','title','department','location','contract','summary','responsibilities','requirements','desired','openings','publishFrom','publishUntil','cvRequired','photoRequired','status','questions','version'];
  return Object.fromEntries(allowed.filter(k => rest[k] !== undefined).map(k => [k,rest[k]]));
}
function profile(input, job, settings) {
  requireValue(input && typeof input === 'object' && !Array.isArray(input), 'Application details are required.');
  const clean = {};
  for (const k of ['givenName','familyName','city']) clean[k] = text(input[k],k,120);
  clean.email = email(input.email);
  const dial = text(input.dialCode,'country code',5);
  const number = text(input.phone,'phone',30);
  requireValue(/^\+[1-9]\d{0,3}$/.test(dial) && /^[0-9\s().-]+$/.test(number), 'Check phone and country code.');
  clean.dialCode=dial; clean.phone=number.replace(/\D/g,'');
  requireValue(/^\+[1-9]\d{6,14}$/.test(dial+clean.phone),'Check international telephone number.');
  clean.whatsapp=boolean(input.whatsapp,'WhatsApp');
  clean.sameResidence=boolean(input.sameResidence,'residence');
  for (const k of ['nationality','applyingFrom','residence']) {
    const value = k === 'residence' && clean.sameResidence ? input.applyingFrom : input[k];
    requireValue(typeof value === 'string' && /^[A-Z]{2}$/.test(value), `Select ${k}.`); clean[k]=value;
  }
  for (const k of ['totalExperience','relevantExperience']) {
    const raw = input[k]; requireValue((typeof raw === 'number' || typeof raw === 'string') && String(raw).trim() !== '', `Check ${k}.`);
    const n=Number(raw); requireValue(Number.isFinite(n) && n>=0 && n<=70, `Check ${k}.`); clean[k]=String(n);
  }
  requireValue(Number(clean.relevantExperience)<=Number(clean.totalExperience),'Relevant experience cannot exceed total experience.');
  clean.languages=list(input.languages,'languages',12,60); requireValue(clean.languages.length>0,'Select a language.');
  clean.availability=text(input.availability,'availability',120);
  requireValue(input.privacy === true && input.privacyVersion === settings.privacyVersion,'Read and acknowledge the current privacy notice.','privacy-version',409);
  clean.privacyVersion=settings.privacyVersion; clean.futureTalent=boolean(input.futureTalent,'future vacancies');
  clean.noCv=input.noCv === true;
  const supplied = input.answers;
  requireValue(supplied && typeof supplied === 'object' && !Array.isArray(supplied),'Check role answers.');
  clean.answers={};
  for (const q of job.questions) {
    if (q.when && clean.answers[q.when.questionId] !== q.when.value) continue;
    const raw = Object.hasOwn(supplied,q.id) ? supplied[q.id] : undefined;
    const missing = raw == null || raw === '' || (Array.isArray(raw) && raw.length===0);
    if (missing) { requireValue(!q.required, `Answer: ${q.label}`); continue; }
    let answer;
    if (q.kind==='multiselect') { answer=list(raw,q.label,40,120); requireValue(new Set(answer).size===answer.length && answer.every(v=>q.options.includes(v)),`Select valid options: ${q.label}`); }
    else { requireValue(typeof raw === 'string' || (q.kind==='number' && typeof raw==='number'), `Check answer: ${q.label}`); answer=text(String(raw),q.label,q.kind==='textarea'?1200:240); }
    if (q.kind==='select') requireValue(q.options.includes(answer),`Select a valid option: ${q.label}`);
    if (q.kind==='yesno') requireValue(['Yes','No'].includes(answer),`Select Yes or No: ${q.label}`);
    if (q.kind==='number') requireValue(Number.isFinite(Number(answer)) && Number(answer)>=0,`Enter a valid number: ${q.label}`);
    if (q.kind==='date') date(answer);
    if (q.kind==='url') { let u; try {u=new URL(answer);}catch{} requireValue(u && ['https:','http:'].includes(u.protocol),`Enter a valid web address: ${q.label}`); }
    clean.answers[q.id]=answer;
  }
  return clean;
}
function settings(input) {
  const clean={intakeEnabled:boolean(input.intakeEnabled,'intake'),privacyText:text(input.privacyText,'privacy notice',12000),privacyVersion:id(input.privacyVersion),retentionDays:integer(input.retentionDays,'retention days',1,730),talentRetentionDays:integer(input.talentRetentionDays ?? input.retentionDays,'talent retention days',1,730),from:email(input.from),replyTo:email(input.replyTo),senderName:text(input.senderName || 'DEMAC Recruitment','sender name',120)};
  requireValue(!/[\r\n]/.test(clean.senderName),'Invalid sender name.');
  return clean;
}
function verifySecret(raw, expected) { if(typeof raw!=='string' || !/^[a-f0-9]{64}$/.test(raw) || typeof expected!=='string' || !/^[a-f0-9]{64}$/.test(expected)) return false; return crypto.timingSafeEqual(Buffer.from(digest(raw),'hex'), Buffer.from(expected,'hex')); }
module.exports={STAGES,KINDS,MAX_FILE,MAX_TOTAL,fault,requireValue,text,id,integer,boolean,list,email,digest,stable,date,vacancy,isOpen,publicVacancy,profile,settings,verifySecret};
