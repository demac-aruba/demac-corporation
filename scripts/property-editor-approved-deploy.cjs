// One approved release branch only. Credentials/configuration never enter artifacts or logs.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const project = 'demac-corporation';
const names = ['officeBookingAuthority', 'fieldOperationsAuthority', 'processCustomerAgentInbound', 'processCustomerAgentReactivation'];
if (process.env.GITHUB_REPOSITORY !== 'demac-aruba/demac-corporation' || process.env.GITHUB_REF !== 'refs/heads/release/property-editor-approved') throw new Error('Release context mismatch');
const run = (args) => execFileSync('gcloud', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20 * 1024 * 1024 });
const describe = name => JSON.parse(run(['functions', 'describe', name, '--project=' + project, '--region=us-central1', '--gen2', '--format=json']));
const stable = config => Object.fromEntries(Object.entries(config || {}).filter(([key]) => !['revision', 'uri', 'service'].includes(key)));
const config = fn => ({ service: stable(fn.serviceConfig), trigger: fn.eventTrigger || null, runtime: fn.buildConfig.runtime, entryPoint: fn.buildConfig.entryPoint });
const result = { sourceSha: process.env.GITHUB_SHA, project, functions: [] };
const destination = path.join(process.env.RUNNER_TEMP, 'property-editor-release-result.json');
const record = () => fs.writeFileSync(destination, JSON.stringify(result, null, 2));
async function checkHttp(name) {
  const url = 'https://us-central1-' + project + '.cloudfunctions.net/' + name;
  for (const origin of ['https://demac-corporation-web.vercel.app', 'https://demac-corporation.vercel.app']) {
    const response = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' } });
    assert.equal(response.status, 204, name + ' CORS');
    // Preserve each existing API's actual contract: Office uses bearer tokens with
    // wildcard CORS; Field reflects the requesting origin. Neither uses cookies.
    assert.equal(response.headers.get('access-control-allow-origin'), name === 'officeBookingAuthority' ? '*' : origin, name + ' allowed origin');
    assert.match(response.headers.get('access-control-allow-headers') || '', /authorization/i);
    assert.match(response.headers.get('access-control-allow-methods') || '', /POST/);
  }
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name === 'officeBookingAuthority' ? 'list_property_locations' : 'list_jobs', data: {} }) });
  assert.equal(response.status, 401, name + ' must require authentication');
}
(async () => {
  // Fail before any deploy if a consumer is missing or has an unexpected runtime.
  const before = Object.fromEntries(names.map(name => [name, describe(name)]));
  for (const name of names) {
    assert.equal(before[name].state, 'ACTIVE');
    assert.equal(before[name].buildConfig.runtime, 'nodejs22');
    assert.equal(before[name].buildConfig.entryPoint, name);
    assert.ok(before[name].serviceConfig.serviceAccountEmail);
  }
  const stage = path.join(process.env.RUNNER_TEMP, 'property-editor-function-source');
  fs.mkdirSync(stage);
  const archive = path.join(process.env.RUNNER_TEMP, 'property-editor-function-source.tar');
  execFileSync('git', ['archive', '--format=tar', '--output=' + archive, 'HEAD:functions']);
  execFileSync('tar', ['-xf', archive, '-C', stage]);
  for (const name of names) {
    console.log('Updating source for ' + name);
    const previous = before[name];
    const entry = { name, previousRevision: previous.serviceConfig.revision, previousSource: previous.buildConfig.source, verified: false };
    result.functions.push(entry); record();
    run(['functions', 'deploy', name, '--project=' + project, '--region=us-central1', '--gen2', '--source=' + stage,
      '--entry-point=' + name, '--runtime=' + previous.buildConfig.runtime,
      '--run-service-account=' + previous.serviceConfig.serviceAccountEmail, '--quiet', '--format=value(state)']);
    const after = describe(name);
    assert.equal(after.state, 'ACTIVE');
    assert.deepEqual(config(after), config(previous), name + ' configuration changed unexpectedly');
    Object.assign(entry, { state: after.state, revision: after.serviceConfig.revision, source: after.buildConfig.source, configurationPreserved: true });
    record();
    if (!previous.eventTrigger) await checkHttp(name);
    entry.verified = true;
    record();
    console.log(name + ': ACTIVE, configuration preserved, verification passed');
  }
})().catch(error => {
  // Do not print gcloud stdout/stderr or private configuration from assert diffs.
  result.error = error.code === 'ERR_ASSERTION' ? error.message.split('\n')[0] : 'Deployment command failed; inspect the Cloud Build for this function.';
  record();
  console.error(result.error);
  process.exitCode = 1;
});
