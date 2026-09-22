const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const run = args => JSON.parse(execFileSync('gcloud', args.concat(['--project=demac-corporation', '--region=us-central1', '--format=json']), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revision = name => {
  const value = run(['run', 'revisions', 'describe', name]);
  const spec = value.spec;
  return { ...spec, containers: spec.containers.map(container => ({ ...container, image: '(versioned source)', env: (container.env || []).map(item => ({ name: item.name, valueHash: digest(item.value ?? item.valueFrom) })).sort((a, b) => a.name.localeCompare(b.name)) })) };
};
const result = { checkedAt: new Date().toISOString(), functions: [] };
for (const name of ['processCustomerAgentInbound', 'processCustomerAgentReactivation']) {
  const fn = run(['functions', 'describe', name, '--gen2']);
  const { environmentVariables, secretEnvironmentVariables, ...service } = fn.serviceConfig;
  result.functions.push({ name, state: fn.state, service, environmentKeys: Object.keys(environmentVariables || {}).sort(), secretEnvironmentKeys: (secretEnvironmentVariables || []).map(value => value.key), eventTrigger: fn.eventTrigger, source: fn.buildConfig.source });
}
result.inboundPrevious = revision('processcustomeragentinbound-00052-jop');
result.inboundCurrent = revision(result.functions[0].service.revision);
fs.writeFileSync(path.join(process.env.RUNNER_TEMP, 'property-editor-configuration-inspection.json'), JSON.stringify(result, null, 2));
console.log('Read-only configuration and revision inspection complete; environment values hashed.');
