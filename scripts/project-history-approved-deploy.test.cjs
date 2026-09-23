const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, 'project-history-approved-deploy.cjs'), 'utf8');
const officeName = 'projects/demac-corporation/locations/us-central1/functions/officeBookingAuthority';
const projectName = officeName.replace(/officeBookingAuthority$/, 'projectAuthority');
async function simulate({ inventory = [{ name: officeName }], listError, foreignProject = false } = {}) {
  const deployments = []; let evidence;
  const process = { env: { GITHUB_REPOSITORY: 'demac-aruba/demac-corporation', GITHUB_REF: 'refs/heads/release/project-historical-bookings', GITHUB_SHA: 'test', RUNNER_TEMP: '/test' } };
  const description = name => JSON.stringify({ name: name === 'officeBookingAuthority' ? officeName : projectName, state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: name, source: { storageSource: { bucket: 'test', object: name } } }, serviceConfig: { serviceAccountEmail: 'test@example.invalid', revision: 'test' } });
  const execFileSync = (command, args) => {
    if (command === 'gcloud') {
      if (args[0] === 'functions' && args[1] === 'describe') return description(args[2]);
      if (args[0] === 'functions' && args[1] === 'list') { if (listError) throw Error('permission denied'); return JSON.stringify(inventory); }
      if (args[0] === 'functions' && args[1] === 'deploy') { deployments.push(args[2]); return 'ACTIVE'; }
      if (args[0] === 'storage') return '';
    }
    if (command === 'unzip') return foreignProject && args[1].includes('current-project-source') ? 'foreign' : 'source';
    if (command === 'git' && args[0] === 'show') return 'source';
    if (command === 'git' || command === 'tar') return '';
    throw Error('Unexpected command');
  };
  const mocks = { 'node:child_process': { execFileSync }, 'node:fs': { readFileSync: () => 'source', mkdirSync() {}, writeFileSync(_file, value) { evidence = JSON.parse(value); } } };
  await vm.runInNewContext(script, { require: name => mocks[name] || require(name), process, fetch: async () => ({ status: 401 }), console: { log() {}, error() {} } });
  return { deployments, evidence, exitCode: process.exitCode };
}
test('verified absence creates the two authorized functions and checks authentication', async () => {
  const result = await simulate();
  assert.deepEqual(result.deployments, ['officeBookingAuthority', 'projectAuthority']);
  assert.equal(result.evidence.stage, 'complete');
  assert.equal(result.evidence.functions.length, 2);
  assert.equal(result.exitCode, undefined);
});
test('permission failure cannot be treated as a missing Project function', async () => {
  const result = await simulate({ listError: true });
  assert.equal(result.exitCode, 1); assert.deepEqual(result.deployments, []);
});
test('empty or wrong-project inventory cannot authorize a deployment', async () => {
  for (const inventory of [[], [{ name: projectName }], {}]) {
    const result = await simulate({ inventory });
    assert.equal(result.exitCode, 1); assert.deepEqual(result.deployments, []);
  }
});
test('an existing Project function from another release cannot be overwritten', async () => {
  const result = await simulate({ inventory: [{ name: officeName }, { name: projectName }], foreignProject: true });
  assert.equal(result.exitCode, 1); assert.deepEqual(result.deployments, []);
});
