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

function main() {
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
  const filter = 'resource.type="cloud_run_revision" AND resource.labels.service_name="officebookingauthority"';
  for (const extra of [' AND severity>=ERROR', ' AND logName:"run.googleapis.com%2Fvarlog%2Fsystem"']) {
    const entries = read(['logging', 'read', filter + extra, '--project=demac-corporation', '--freshness=3h', '--limit=80', '--format=json']);
    console.log(JSON.stringify({ logCategory: extra.includes('ERROR') ? 'errors' : 'system', entries: entries.map(classify) }));
  }
}
if (require.main === module) {
  try { main(); } catch { console.error('Read-only Booking runtime audit failed; no raw provider output emitted.'); process.exitCode = 1; }
}
module.exports = { classify };
