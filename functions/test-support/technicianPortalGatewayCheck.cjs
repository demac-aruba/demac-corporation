const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4397';
if (!/^http:\/\/127\.0\.0\.1:4397$/.test(base) && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)) throw new Error('Only the isolated gateway is allowed.');
const credentials = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE, 'utf8'));
const project = 'demo-demac-dwellings';
const root = `${base}/__preview/firebase/`;
const endpoint = `${root}us-central1-${project}.cloudfunctions.net/fieldOperationsAuthority`;
const results = [];
async function authenticate(uid) {
  const account = credentials.accounts.find((candidate) => candidate.uid === uid);
  const response = await fetch(`${root}identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }) });
  assert.equal(response.status, 200, `Synthetic sign-in failed for ${uid}`);
  return (await response.json()).idToken;
}
async function call(token, action, data = {}) {
  const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action, data }) });
  return { status: response.status, body: await response.json() };
}
function success(result, label) { assert.equal(result.status, 200, `${label}: HTTP ${result.status}; ${result.body.error?.code || result.body.error?.message || ''}`); }
(async () => {
  assert.deepEqual(await (await fetch(`${base}/__preview/health`)).json(), { isolated: true, project, workers: false });
  const tech = await authenticate('demo-tech'), helper = await authenticate('demo-helper'), office = await authenticate('demo-office'), outsider = await authenticate('demo-outsider');
  assert.equal((await call('', 'get_schedule')).status, 401);
  assert.equal((await call(`${tech}forged`, 'get_schedule')).status, 401);
  results.push('password auth for four separate accounts; no unauthenticated or forged-token access');
  for (const [url, method] of [
    [`${root}firestore.googleapis.com/v1/projects/demac-corporation/databases/(default)/documents/clients`, 'GET'],
    [`${root}firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents/clients/INVALID`, 'PATCH'],
    [`${root}firebasestorage.googleapis.com/v0/b/demac-corporation/o`, 'GET'],
  ]) assert.equal((await fetch(url, { method, headers: { authorization: `Bearer ${office}` } })).status, 403);
  assert.equal((await call(office, 'send_appointment_reminder')).status, 403);
  results.push('production projects, direct database writes and outbound delivery rejected');
  const a = await call(tech, 'get_schedule'), b = await call(helper, 'get_schedule');
  success(a, 'technician schedule'); success(b, 'helper schedule');
  assert.deepEqual(a.body.jobs.map((job) => job.workOrderId).sort(), ['DEMO-FIELD-1','DEMO-FIELD-2','DEMO-FIELD-3']);
  assert.deepEqual(a.body.jobs.map((job) => job.workOrderId), b.body.jobs.map((job) => job.workOrderId));
  assert.equal(a.body.jobs[0].crew.members.length, 2); assert.equal(b.body.jobs[0].responsibility, 'helper');
  const jobId = 'DEMO-FIELD-1';
  const original = await call(tech, 'get_job', { workOrderId: jobId }); success(original, 'assigned job');
  assert.equal(original.body.job.knownEquipment.length, 1, 'no equipment from another dwelling');
  const denied = await call(outsider, 'get_job', { workOrderId: jobId }); assert.equal(denied.status, 403);
  const outsideRoute = await call(outsider, 'get_schedule'); success(outsideRoute, 'outsider empty schedule'); assert.equal(outsideRoute.body.jobs.length, 0);
  results.push('same assigned jobs for technician/helper; canonical crew; other account and other dwelling excluded');
  if (process.env.PREVIEW_READ_ONLY !== 'true') {
    const requestId = 'technician-preview-prepare-v1';
    const prepared = await call(tech, 'prepare_visit', { workOrderId: jobId, requestId }); success(prepared, 'prepare');
    const retried = await call(tech, 'prepare_visit', { workOrderId: jobId, requestId }); success(retried, 'exact prepare retry');
    assert.equal(retried.body.visit.id, prepared.body.visit.id);
    let current = (await call(tech, 'get_job', { workOrderId: jobId })).body.job.fieldVisit;
    assert.equal((await call(helper, 'transition_visit', { visitId: current.id, to: 'en_route', expectedVersion: current.version, requestId: 'helper-global-denial' })).status, 403);
    for (const to of ['en_route','on_site','in_progress']) {
      if (!current.availableTransitions.includes(to)) continue;
      const changed = await call(tech, 'transition_visit', { visitId: current.id, to, expectedVersion: current.version, requestId: `technician-preview-${to}-v1` }); success(changed, `transition ${to}`); current = changed.body.visit;
    }
    const attached = await call(tech, 'attach_visit_asset', { visitId: current.id, assetId: `${jobId}-AC`, requestId: 'technician-preview-asset-v1' }); success(attached, 'attach existing AC');
    const retry = await call(tech, 'attach_visit_asset', { visitId: current.id, assetId: `${jobId}-AC`, requestId: 'technician-preview-asset-v1' }); success(retry, 'attachment retry');
    assert.equal(attached.body.visitAsset.id, retry.body.visitAsset.id);
    const seenByHelper = await call(helper, 'get_job', { workOrderId: jobId }); success(seenByHelper, 'helper observes persisted visit');
    assert.equal(seenByHelper.body.job.fieldVisit.id, current.id); assert.equal(seenByHelper.body.job.visitAssets.length, 1);
    results.push('one persisted shared visit and attached AC across users; exact retries do not duplicate; helper cannot change global arrival');
    const storagePath = `field-evidence/${current.id}/synthetic-access-proof/equipment_reference.png`;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII=', 'base64');
    const upload = await fetch(`${root}firebasestorage.googleapis.com/v0/b/${project}.appspot.com/o?uploadType=media&name=${encodeURIComponent(storagePath)}`, { method: 'POST', headers: { authorization: `Bearer ${tech}`, 'content-type': 'image/png' }, body: png });
    assert.equal(upload.status, 200, 'private synthetic Storage upload');
    const fileUrl = `${root}firebasestorage.googleapis.com/v0/b/${project}.appspot.com/o/${encodeURIComponent(storagePath)}?alt=media`;
    assert.equal((await fetch(fileUrl, { headers: { authorization: `Bearer ${tech}` } })).status, 200);
    assert.equal((await fetch(fileUrl, { headers: { authorization: `Bearer ${outsider}` } })).status, 403);
    results.push('synthetic Storage object private to authorized context; probe is not claimed as completed report evidence');
  }
  const review = await call(office, 'get_office_review_queue'); success(review, 'office review queue');
  assert.equal((await call(helper, 'get_office_review_queue')).status, 403);
  results.push('existing Office review queue remains role-restricted');
  fs.mkdirSync(process.env.PREVIEW_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.PREVIEW_EVIDENCE_DIR, process.env.PREVIEW_READ_ONLY === 'true' ? 'public-gateway-checks.json' : 'gateway-checks.json'), JSON.stringify({ base, project, checkedAt: new Date().toISOString(), passed: results, limits: ['Shared part ownership, procedures 14/9, binary outbox and complete Office send/return cycle are not delivered by this UI increment.'] }, null, 2));
  console.log(`PASS isolated gateway (${results.length} groups); no tokens or passwords logged.`);
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
