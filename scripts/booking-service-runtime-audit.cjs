// Incident diagnostics only: no customer reads, auth tokens, raw payloads or writes.
const { execFileSync } = require('node:child_process');

function read(args) {
  return JSON.parse(execFileSync('gcloud', args, {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 8 * 1024 * 1024,
  }));
}

function classify(entry) {
  const message = String(entry.textPayload || entry.jsonPayload?.message || '');
  const patterns = {
    memoryLimit: /memory limit|out of memory|heap out of memory|OOMKilled/i,
    startupProbe: /startup.*probe|failed to start.*listen|container failed to start/i,
    moduleMissing: /Cannot find module|MODULE_NOT_FOUND/i,
    syntaxError: /SyntaxError/,
    typeError: /TypeError/,
    referenceError: /ReferenceError/,
    noInstance: /no available instance|maximum.*instance|instance.*limit/i,
    permissionDenied: /permission.denied|PERMISSION_DENIED/i,
    containerExit: /container called exit|terminated|exit code/i,
    startingInstance: /Starting new instance/i,
    probePassed: /probe succeeded/i,
  };
  return {
    timestamp: entry.timestamp,
    severity: entry.severity,
    revision: entry.resource?.labels?.revision_name,
    status: entry.httpRequest?.status,
    latency: entry.httpRequest?.latency,
    classes: Object.entries(patterns).filter(([, pattern]) => pattern.test(message)).map(([name]) => name),
    // Only numeric resource quantities from the known platform memory-limit diagnostic.
    memory: /Memory limit of ([\d.]+\s*\w+) exceeded with ([\d.]+\s*\w+) used/i.exec(message)?.slice(1),
  };
}

async function inspectScalingOnly() {
  const service = read(['run', 'services', 'describe', 'officebookingauthority', '--project=demac-corporation', '--region=us-central1', '--format=json']);
  const select = annotations => Object.fromEntries([
    'run.googleapis.com/minScale', 'run.googleapis.com/maxScale',
    'run.googleapis.com/manualInstanceCount', 'run.googleapis.com/scalingMode',
    'autoscaling.knative.dev/minScale', 'autoscaling.knative.dev/maxScale',
  ].filter(key => annotations?.[key] != null).map(key => [key, String(annotations[key]).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40)]));
  console.log(JSON.stringify({
    scalingAudit: 'v1', service: select(service.metadata?.annotations),
    revision: select(service.spec?.template?.metadata?.annotations),
    concurrency: service.spec?.template?.spec?.containerConcurrency,
  }));
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const response = await fetch('https://run.googleapis.com/v2/projects/demac-corporation/locations/us-central1/services/officebookingauthority', {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) { console.log(JSON.stringify({ scalingAudit: 'v2', status: response.status })); process.exitCode = 1; return; }
  const result = await response.json();
  const scaling = value => ({
    min: value?.minInstanceCount, max: value?.maxInstanceCount,
    manual: value?.manualInstanceCount,
    mode: ['AUTOMATIC', 'MANUAL', 'SCALING_MODE_UNSPECIFIED'].includes(value?.scalingMode) ? value.scalingMode : undefined,
  });
  console.log(JSON.stringify({
    scalingAudit: 'v2', service: scaling(result.scaling), revision: scaling(result.template?.scaling),
    reconciling: result.reconciling, generation: result.generation, observedGeneration: result.observedGeneration,
    condition: { state: result.terminalCondition?.state, reason: result.terminalCondition?.reason, revisionReason: result.terminalCondition?.revisionReason },
  }));
  process.exitCode = 1; // A configuration read does not establish incident recovery.
}

async function main() {
  // A second network vantage point distinguishes a platform failure from local egress.
  for (const name of ['officeBookingAuthority', 'projectAuthority', 'fieldOperationsAuthority', 'bookingVisitReferences']) {
    const endpoint = `https://us-central1-demac-corporation.cloudfunctions.net/${name}`;
    try {
      const response = await fetch(endpoint, {
        method: 'OPTIONS', signal: AbortSignal.timeout(25_000),
        headers: { Origin: 'https://demac-aruba.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
      });
      console.log(JSON.stringify({ probe: name, status: response.status, cors: response.headers.get('access-control-allow-origin') }));
    } catch {
      console.log(JSON.stringify({ probe: name, transportFailure: true }));
    }
  }
  const common = ['--project=demac-corporation', '--region=us-central1', '--format=json'];
  const fn = read(['functions', 'describe', 'officeBookingAuthority', '--gen2', ...common]);
  const service = read(['run', 'services', 'describe', 'officebookingauthority', ...common]);
  const cfg = fn.serviceConfig;
  console.log(JSON.stringify({
    readOnly: true, state: fn.state, updateTime: fn.updateTime,
    revision: cfg.revision, runtime: fn.buildConfig.runtime,
    memory: cfg.availableMemory, cpu: cfg.availableCpu,
    minInstances: cfg.minInstanceCount, maxInstances: cfg.maxInstanceCount,
    concurrency: cfg.maxInstanceRequestConcurrency, ingress: cfg.ingressSettings,
    conditions: service.status?.conditions?.map(({ type, status, reason }) => ({ type, status, reason })),
    latestReady: service.status?.latestReadyRevisionName,
    traffic: service.status?.traffic?.map(({ revisionName, percent }) => ({ revisionName, percent })),
    scalingMode: service.metadata?.annotations?.['run.googleapis.com/scalingMode'],
    manualInstances: Number(service.metadata?.annotations?.['run.googleapis.com/manualInstanceCount']),
  }));
  try {
    const billing = read(['billing', 'projects', 'describe', 'demac-corporation', '--format=json']);
    console.log(JSON.stringify({ billingEnabled: billing.billingEnabled === true }));
  } catch { console.log(JSON.stringify({ billingStatus: 'unavailable-with-existing-access' })); }
  // The first diagnostic proved Logs access is denied. Do not change IAM or retry it.
  console.log(JSON.stringify({ logs: 'blocked-by-existing-permissions', sourceRun: 38098705455 }));
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const quotaResponse = await fetch('https://serviceusage.googleapis.com/v1beta1/projects/demac-corporation/services/run.googleapis.com/consumerQuotaMetrics?view=FULL&pageSize=200', {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
  });
  if (!quotaResponse.ok) console.log(JSON.stringify({ effectiveQuotaRead: quotaResponse.status }));
  else {
    const quotas = await quotaResponse.json();
    console.log(JSON.stringify({ effectiveQuotaRead: quotaResponse.status, morePages: Boolean(quotas.nextPageToken), metrics: (quotas.metrics || []).filter(metric => metric.metric === 'run.googleapis.com/instances').map(metric => ({
      metric: metric.metric, displayName: metric.displayName,
      limits: (metric.consumerQuotaLimits || []).map(limit => ({
        unit: limit.unit,
        buckets: (limit.quotaBuckets || []).map(bucket => ({
          region: bucket.dimensions?.region, effective: Number(bucket.effectiveLimit), default: Number(bucket.defaultLimit),
          consumerOverride: Boolean(bucket.consumerOverride), adminOverride: Boolean(bucket.adminOverride), producerOverride: Boolean(bucket.producerOverride),
        })),
      })),
    })) }));
  }
  for (const metric of ['container/memory/utilizations', 'container/instance_count', 'request_count']) {
    const url = new URL('https://monitoring.googleapis.com/v3/projects/demac-corporation/timeSeries');
    url.search = new URLSearchParams({
      filter: `metric.type="run.googleapis.com/${metric}" AND resource.labels.service_name="officebookingauthority" AND resource.labels.revision_name="${cfg.revision}"`,
      'interval.startTime': new Date(Date.now() - 3 * 3600_000).toISOString(),
      'interval.endTime': new Date().toISOString(), pageSize: '1000',
    });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      console.log(JSON.stringify({ metric, status: response.status, unavailable: true }));
      break;
    }
    const result = await response.json();
    console.log(JSON.stringify({ metric, morePages: Boolean(result.nextPageToken), series: (result.timeSeries || []).map(series => ({
      revision: series.resource?.labels?.revision_name,
      responseCode: Number(series.metric?.labels?.response_code),
      state: ['active', 'idle'].includes(series.metric?.labels?.state) ? series.metric.labels.state : undefined,
      points: series.points?.map(point => ({
        time: point.interval?.endTime,
        number: Number(point.value?.doubleValue ?? point.value?.int64Value),
        count: Number(point.value?.distributionValue?.count),
        mean: Number(point.value?.distributionValue?.mean),
        max: Number(point.value?.distributionValue?.range?.max),
      })),
    })) }));
  }
  for (const metric of ['allocation/usage', 'limit', 'exceeded']) {
    const url = new URL('https://monitoring.googleapis.com/v3/projects/demac-corporation/timeSeries');
    url.search = new URLSearchParams({
      filter: `metric.type="serviceruntime.googleapis.com/quota/${metric}" AND resource.labels.service="run.googleapis.com" AND resource.labels.location="us-central1"`,
      'interval.startTime': new Date(Date.now() - 3600_000).toISOString(),
      'interval.endTime': new Date().toISOString(), pageSize: '1000',
    });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) { console.log(JSON.stringify({ quotaMetric: metric, status: response.status })); break; }
    const result = await response.json();
    console.log(JSON.stringify({ quotaMetric: metric, morePages: Boolean(result.nextPageToken), series: (result.timeSeries || []).map(series => ({
      quota: series.metric?.labels?.quota_metric,
      limit: series.metric?.labels?.limit_name,
      latest: series.points?.slice(0, 2).map(point => ({ time: point.interval?.endTime, number: Number(point.value?.int64Value ?? point.value?.doubleValue), exceeded: point.value?.boolValue === true })),
      max: Math.max(...(series.points || []).map(point => Number(point.value?.int64Value ?? point.value?.doubleValue) || 0)),
    })) }));
  }
  process.exitCode = 1; // The required runtime-log evidence remains unavailable.
}
if (require.main === module) {
  (process.argv.includes('--scaling-only') ? inspectScalingOnly() : main()).catch(() => { console.error('Read-only Booking runtime audit failed; no raw provider output emitted.'); process.exitCode = 1; });
}
module.exports = { classify };
