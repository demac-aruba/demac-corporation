// Only loopback, synthetic demo project. No production fallback or credentials.
const assert = require('node:assert/strict');
const PROJECT = 'demo-demac-attendance';
const FIRESTORE = 'http://127.0.0.1:8408';
const AUTH = 'http://127.0.0.1:9108';
const DOCUMENTS = `/v1/projects/${PROJECT}/databases/(default)/documents`;
const password = 'Synthetic-attendance-test-123!';
function guard() {
  assert.equal(process.env.GCLOUD_PROJECT, PROJECT);
  assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8408');
  assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9108');
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
}
function configure() {
  guard();
  for (const key of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','STORAGE_BUCKET','MESSAGING_SENDER_ID','APP_ID']) process.env['NEXT_PUBLIC_FIREBASE_' + key] = PROJECT;
}
function destination(url) {
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:');
  if (parsed.hostname === 'firestore.googleapis.com') {
    assert.ok(parsed.pathname.startsWith(DOCUMENTS));
    return FIRESTORE + parsed.pathname + parsed.search;
  }
  assert.ok(['identitytoolkit.googleapis.com','securetoken.googleapis.com'].includes(parsed.hostname));
  return AUTH + '/' + parsed.hostname + parsed.pathname + parsed.search;
}
async function reset() {
  guard();
  for (const url of [`${FIRESTORE}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, `${AUTH}/emulator/v1/projects/${PROJECT}/accounts`]) {
    const r = await fetch(url, { method: 'DELETE' }); assert.equal(r.ok, true);
  }
}
async function seed(storage, path, value) {
  guard();
  const r = await fetch(FIRESTORE + DOCUMENTS + '/' + path, { method:'PATCH', headers:{Authorization:'Bearer owner','Content-Type':'application/json'}, body:JSON.stringify({fields:storage.encodeFirestoreFields(value)}) });
  assert.equal(r.ok, true, 'Synthetic seed failed');
}
async function remove(path) {
  guard(); const r=await fetch(FIRESTORE + DOCUMENTS + '/' + path,{method:'DELETE',headers:{Authorization:'Bearer owner'}});assert.equal(r.ok,true);
}
async function get(storage, path) {
  guard();const r=await fetch(FIRESTORE+DOCUMENTS+'/'+path,{headers:{Authorization:'Bearer owner'}});
  if(r.status===404)return null;assert.equal(r.ok,true);return storage.decodeFirestoreFields((await r.json()).fields||{});
}
async function account(storage, name, role, active=true) {
  guard();const email=name+'@attendance.invalid';
  const r=await fetch(AUTH+'/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  assert.equal(r.ok,true);const data=await r.json();
  await seed(storage,'users/'+data.localId,{role,active});
  return {uid:data.localId,idToken:data.idToken,email,password};
}
module.exports={PROJECT,FIRESTORE,AUTH,DOCUMENTS,guard,configure,destination,reset,seed,remove,get,account};
