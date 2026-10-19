'use strict';
// Incident-only, bounded reads. Never emit recipients, message bodies, credentials or raw logs.
const { execFileSync } = require('node:child_process');
const functionRequire = require('node:module').createRequire(require('node:path').resolve(__dirname, '../functions/package.json'));
const { initializeApp } = functionRequire('firebase-admin/app');
const { getFirestore, Timestamp } = functionRequire('firebase-admin/firestore');
const project = 'demac-corporation';
const day = '2026-10-19';
const start = '2026-10-17T04:00:00Z';
const end = '2026-10-20T04:00:00Z';
const emit = (section, data) => console.log(JSON.stringify({ section, ...data }));
function category(value) {
  const text = String(value || '').toLowerCase();
  for (const [label, pattern] of [
    ['permission_denied', /permission.denied|does not have|not authorized/],
    ['unauthorized', /unauthorized|http 401|invalid.*token/],
    ['session_disconnected', /logged.out|not logged|not authenticated|session.*expired|not connected|disconnected/],
    ['index_required', /requires an index|failed.precondition/],
    ['quota_or_capacity', /resource.exhausted|quota|too many|429/],
    ['timeout', /timeout|timed out|deadline.exceeded/],
    ['network', /econn|enotfound|socket|fetch failed/],
    ['dependency', /dependency|predecessor|claim.*active|ownership changed/],
  ]) if (pattern.test(text)) return label;
  return text ? 'other_redacted_error' : null;
}
function safeError(error) { return { category: category(error.stderr || error.message), code: error.code || error.status || null }; }
async function section(name, callback) {
  try { emit(name, { ok: true, ...await callback() }); }
  catch (error) { emit(name, { ok: false, ...safeError(error) }); }
}
function cloud(args) {
  return JSON.parse(execFileSync('gcloud', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 5e6, stdio: ['ignore', 'pipe', 'pipe'] }));
}
const iso = value => value?.toDate ? value.toDate().toISOString() : typeof value === 'string' ? value : null;
function summarize(docs, limit) {
  const counts = {}, errors = {};
  let attempted = 0, oldestPending = null, latestSent = null;
  for (const doc of docs) {
    const d = doc.data();
    const kind = ['appointment-confirmation','appointment-reminder','van-daily-work-order','van-daily-pending-period','van-daily-lunch-break'].includes(d.notificationType) ? d.notificationType : 'other';
    const provider = ['wacli','meta'].includes(d.provider) ? d.provider : 'other';
    const status = ['queued','processing','sent','failed','delivered','read','cancelled'].includes(d.status) ? d.status : 'other';
    const key = [provider, kind, status].join('/'); counts[key] = (counts[key] || 0) + 1;
    if (Number(d.attempts || 0) > 0) attempted++;
    const error = category(d.errorMessage); if (error) errors[error] = (errors[error] || 0) + 1;
    const created = iso(d.createdAt) || d.createdAtIso;
    if (['queued','processing'].includes(status) && created && (!oldestPending || created < oldestPending)) oldestPending = created;
    const sent = iso(d.sentAt); if (sent && (!latestSent || sent > latestSent)) latestSent = sent;
  }
  return { count: docs.length, limitReached: docs.length === limit, counts, attempted, errors, oldestPending, latestSent };
}
async function main() {
  initializeApp({ projectId: project });
  const db = getFirestore();
  emit('scope', { project, day, start, end, readOnly: true, at: new Date().toISOString() });
  await section('transport_settings', async () => {
    const d = (await db.doc('businessSettings/whatsapp').get()).data() || {};
    return { provider: ['wacli','meta'].includes(d.transactionalProvider) ? d.transactionalProvider : 'default_or_unknown', outboundDisabled: d.transactionalOutboundEnabled === false };
  });
  await section('daily_batches', async () => {
    const results = [];
    for (const date of ['2026-10-17','2026-10-18',day]) {
      const s = await db.doc('technicianDailyScheduleBatches/' + date).get(); const d = s.data() || {};
      const value = { date, exists: s.exists };
      for (const key of ['status','attemptCount','vanCount','workOrderCount','messageCount','queuedCount','idempotentCount','failedCount']) if (d[key] !== undefined) value[key] = d[key];
      for (const key of ['startedAt','lastAttemptAt','completedAt','updatedAt']) value[key] = iso(d[key]);
      value.errorCategory = category(d.fatalError); results.push(value);
    }
    return { batches: results };
  });
  const fields = ['status','provider','notificationType','createdAt','createdAtIso','sentAt','attempts','errorMessage'];
  await section('today_van_queue', async () => summarize((await db.collection('whatsappOutboundQueue').where('scheduleDate','==',day).select(...fields).limit(500).get()).docs,500));
  await section('recent_queue', async () => summarize((await db.collection('whatsappOutboundQueue').where('createdAt','>=',Timestamp.fromDate(new Date(start))).where('createdAt','<',Timestamp.fromDate(new Date(end))).select(...fields).limit(1000).get()).docs,1000));
  await section('pending_queue', async () => summarize((await db.collection('whatsappOutboundQueue').where('status','in',['queued','processing']).select(...fields).limit(500).get()).docs,500));
  await section('scheduler', async () => cloud(['scheduler','jobs','describe','firebase-schedule-sendDailyTechnicianSchedules-us-central1','--project='+project,'--location=us-central1','--format=json(state,schedule,timeZone,lastAttemptTime,scheduleTime,status)']));
  for (const name of ['queueAppointmentConfirmation','sendDailyTechnicianSchedules','wacliOutboundPoll','wacliOutboundAck']) {
    await section('function_'+name, async () => cloud(['functions','describe',name,'--project='+project,'--region=us-central1','--gen2','--format=json(state,updateTime,serviceConfig.revision,eventTrigger.retryPolicy)']));
  }
  await section('runtime_errors', async () => {
    const filter = 'timestamp>="2026-10-19T04:00:00Z" AND timestamp<"2026-10-20T04:00:00Z" AND severity>=ERROR AND (resource.labels.service_name="waclioutboundpoll" OR resource.labels.service_name="waclioutboundack" OR resource.labels.service_name="queueappointmentconfirmation" OR resource.labels.service_name="senddailytechnicianschedules")';
    const rows = cloud(['logging','read',filter,'--project='+project,'--limit=80','--format=json']);
    const counts={};
    for (const row of rows) { const key=String(row.resource?.labels?.service_name||'unknown')+'/'+category(JSON.stringify(row.jsonPayload||row.textPayload||row.httpRequest||{})); counts[key]=(counts[key]||0)+1; }
    return { count: rows.length, limitReached: rows.length===80, counts };
  });
}
main().catch(error => { emit('fatal', safeError(error)); process.exitCode = 1; });
