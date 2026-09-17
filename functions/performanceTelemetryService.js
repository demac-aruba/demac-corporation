"use strict";

const crypto = require('node:crypto');
const C = require('./performanceTelemetryCore');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');
const RETENTION = 45 * 86400000;
const ROLES = new Map([
  ['admin','super_admin'], ['owner','super_admin'], ['superadmin','super_admin'], ['super_admin','super_admin'],
  ['office','office_operator'], ['operator','office_operator'], ['office_operator','office_operator'],
  ['supervisor','operations'], ['manager','operations'], ['operations','operations'], ['operation','operations'],
  ['finance','finance'], ['accounting','finance'], ['inventory','warehouse'], ['warehouse','warehouse'],
  ['sales','sales'], ['project_manager','project_manager'], ['projects','project_manager'],
  ['technician','technician'], ['tech','technician'], ['auditor','auditor'], ['readonly','auditor'], ['read_only','auditor'],
]);
function role(value) { return ROLES.get(String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_')); }
function requireAdmin(actor) { if (actor.role !== 'super_admin') C.fail('permission_denied', 'Only a system administrator can view or control telemetry.'); }

function createPerformanceTelemetryApi({ db, verifyIdToken, timestamp = (ms) => new Date(ms), now = Date.now, enabled = false, environment = 'production' }) {
  if (!db || typeof db.runTransaction !== 'function' || typeof verifyIdToken !== 'function') throw new Error('Telemetry dependencies are required.');
  const controlRef = db.collection(C.COLLECTIONS.control).doc('collection');
  const policyValue = (snapshot) => {
    const stored = snapshot.exists ? snapshot.data() : {};
    return { enabled: enabled && stored.enabled !== false, configured: enabled, version: Number(stored.version) || 0 };
  };
  async function identity(request) {
    const match = String(request.headers?.authorization || '').match(/^Bearer\s+(\S{1,4000})$/i);
    if (!match) C.fail('unauthenticated', 'A valid ERP session is required.');
    let decoded;
    try { decoded = await verifyIdToken(match[1]); } catch { C.fail('unauthenticated', 'The ERP session could not be verified.'); }
    if (typeof decoded?.uid !== 'string' || !decoded.uid || decoded.uid.includes('/')) C.fail('unauthenticated', 'Invalid session identity.');
    const snapshot = await db.collection('users').doc(decoded.uid).get();
    const profile = snapshot.exists ? snapshot.data() : null;
    const normalized = role(profile?.role);
    if (profile?.active !== true || !normalized) C.fail('permission_denied', 'An active authorized ERP profile is required.');
    return { uid: decoded.uid, role: normalized };
  }
  async function policy() {
    return { success: true, version: C.VERSION, environment, ...policyValue(await controlRef.get()) };
  }
  async function setCollection(data, actor) {
    requireAdmin(actor);
    if (typeof data.enabled !== 'boolean' || !Number.isSafeInteger(data.expectedVersion)) C.fail('invalid_request', 'A versioned collection setting is required.');
    const auditRef = db.collection(C.COLLECTIONS.audit).doc(crypto.randomUUID());
    return db.runTransaction(async (tx) => {
      const current = policyValue(await tx.get(controlRef));
      if (data.expectedVersion !== current.version) C.fail('conflict', 'Collection settings changed. Refresh before trying again.');
      if (data.enabled && !enabled) C.fail('disabled', 'The deployment-level telemetry switch is off.');
      const at = now();
      tx.set(controlRef, { enabled: data.enabled, version: current.version + 1, changedAtMs: at });
      tx.set(auditRef, { action: 'set_collection', enabled: data.enabled, version: current.version + 1, actorHash: hash(actor.uid), atMs: at, expiresAt: timestamp(at + RETENTION) });
      return { success: true, version: C.VERSION, configured: enabled, enabled: data.enabled && enabled, controlVersion: current.version + 1 };
    });
  }
  async function ingest(input, actor) {
    const batch = C.normalizeBatch(input, environment);
    const fingerprint = hash(JSON.stringify(batch));
    const receiptRef = db.collection(C.COLLECTIONS.receipts).doc(hash(`${actor.uid}:${batch.batchId}`));
    const sessionRef = db.collection(C.COLLECTIONS.sessions).doc(hash(`${actor.uid}:${batch.sessionId}`));
    const rateRef = db.collection(C.COLLECTIONS.rate).doc(hash(actor.uid));
    return db.runTransaction(async (tx) => {
      // All reads precede all writes. The receipt, rollups and session commit atomically.
      const [control, receipt, rateSnapshot] = await tx.getAll(controlRef, receiptRef, rateRef);
      if (!policyValue(control).enabled) C.fail('disabled', 'Performance collection is paused.');
      if (receipt.exists) {
        if (receipt.data().fingerprint !== fingerprint) C.fail('conflict', 'The telemetry batch ID was reused with different content.');
        return { success: true, version: C.VERSION, accepted: receipt.data().accepted, replayed: true };
      }
      const at = now();
      if (batch.measurements.some((m) => m.observedAtMs < at - C.MAX_AGE_MS || m.observedAtMs > at + 30000)) C.fail('invalid_request', 'Observation timestamps are outside the accepted window.');
      const rate = rateSnapshot.exists ? rateSnapshot.data() : {};
      const minute = Math.floor(at / 60000);
      const count = rate.minute === minute ? Number(rate.count) || 0 : 0;
      if (count >= 12) C.fail('rate_limited', 'Telemetry batch limit reached.');
      const shard = parseInt(hash(batch.sessionId).slice(0, 2), 16) % 4;
      const groups = new Map();
      for (const [collection, size] of [[C.COLLECTIONS.quarter,900000],[C.COLLECTIONS.hour,3600000],[C.COLLECTIONS.day,86400000]]) {
        for (const measurement of batch.measurements) {
          const start = Math.floor(measurement.observedAtMs / size) * size;
          const key = `${collection}/${start}-${shard}`;
          if (!groups.has(key)) groups.set(key, { ref: db.doc(key), start, values: [] });
          groups.get(key).values.push(measurement);
        }
      }
      const groupList = [...groups.values()];
      const snapshots = await tx.getAll(...groupList.map((g) => g.ref));
      const rollups = groupList.map((group, index) => {
        const previous = snapshots[index].exists ? snapshots[index].data() : {};
        const metrics = { ...(previous.metrics || {}) };
        for (const [key, delta] of Object.entries(C.aggregate(group.values, batch.release))) {
          metrics[key] = metrics[key] ? C.addMetric({ ...metrics[key], histogram: { ...metrics[key].histogram } }, delta) : delta;
        }
        if (Object.keys(metrics).length > 512 || Buffer.byteLength(JSON.stringify(metrics)) > 750000) C.fail('capacity_exceeded', 'Telemetry dimensional budget reached.');
        return { group, data: { schema: C.VERSION, environment, bucketStartMs: group.start, metrics,
          lastObservedAtMs: Math.max(previous.lastObservedAtMs || 0, ...group.values.map((m) => m.observedAtMs)),
          lastReceivedAtMs: at, expiresAt: timestamp(group.start + RETENTION) } };
      });
      for (const { group, data } of rollups) tx.set(group.ref, data);
      tx.set(sessionRef, { role: actor.role, module: batch.module, release: batch.release, visible: batch.visible,
        lastSeenMs: at, expiresAt: timestamp(at + 2 * 86400000) });
      tx.set(rateRef, { minute, count: count + 1, expiresAt: timestamp(at + 2 * 86400000) });
      tx.set(receiptRef, { fingerprint, accepted: batch.measurements.length, atMs: at, expiresAt: timestamp(at + 2 * 86400000) });
      return { success: true, version: C.VERSION, accepted: batch.measurements.length, replayed: false };
    });
  }
  async function dashboard(data, actor) {
    requireAdmin(actor);
    const at = now();
    const spec = C.windowSpec(data.rangeMinutes, at);
    const release = data.release === 'all' || data.release === undefined ? 'all' : data.release;
    if (release !== 'all' && !/^[a-f0-9]{40}$/.test(release)) C.fail('invalid_request', 'Invalid release filter.');
    const selectedMetric = Object.hasOwn(C.UNITS, data.metric) && C.UNITS[data.metric] === 'ms' ? data.metric : 'schedule_data_ready';
    const selectedModule = C.MODULES.has(data.module) ? data.module : 'scheduling';
    const [buckets, sessions, control] = await Promise.all([
      db.collection(spec.collection).where('bucketStartMs', '>=', spec.from).where('bucketStartMs', '<=', at).orderBy('bucketStartMs', 'asc').limit(801).get(),
      db.collection(C.COLLECTIONS.sessions).where('lastSeenMs', '>=', at - C.STALE_MS).limit(201).get(),
      controlRef.get(),
    ]);
    const allMetrics = []; const timeline = new Map(); const days = new Set(); let lastReceivedAtMs = 0;
    for (const doc of buckets.docs.slice(0,800)) {
      const item = doc.data();
      if (item.schema !== C.VERSION || item.environment !== environment) continue;
      lastReceivedAtMs = Math.max(lastReceivedAtMs, item.lastReceivedAtMs || 0);
      for (const raw of Object.values(item.metrics || {})) {
        if (!raw || !C.MODULES.has(raw.module) || C.UNITS[raw.name] !== raw.unit) continue;
        allMetrics.push(raw);
        if (raw.module !== 'performance' && C.PRIMARY_METRICS.has(raw.name)) days.add(new Date(item.bucketStartMs).toISOString().slice(0,10));
        if ((release === 'all' || raw.release === release) && raw.module === selectedModule && raw.name === selectedMetric) {
          if (!timeline.has(item.bucketStartMs)) timeline.set(item.bucketStartMs, C.emptyMetric(raw.name, raw.module, release, raw.unit));
          C.addMetric(timeline.get(item.bucketStartMs), raw);
        }
      }
    }
    const filtered = allMetrics.filter((metric) => release === 'all' || metric.release === release);
    const metrics = C.pool(filtered);
    const releases = [...new Set(allMetrics.map((metric) => metric.release))].sort();
    const releaseMetrics = releases.flatMap((id) => C.pool(allMetrics.filter((metric) => metric.release === id)).map((metric) => ({ ...metric, release: id })));
    const active = sessions.docs.slice(0,200).map((doc) => doc.data()).filter((session) => session.visible === true);
    const activeModules = {}; const activeRoles = {};
    for (const item of active) {
      activeModules[item.module] = (activeModules[item.module] || 0) + 1;
      activeRoles[item.role] = (activeRoles[item.role] || 0) + 1;
    }
    const coverage = ['schedule_data_ready','support_slot_validation','confirm_appointment'].map((name) => ({ name, count: metrics.find((m) => m.module === 'scheduling' && m.name === name)?.count || 0 }));
    return { success: true, version: C.VERSION, environment, generatedAtMs: at,
      rangeMinutes: spec.rangeMinutes, windowStartMs: spec.from, windowEndMs: at, bucketSizeMs: spec.size,
      bucketCount: buckets.size, truncated: buckets.size > 800, sessionsTruncated: sessions.size > 200,
      lastReceivedAtMs: lastReceivedAtMs || null,
      lastObservedAtMs: filtered.length ? Math.max(...filtered.map((m) => m.lastObservedAtMs || 0)) : null,
      policy: policyValue(control), metrics, releases, releaseMetrics,
      timeline: [...timeline.entries()].sort((a,b) => a[0]-b[0]).map(([atMs, metric]) => ({ atMs, ...C.serialize(metric) })),
      trend: { name: selectedMetric, module: selectedModule }, activeSessions: active.length, activeModules, activeRoles,
      health: C.health(metrics, at), baseline: { observedDays: days.size, requiredDays: 5, coverage, ready: !data.truncated && days.size >= 5 && coverage.every((m) => m.count >= 20) },
      recovery: { backupVerified: false, restoreVerified: false, reason: 'No verified backup/restore provider is connected.' },
    };
  }
  async function handle(request) {
    if (request.method === 'OPTIONS') return { status: 204, body: null };
    if (request.method !== 'POST') return { status: 405, body: { error: { code: 'method_not_allowed', message: 'POST required.' } } };
    try {
      const size = request.rawBody?.length ?? Buffer.byteLength(JSON.stringify(request.body || {}));
      if (size > 60000) C.fail('payload_too_large', 'Telemetry payload exceeds the transport budget.');
      const actor = await identity(request);
      const data = request.body?.data || {};
      const action = request.body?.action;
      const body = action === 'policy' ? await policy()
        : action === 'ingest' ? await ingest(data, actor)
        : action === 'dashboard' ? await dashboard(data, actor)
        : action === 'set_collection' ? await setCollection(data, actor)
        : C.fail('invalid_request', 'Unsupported telemetry action.');
      return { status: 200, body };
    } catch (error) {
      const statuses = { unauthenticated:401, permission_denied:403, invalid_request:400, conflict:409, disabled:409, rate_limited:429, capacity_exceeded:429, payload_too_large:413 };
      const status = statuses[error?.code] || 500;
      return { status, body: { error: { code: status === 500 ? 'internal_error' : error.code,
        message: status === 500 ? 'Telemetry is temporarily unavailable. ERP operations are unaffected.' : error.message } } };
    }
  }
  return { handle, ingest, dashboard, policy, setCollection };
}
module.exports = { createPerformanceTelemetryApi, role };
