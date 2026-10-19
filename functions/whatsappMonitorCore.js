'use strict';

const crypto = require('node:crypto');
const ROOT = 'businessSettings/whatsapp';
const PATHS = Object.freeze({ control: `${ROOT}/monitorControl/active`, snapshot: `${ROOT}/monitorSnapshots/current`,
  incidents: `${ROOT}/monitorIncidents`, expectations: `${ROOT}/monitorExpectations`, days: `${ROOT}/monitorDays`, audit: `${ROOT}/monitorAudit` });
const VERSION = 1;
const MINUTE = 60000;
const DISCARD_REASON = 'owner-requested-20261019-cutover';
const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function millis(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  return Date.parse(String(value || '')) || 0;
}
function localDate(at) { return new Date(at - 4 * 3600000).toISOString().slice(0, 10); }
function dayStart(date) { return Date.parse(`${date}T00:00:00-04:00`); }
function safeId(value) { return typeof value === 'string' && value.length <= 300 && !value.includes('/') ? value : ''; }
function flow(record) {
  const type = String(record.notificationType || '');
  return type.startsWith('appointment-') ? 'clients' : type.startsWith('van-') || record.recipientType === 'whatsapp-group' ? 'technicians' : 'other';
}
function orderFingerprint(order) {
  const fields = ['status', 'date', 'time', 'address', 'problem', 'serviceId', 'propertyId', 'clientId', 'vanId',
    'appointmentEndTime', 'scheduledSlots', 'technicianIds', 'notificationRecipients', 'whatsappNotificationsEnabled', 'backdated', 'bookingMode'];
  return hash(JSON.stringify(fields.map(key => [key, order?.[key] ?? null])));
}
function queueCreated(record) { return millis(record.createdAt) || millis(record.createdAtIso); }
function publicQueue(record) {
  const count = Array.isArray(record.messages) ? record.messages.length : 1;
  const index = Number(record.messageIndex || 0);
  return { id: safeId(record.id), flow: flow(record), appointmentId: safeId(record.appointmentId), workOrderId: safeId(record.workOrderId),
    vanId: safeId(record.vanId), status: ['queued','processing','failed','sent','cancelled'].includes(record.status) ? record.status : 'unknown',
    createdAtMs: queueCreated(record), completedAtMs: millis(record.completedAt), totalParts: count,
    completedParts: record.status === 'sent' ? count : Math.min(count, Math.max(0, index)),
    lastProgressAtMs: millis(record.completedAt), leaseUntilMs: millis(record.leaseUntil) };
}
const SEVERITY = { healthy: 0, warning: 1, unknown: 2, critical: 3 };
function evaluate({ at, queue = [], missing = [], transport = {}, coverage = [], daily = {}, policy = {} }) {
  const date = localDate(at);
  const groups = new Map();
  const affected = new Set();
  const flows = Object.fromEntries(['clients','technicians','other'].map(key => [key, { confirmed: 0, pending: 0, affected: 0 }]));
  let oldestWaitMs = 0;
  function add(code, severity, scope, items = [], since = at) {
    const id = hash(`${code}:${scope}`);
    const existing = groups.get(id) || { id, code, severity, scope, flow: scope.split(':')[0], sinceMs: since, items: [], count: 0 };
    if (SEVERITY[severity] > SEVERITY[existing.severity]) existing.severity = severity;
    existing.sinceMs = Math.min(existing.sinceMs, since);
    for (const item of items) {
      if (!existing.items.some(previous => previous.id === item.id)) { existing.items.push(item); existing.count++; }
      if (!affected.has(item.id)) { affected.add(item.id); if (flows[item.flow]) flows[item.flow].affected++; }
    }
    groups.set(id, existing);
  }
  const byId = new Map(queue.map(record => [record.id, record]));
  const records = [];
  let historicalCount = 0;
  for (const record of queue) {
    if (record.status === 'cancelled' || record.cancellationReason === DISCARD_REASON) continue;
    const item = publicQueue(record);
    if (record.status === 'sent') {
      if (item.completedAtMs >= dayStart(date)) flows[item.flow].confirmed++;
      continue;
    }
    if (!['queued','processing','failed'].includes(record.status)) continue;
    if ((record.scheduleDate && record.scheduleDate < date) || (policy.startedAtMs && item.createdAtMs && item.createdAtMs < policy.startedAtMs)) { historicalCount++; continue; }
    records.push(item);
    flows[item.flow].pending++;
    const scope = `${item.flow}:${item.vanId || 'all'}`;
    let eligibleAt = queueCreated(record);
    if (!eligibleAt || eligibleAt > at + MINUTE) { add('record_time_unknown', 'warning', scope, [item]); continue; }
    if (record.status === 'failed') { add('send_failed', 'critical', scope, [item], millis(record.failedAt) || eligibleAt); continue; }
    if (record.dependsOnQueueId) {
      const parent = byId.get(record.dependsOnQueueId);
      if (!parent) { add('dependency_unknown', 'warning', scope, [item], eligibleAt); continue; }
      if (parent.to !== record.to || (['queued','processing'].includes(parent.status) && policy.startedAtMs && queueCreated(parent) < policy.startedAtMs)) {
        add('dependency_unknown', 'warning', scope, [item], eligibleAt); continue;
      }
      if (['queued','processing'].includes(parent.status)) continue; // Root blockage is reported once, not as a storm of followers.
      if (!['sent','failed'].includes(parent.status) && !(parent.status === 'cancelled' && parent.cancellationReason === DISCARD_REASON)) {
        add('dependency_unknown', 'warning', scope, [item], eligibleAt); continue;
      }
      eligibleAt = Math.max(eligibleAt, millis(parent.completedAt) || millis(parent.failedAt) || millis(parent.cancelledAt));
    }
    const retryAt = millis(record.retryAfterIso);
    if (retryAt > at) continue;
    eligibleAt = Math.max(eligibleAt, retryAt, item.lastProgressAtMs);
    const age = Math.max(0, at - eligibleAt);
    oldestWaitMs = Math.max(oldestWaitMs, age);
    if (record.status === 'processing') {
      if (!item.leaseUntilMs || at > item.leaseUntilMs + MINUTE) add('ack_overdue', 'critical', scope, [item], eligibleAt);
      else if (age > 2 * MINUTE) add('send_slow', 'warning', scope, [item], eligibleAt);
    } else if (age >= 2 * MINUTE) add('queue_stalled', age >= 5 * MINUTE ? 'critical' : 'warning', scope, [item], eligibleAt);
  }
  for (const expected of missing) {
    if (expected.cancelled || expected.dueAtMs > at || expected.historical || expected.dueAtMs < (policy.startedAtMs || 0)) continue;
    const age = Math.max(0, at - expected.dueAtMs);
    if (age < 2 * MINUTE && !expected.configurationError) continue;
    const item = { id: expected.id, flow: expected.flow, appointmentId: safeId(expected.appointmentId), workOrderId: safeId(expected.workOrderId),
      vanId: safeId(expected.vanId), status: 'missing', createdAtMs: expected.dueAtMs, totalParts: 1, completedParts: 0 };
    flows[item.flow].pending++;
    oldestWaitMs = Math.max(oldestWaitMs, age);
    add(expected.configurationError ? 'recipient_invalid' : 'not_generated', expected.configurationError || age >= 5 * MINUTE ? 'critical' : 'warning',
      `${item.flow}:${item.vanId || 'all'}`, [item], expected.dueAtMs);
    records.push(item);
  }
  const lastPollAtMs = millis(transport.lastSuccessAtMs);
  let transportStatus = 'healthy';
  if (transport.available !== true || !lastPollAtMs || lastPollAtMs > at + MINUTE) {
    transportStatus = 'unknown'; add('transport_unknown', 'unknown', 'system:transport');
  } else if (millis(transport.lastErrorAtMs) > lastPollAtMs) {
    transportStatus = 'critical'; add('transport_error', 'critical', 'system:transport', [], transport.lastErrorAtMs);
  } else if (at - lastPollAtMs > 90000) {
    transportStatus = at - lastPollAtMs > 180000 ? 'critical' : 'warning';
    add('transport_stale', transportStatus, 'system:transport', [], lastPollAtMs);
  }
  if (coverage.length) add('coverage_incomplete', 'unknown', 'system:coverage');
  if (daily.required && at >= daily.dueAtMs + 2 * MINUTE && !daily.batchPresent) {
    add('schedule_not_run', at >= daily.dueAtMs + 5 * MINUTE ? 'critical' : 'warning', 'technicians:all', [], daily.dueAtMs);
  }
  let incidents = [...groups.values()].sort((a,b) => SEVERITY[b.severity] - SEVERITY[a.severity] || a.sinceMs - b.sinceMs);
  const incidentOverflow = incidents.length > 60 || incidents.some(item => item.items.length > 100);
  if (incidentOverflow && !coverage.includes('display_limit')) coverage = [...coverage, 'display_limit'];
  incidents = incidents.slice(0,60).map(item => ({ ...item, items: item.items.slice(0,100), truncated: item.count > 100 }));
  const status = incidents.some(item => item.severity === 'critical') ? 'critical' : coverage.length || incidents.some(item => item.severity === 'unknown') ? 'unknown' : incidents.length ? 'warning' : 'healthy';
  return { version: VERSION, evaluatedAtMs: at, date, status, incidents, flows, transport: { status: transportStatus, lastSuccessAtMs: lastPollAtMs || null, lastErrorAtMs: millis(transport.lastErrorAtMs) || null },
    counts: { incidents: incidents.length, affected: affected.size, confirmed: Object.values(flows).reduce((sum,x)=>sum+x.confirmed,0), pending: Object.values(flows).reduce((sum,x)=>sum+x.pending,0), historical: historicalCount },
    oldestWaitMs, coverage, queue: records.slice(0,200), queueTruncated: records.length > 200, daily,
    notifications: { configured: policy.externalAlertsVerified === true, destinationLabel: policy.externalAlertsVerified === true ? 'Canales verificados de Cloud Monitoring' : 'Sin configurar', deliveryStatus: 'not_observed' } };
}
module.exports = { VERSION, PATHS, MINUTE, DISCARD_REASON, hash, millis, localDate, dayStart, safeId, flow, orderFingerprint, queueCreated, publicQueue, evaluate };
