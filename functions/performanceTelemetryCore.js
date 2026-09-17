"use strict";

// Pure, deterministic telemetry contract. No Firebase, business data or credentials.
const VERSION = 2;
const MAX_BATCH = 80;
const MAX_AGE_MS = 15 * 60_000;
const STALE_MS = 5 * 60_000;
const BOUNDS = Object.freeze([16, 32, 50, 75, 100, 150, 200, 250, 350, 500, 650, 800, 1000, 1250, 1500, 2000, 2500, 3000, 4000, 5000, 7500, 10000, 15000, 30000, 60000, 120000, 300000, 600000]);
const UNITS = Object.freeze({
  route_view: 'count', session_heartbeat: 'count', telemetry_dropped: 'count',
  page_load: 'ms', dom_content_loaded: 'ms', ttfb: 'ms', first_contentful_paint: 'ms',
  long_task: 'ms', interaction_duration: 'ms', browser_error: 'count', unhandled_rejection: 'count',
  firestore_rest: 'ms', firebase_auth: 'ms', office_booking: 'ms', support_slot_validation: 'ms',
  confirm_appointment: 'ms', inventory_api: 'ms', field_api: 'ms', tasks_api: 'ms', api_other: 'ms',
  request_cancelled: 'count', schedule_data_ready: 'ms', schedule_reference_data: 'ms',
  schedule_work_orders: 'ms', schedule_work_order_fallback: 'count', schedule_load_error: 'count',
  schedule_appointment_count: 'count',
});
const MODULES = new Set(['dashboard','kpis','scheduling','crm','inventory','work-orders','field','employees','projects','tasks','catalog','communications','communication-center','customer-ai','marketing','finance','payroll','payments','banking','invoices','expenses','purchasing','vans','tools','reports','settings','performance','recruitment','website-manager','access-control','audit','leads','opportunities','estimates','maintenance','technicians','executive-ai','automations','integrations','escalations','erp']);
const PRIMARY_METRICS = new Set(['schedule_data_ready','support_slot_validation','confirm_appointment','firestore_rest','office_booking','inventory_api','field_api','tasks_api','api_other','page_load']);
const THRESHOLDS = Object.freeze({ schedule_data_ready: 2500, support_slot_validation: 1000, confirm_appointment: 2000, firestore_rest: 1500, page_load: 3000, inventory_api: 2000, field_api: 2000, tasks_api: 2000, office_booking: 2000, api_other: 3000 });
const COLLECTIONS = Object.freeze({
  quarter: 'performanceTelemetry15mV2', hour: 'performanceTelemetryHourV2', day: 'performanceTelemetryDayV2',
  receipts: 'performanceTelemetryReceiptsV2', sessions: 'performanceTelemetrySessionsV2',
  rate: 'performanceTelemetryRateV2', control: 'performanceTelemetryControlV2', audit: 'performanceTelemetryAuditV2',
});
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function moduleFromPath(path) {
  if (typeof path !== 'string') return 'erp';
  const segments = path.split(/[?#]/)[0].split('/').filter(Boolean);
  const first = segments[0] || 'dashboard';
  if (first === 'settings' && segments.includes('performance')) return 'performance';
  return MODULES.has(first) ? first : 'erp';
}
function normalizeMeasurement(input) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(UNITS, input.name)) return null;
  if (input.unit !== UNITS[input.name] || !MODULES.has(input.module)) return null;
  if (typeof input.value !== 'number' || !Number.isFinite(input.value) || input.value < 0 || input.value > 600000) return null;
  if (!Number.isSafeInteger(input.observedAtMs) || input.observedAtMs <= 0) return null;
  // No raw route, URL, document ID, text, stack, IP, user name or request body survives.
  return { name: input.name, module: input.module, unit: input.unit, value: input.value, observedAtMs: input.observedAtMs, error: input.error === true };
}
function normalizeBatch(input, environment) {
  if (!input || input.version !== VERSION || input.environment !== environment) fail('invalid_request', 'Telemetry environment or schema does not match.');
  const validId = (id) => typeof id === 'string' && /^[a-zA-Z0-9_-]{16,96}$/.test(id);
  if (!validId(input.batchId) || !validId(input.sessionId)) fail('invalid_request', 'Invalid telemetry batch identity.');
  if (typeof input.release !== 'string' || !/^[a-f0-9]{40}$/.test(input.release)) fail('invalid_request', 'A full build revision is required.');
  if (!Array.isArray(input.measurements) || !input.measurements.length || input.measurements.length > MAX_BATCH) fail('invalid_request', 'Invalid telemetry batch size.');
  const measurements = input.measurements.map(normalizeMeasurement);
  if (measurements.some((item) => !item)) fail('invalid_request', 'An unsupported measurement was supplied.');
  return { version: VERSION, environment, batchId: input.batchId, sessionId: input.sessionId, release: input.release, visible: input.visible === true, module: MODULES.has(input.module) ? input.module : 'erp', measurements };
}
function emptyMetric(name, module, release, unit) {
  return { name, module, release, unit, count: 0, sum: 0, errors: 0, histogram: {}, lastObservedAtMs: 0 };
}
function addSample(metric, sample) {
  metric.count += 1; metric.sum += sample.value; metric.errors += sample.error ? 1 : 0;
  metric.lastObservedAtMs = Math.max(metric.lastObservedAtMs, sample.observedAtMs);
  if (sample.unit === 'ms') {
    const edge = BOUNDS.find((value) => sample.value <= value);
    if (edge === undefined) fail('invalid_request', 'Latency exceeds the supported range.');
    const key = `le_${edge}`;
    metric.histogram[key] = (metric.histogram[key] || 0) + 1;
  }
}
function metricKey(metric) { return `${metric.module}__${metric.name}__${metric.unit}__${metric.release}`; }
function addMetric(target, source) {
  if (target.name !== source.name || target.module !== source.module || target.unit !== source.unit) fail('invalid_request', 'Unlike measurements cannot be pooled.');
  target.count += source.count; target.sum += source.sum; target.errors += source.errors;
  target.lastObservedAtMs = Math.max(target.lastObservedAtMs, source.lastObservedAtMs || 0);
  for (const [key, count] of Object.entries(source.histogram || {})) target.histogram[key] = (target.histogram[key] || 0) + count;
  return target;
}
function percentile(histogram, quantile) {
  const total = Object.values(histogram || {}).reduce((sum, value) => sum + value, 0);
  if (!total) return null;
  const rank = Math.max(1, Math.ceil(total * quantile));
  let cumulative = 0;
  for (const edge of BOUNDS) { cumulative += histogram[`le_${edge}`] || 0; if (cumulative >= rank) return edge; }
  return null;
}
function serialize(metric) {
  return { ...metric, average: metric.count ? metric.sum / metric.count : null,
    errorRate: metric.count ? 100 * metric.errors / metric.count : null,
    p50: percentile(metric.histogram, 0.5), p95: percentile(metric.histogram, 0.95), p99: percentile(metric.histogram, 0.99),
    percentileMethod: 'histogram-upper-bound', lowSample: metric.count < 20 };
}
function aggregate(measurements, release) {
  const result = {};
  for (const sample of measurements) {
    const metric = emptyMetric(sample.name, sample.module, release, sample.unit);
    const key = metricKey(metric); result[key] ||= metric; addSample(result[key], sample);
  }
  return result;
}
function pool(metrics) {
  const result = new Map();
  for (const source of metrics) {
    const key = `${source.module}__${source.name}__${source.unit}`;
    if (!result.has(key)) result.set(key, emptyMetric(source.name, source.module, 'all', source.unit));
    addMetric(result.get(key), source);
  }
  return [...result.values()].map(serialize);
}
function health(metrics, now, unavailable = false) {
  if (unavailable) return { status: 'unavailable', label: 'Unavailable' };
  const relevant = metrics.filter((m) => m.module !== 'performance');
  if (!relevant.length) return { status: 'collecting', label: 'Collecting' };
  const last = Math.max(...relevant.map((m) => m.lastObservedAtMs || 0));
  if (now - last > STALE_MS) return { status: 'stale', label: 'Stale' };
  const evidence = relevant.filter((m) => PRIMARY_METRICS.has(m.name) && m.count >= 20 && now - m.lastObservedAtMs <= STALE_MS);
  if (!evidence.length) return { status: 'collecting', label: 'Insufficient samples' };
  const errors = relevant.some((m) => ['browser_error','unhandled_rejection','schedule_load_error'].includes(m.name) && m.sum > 0);
  if (errors || evidence.some((m) => m.errorRate > 2 || m.p95 > (THRESHOLDS[m.name] || 3000))) return { status: 'warning', label: 'Needs attention' };
  return { status: 'healthy', label: 'Measured workflows healthy' };
}
function windowSpec(rangeMinutes, now) {
  const allowed = [60,360,1440,10080,43200];
  const minutes = allowed.includes(Number(rangeMinutes)) ? Number(rangeMinutes) : 60;
  const size = minutes <= 360 ? 900000 : minutes <= 10080 ? 3600000 : 86400000;
  const collection = size === 900000 ? COLLECTIONS.quarter : size === 3600000 ? COLLECTIONS.hour : COLLECTIONS.day;
  return { rangeMinutes: minutes, size, collection, from: Math.floor((now - minutes * 60000) / size) * size, to: now };
}
module.exports = { VERSION, MAX_BATCH, MAX_AGE_MS, STALE_MS, BOUNDS, UNITS, MODULES, PRIMARY_METRICS, THRESHOLDS, COLLECTIONS, fail, moduleFromPath, normalizeMeasurement, normalizeBatch, emptyMetric, addSample, metricKey, addMetric, percentile, serialize, aggregate, pool, health, windowSpec };
