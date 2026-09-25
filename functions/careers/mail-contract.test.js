'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {candidateMessage,CANDIDATE_TEMPLATE_VERSION}=require('./mail-contract');
const {createWorkers}=require('./workers');
const {transactionStore}=require('./test-support/transaction-store');
const {COLLECTIONS}=require('./service');
const fixture=(locale='en')=>({id:'test-application',reference:'DEMAC-TEST-001',profile:{givenName:'  María <script>  ',email:'qa@example.test'},jobSnapshot:{title:'HVAC Technician'},submissionSnapshot:{localeAtSubmit:locale,title:locale==='es'?'Técnico HVAC':'HVAC Technician'},expiresAt:9999999});
for(const locale of ['en','es'])test(`candidate ${locale} template has frozen locale, text and escaped HTML`,()=>{
 const m=candidateMessage(fixture(locale));assert.equal(m.locale,locale);assert.equal(m.templateVersion,CANDIDATE_TEMPLATE_VERSION);
 assert(m.subject.startsWith(locale==='es'?'Recibimos tu solicitud':'Application received'));
 assert(m.html.includes(`lang="${locale}"`));assert(m.text.includes('  María <script>  '));assert(!m.html.includes('<script>'));assert(m.html.includes('&lt;script&gt;'));assert(!m.html.includes('<img'));assert(!('bcc' in m));assert(!('attachments' in m));
});
test('legacy language is not guessed from a Spanish name and header controls are not emitted',()=>{
 const a=fixture();delete a.submissionSnapshot;a.jobSnapshot.title='HVAC\r\nBcc: fake@example.test';
 const m=candidateMessage(a);assert.equal(m.locale,'en');assert(!/[\r\n]/.test(m.subject));
});
function setup(send){
 const store=transactionStore(),a=fixture('es');let clock=1000;
 store.rows.set(`${COLLECTIONS.applications}/${a.id}`,a);
 store.rows.set(`${COLLECTIONS.settings}/default`,{verification:{signature:'ok'}});
 const job={id:a.id,applicationId:a.id,status:'queued',attempts:0,notBefore:0,message:candidateMessage(a)};
 store.rows.set(`${COLLECTIONS.mail}/${a.id}`,job);
 const document=store.db.collection(COLLECTIONS.mail).doc(a.id);
 const worker=createWorkers({db:store.db,files:{},infrastructure:{blockers:()=>[],signature:()=> 'ok',send},now:()=>clock});
 return {store,a,job,document,worker,read:()=>store.rows.get(document.path),advance:()=>{clock+=200000;}};
}
test('candidate message frozen at submission survives later snapshot changes and pre-send retry',async()=>{
 const seen=[];let first=true;const x=setup(async(a,s,m)=>{seen.push(m);if(first){first=false;throw Object.assign(Error(),{code:'ECONNECTION'});}return {accepted:[m.to]};});
 const changed=x.store.rows.get(`${COLLECTIONS.applications}/${x.a.id}`);changed.submissionSnapshot={localeAtSubmit:'en',title:'Changed'};
 await x.worker.sendOne(x.document);assert.equal(x.read().status,'queued');x.advance();await x.worker.sendOne(x.document);
 assert.equal(x.read().status,'smtp_accepted');assert.deepEqual(seen[0],seen[1]);assert.equal(seen[1].locale,'es');assert(seen[1].subject.endsWith('Técnico HVAC'));
 await x.worker.sendOne(x.document);assert.equal(seen.length,2);
});
for(const code of ['ETIMEDOUT','UNKNOWN'])test(`ambiguous ${code} does not retry or delete the application`,async()=>{
 let calls=0;const x=setup(async()=>{calls++;throw Object.assign(Error(),{code});});await x.worker.sendOne(x.document);x.advance();await x.worker.sendOne(x.document);
 assert.equal(calls,1);assert.equal(x.read().status,'delivery_unknown');assert(x.store.rows.has(`${COLLECTIONS.applications}/${x.a.id}`));
});
test('an expired sending lease becomes delivery_unknown without another transport call',async()=>{
 let called=false;const x=setup(async()=>{called=true;});x.store.rows.set(x.document.path,{...x.job,status:'sending',leaseUntil:1});
 await x.worker.sendOne(x.document);assert(!called);assert.equal(x.read().status,'delivery_unknown');
});
test('known rejection and absent SMTP evidence have distinct states',async()=>{
 const x=setup(async()=>({rejected:['qa@example.test']}));await x.worker.sendOne(x.document);assert.equal(x.read().status,'rejected');
 const y=setup(async()=>({}));await y.worker.sendOne(y.document);assert.equal(y.read().status,'delivery_unknown');
});
test('legacy queued message is frozen before the transport starts',async()=>{
 const x=setup(async(a,s,m)=>{assert.deepEqual(x.read().message,m);return {accepted:[m.to]};});const j=x.read();delete j.message;await x.worker.sendOne(x.document);assert.equal(x.read().message.locale,'es');
});
test('secure SMTP transport uses only frozen content and closes without attachments or BCC',async()=>{
 const {createInfrastructure}=require('./infrastructure');let sent,closed=false;
 const env={CAREERS_RELEASE_APPROVED:'true',CAREERS_RETENTION_APPROVED:'true',CAREERS_CLAMD_HOST:'10.0.0.2',CAREERS_SMTP_HOST:'smtp.example.test',CAREERS_SMTP_USER:'test',CAREERS_SMTP_PASSWORD:'test-not-a-credential',CAREERS_VERIFIED_FROM:'qa@example.test'};
 const infra=createInfrastructure(env,options=>{assert(options.requireTLS);assert(options.disableFileAccess);assert(options.disableUrlAccess);return {sendMail:async m=>{sent=m;return {accepted:[m.to]};},close:()=>{closed=true;}};});
 const a=fixture('es'),message=candidateMessage(a);
 await infra.send(a,{from:'qa@example.test',replyTo:'reply@example.test',senderName:'QA'},message);
 assert.equal(sent.html,message.html);assert.equal(sent.text,message.text);assert(!('attachments'in sent));assert(!('bcc'in sent));assert.equal(sent.to,a.profile.email);assert(closed);
 await assert.rejects(infra.send(a,{from:'qa@example.test'},{...message,to:'wrong@example.test'}),{code:'mail-content-invalid'});
});
