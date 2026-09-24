// Real session module with controlled transport/storage. No cloud credentials or API calls.
const assert = require('node:assert/strict');
module.exports = async function runSessionChecks(session, transport) {
  let passed = 0;
  const originalFetch = global.fetch, originalWindow = global.window;
  const run = async (name, check) => { try { await check(); passed += 1; } catch (error) { error.message = `${name}: ${error.message}`; throw error; } };
  const data = new Map();
  global.window = { sessionStorage: { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) } };
  const make = (uid = 'synthetic-tech') => ({ uid, email: `${uid}@demac-preview.invalid`, idToken: 'synthetic-expired-token', refreshToken: 'synthetic-refresh', expiresAt: Date.now() - 1 });
  const reply = (patch = {}) => new Response(JSON.stringify({ user_id: 'synthetic-tech', id_token: 'synthetic-new-token', refresh_token: 'synthetic-next-refresh', expires_in: '3600', ...patch }), { status: 200 });
  const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
  const seed = () => { session.clearFirebaseWebSession(); session.persistFirebaseWebSession(make()); };
  const fresh = () => ({ ...make(), expiresAt: Date.now() + 3600000 });
  global.fetch = async () => { throw new Error('Unconfigured test transport.'); };
  try {
    for (const status of [408,429,500,502,503,504]) await run(`refresh HTTP ${status} keeps credential but rejects expired access`, async () => {
      seed(); const before = session.loadFirebaseWebSession(); global.fetch = async () => new Response('<html>upstream unavailable</html>', { status });
      await assert.rejects(session.getValidFirebaseWebSession(), (error) => transport.isTransientFirebaseError(error));
      assert.deepEqual(session.loadFirebaseWebSession(), before);
    });
    await run('network TypeError preserves refresh session', async () => {
      seed(); global.fetch = async () => { throw new TypeError('Load failed'); };
      await assert.rejects(session.getValidFirebaseWebSession(), transport.FirebaseRequestError);
      assert.equal(session.loadFirebaseWebSession().uid,'synthetic-tech');
    });
    await run('an aborted response stream is retryable', async () => {
      seed(); global.fetch = async () => ({ ok: true, json: async () => { throw new DOMException('Aborted','AbortError'); } });
      await assert.rejects(session.getValidFirebaseWebSession(), (error) => transport.isTransientFirebaseError(error));
      assert.ok(session.loadFirebaseWebSession());
    });
    for (const code of ['TOKEN_EXPIRED','USER_DISABLED','USER_NOT_FOUND','INVALID_REFRESH_TOKEN','INVALID_ID_TOKEN','PROJECT_NUMBER_MISMATCH']) await run(`authoritative ${code} clears session`, async () => {
      seed(); global.fetch = async () => new Response(JSON.stringify({error:{message:code}}),{status:400});
      await assert.rejects(session.getValidFirebaseWebSession()); assert.equal(session.loadFirebaseWebSession(),null);
    });
    for (const status of [401,403]) await run(`permission HTTP ${status} is not transient`, async () => {
      seed(); global.fetch = async () => new Response('{}',{status});
      await assert.rejects(session.getValidFirebaseWebSession()); assert.equal(session.loadFirebaseWebSession(),null);
    });
    await run('disabled identity is denied even on malformed upstream 503 status', async () => {
      seed(); global.fetch = async () => new Response(JSON.stringify({error:{message:'USER_DISABLED'}}),{status:503});
      await assert.rejects(session.getValidFirebaseWebSession()); assert.equal(session.loadFirebaseWebSession(),null);
    });
    await run('unknown application exceptions are not network failures', async () => {
      seed(); global.fetch = async () => { throw new Error('application defect'); };
      await assert.rejects(session.getValidFirebaseWebSession()); assert.equal(session.loadFirebaseWebSession(),null);
    });
    await run('simultaneous readers issue a single refresh', async () => {
      seed(); const wait = deferred(); let calls = 0;
      global.fetch = async () => { calls++; return wait.promise; };
      const left = session.getValidFirebaseWebSession(), right = session.getValidFirebaseWebSession();
      assert.equal(calls,1); wait.resolve(reply());
      const [a,b] = await Promise.all([left,right]); assert.deepEqual(a,b); assert.equal(a.idToken,'synthetic-new-token');
    });
    await run('failed refresh flight is released for explicit retry', async () => {
      seed(); global.fetch = async () => new Response('{}',{status:503}); await assert.rejects(session.getValidFirebaseWebSession());
      global.fetch = async () => reply(); assert.equal((await session.getValidFirebaseWebSession()).idToken,'synthetic-new-token');
    });
    await run('late successful refresh cannot undo sign-out', async () => {
      seed(); const wait=deferred(); global.fetch=async()=>wait.promise;
      const result=session.getValidFirebaseWebSession(); const rejected=assert.rejects(result,session.FirebaseSessionSupersededError);
      session.clearFirebaseWebSession(); wait.resolve(reply()); await rejected; assert.equal(session.loadFirebaseWebSession(),null);
    });
    for (const status of [200,401,503]) await run(`old refresh response ${status} cannot replace or clear a newer account`, async () => {
      seed(); const wait=deferred(); global.fetch=async()=>wait.promise;
      const result=session.getValidFirebaseWebSession(); const rejected=assert.rejects(result,session.FirebaseSessionSupersededError);
      const other={...fresh(),uid:'synthetic-helper',email:'helper@demac-preview.invalid'}; session.persistFirebaseWebSession(other);
      wait.resolve(status===200?reply():new Response('{}',{status})); await rejected; assert.deepEqual(session.loadFirebaseWebSession(),other);
    });
    for (const patch of [{user_id:'other-user'},{id_token:''},{refresh_token:''},{expires_in:'NaN'},{expires_in:'Infinity'},{expires_in:'-1'},{expires_in:'1e308'}]) await run('invalid refresh payload is rejected', async () => {
      seed(); global.fetch=async()=>reply(patch); await assert.rejects(session.getValidFirebaseWebSession()); assert.equal(session.loadFirebaseWebSession(),null);
    });
    await run('malformed success JSON is not accepted as an offline state', async () => {
      seed(); global.fetch=async()=>new Response('{invalid',{status:200}); await assert.rejects(session.getValidFirebaseWebSession()); assert.equal(session.loadFirebaseWebSession(),null);
    });
    await run('quota failure does not masquerade as another successful session', async () => {
      seed(); const set=window.sessionStorage.setItem; window.sessionStorage.setItem=()=>{throw new DOMException('quota','QuotaExceededError');};
      global.fetch=async()=>reply(); try { await assert.rejects(session.getValidFirebaseWebSession(),(e)=>!(e instanceof session.FirebaseSessionSupersededError)); assert.equal(session.loadFirebaseWebSession(),null); }
      finally { window.sessionStorage.setItem=set; }
    });
    await run('late login cannot undo sign-out', async () => {
      const wait=deferred(); global.fetch=async()=>wait.promise;
      const result=session.signInWithFirebaseEmail('tech@demac-preview.invalid','synthetic-password'); const rejected=assert.rejects(result,session.FirebaseSessionSupersededError);
      session.clearFirebaseWebSession(); wait.resolve(new Response(JSON.stringify({localId:'synthetic-tech',email:'tech@demac-preview.invalid',idToken:'synthetic-id',refreshToken:'synthetic-ref',expiresIn:'3600'})));
      await rejected; assert.equal(session.loadFirebaseWebSession(),null);
    });
    await run('invalid cached shape is not a session',async()=>{
      data.set('demac.erp-next.firebase.session.v1',JSON.stringify({uid:'invented'})); assert.equal(session.loadFirebaseWebSession(),null); assert.equal(data.size,0);
    });
    await run('unexpired session is returned without a transport call',async()=>{
      session.persistFirebaseWebSession(fresh()); let calls=0; global.fetch=async()=>{calls++;throw Error('unexpected');}; assert.ok(await session.getValidFirebaseWebSession());assert.equal(calls,0);
    });
    await run('response body is not reflected in an error',async()=>{
      const error=await transport.firebaseResponseError(new Response(JSON.stringify({error:{message:'INVALID_REFRESH_TOKEN : synthetic-secret https://untrusted.invalid'}}),{status:400}),'generic');
      assert.equal(error.message,'INVALID_REFRESH_TOKEN');assert.equal(error.code,'INVALID_REFRESH_TOKEN');
    });
    console.log(`PASS session transport/storage (${passed} cases).`);
    return passed;
  } finally { if (originalWindow === undefined) delete global.window; else global.window = originalWindow; global.fetch = originalFetch; }
};
