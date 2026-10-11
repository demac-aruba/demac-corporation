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
  }));
  // The first diagnostic proved Logs access is denied. Do not change IAM or retry it.
  console.log(JSON.stringify({ logs: 'blocked-by-existing-permissions', sourceRun: 38098705455 }));
  const token = execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const metric of ['container/memory/utilizations', 'container/instance_count']) {
    const url = new URL('https://monitoring.googleapis.com/v3/projects/demac-corporation/timeSeries');
    url.search = new URLSearchParams({
      filter: `metric.type="run.googleapis.com/${metric}" AND resource.labels.service_name="officebookingauthority"`,
      'interval.startTime': new Date(Date.now() - 3 * 3600_000).toISOString(),
      'interval.endTime': new Date().toISOString(), pageSize: '100',
    });
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) {
      console.log(JSON.stringify({ metric, status: response.status, unavailable: true }));
      break;
    }
    const result = await response.json();
    console.log(JSON.stringify({ metric, series: (result.timeSeries || []).map(series => ({
      revision: series.resource?.labels?.revision_name,
      points: series.points?.map(point => ({
        time: point.interval?.endTime,
        number: Number(point.value?.doubleValue ?? point.value?.int64Value),
        count: Number(point.value?.distributionValue?.count),
        mean: Number(point.value?.distributionValue?.mean),
        max: Number(point.value?.distributionValue?.range?.max),
      })),
    })) }));
  }
  process.exitCode = 1; // The required runtime-log evidence remains unavailable.
}
if (require.main === module) {
  main().catch(() => { console.error('Read-only Booking runtime audit failed; no raw provider output emitted.'); process.exitCode = 1; });
}
module.exports = { classify };
