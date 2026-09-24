const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const script = fs.readFileSync(path.join(__dirname, 'project-history-approved-deploy.cjs'), 'utf8');
const mainSha = '38542864b07ef18b32542ff08118fe9eea1526aa';
const releaseSha = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const advancedMain = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const officeName = 'projects/demac-corporation/locations/us-central1/functions/officeBookingAuthority';
const projectName = officeName.replace(/officeBookingAuthority$/, 'projectAuthority');

async function simulate({ officeSource = 'prior', projectSource = 'prior', inventory = [{ name: officeName }, { name: projectName }],
  listError = false, mainAdvanced = false, releaseAdvanced = false, sourceTreeDrift = false,
  officeRevisionDrift = false } = {}) {
  const deployments = []; let evidence; let mainLookups = 0; let officeDescribes = 0;
  const process = { env: { GITHUB_REPOSITORY: 'demac-aruba/demac-corporation',
    GITHUB_REF: 'refs/heads/release/project-historical-bookings', GITHUB_SHA: releaseSha, RUNNER_TEMP: '/test' } };
  const description = name => {
    if (name === 'officeBookingAuthority') officeDescribes += 1;
    return JSON.stringify({ name: name === 'officeBookingAuthority' ? officeName : projectName,
      state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: name,
        source: { storageSource: { bucket: 'test', object: name } } },
      serviceConfig: { serviceAccountEmail: 'test@example.invalid', revision:
        officeRevisionDrift && name === 'officeBookingAuthority' && officeDescribes > 1 ? 'other-revision' : 'approved-revision' } });
  };
  const source = (kind, file) => {
    if (kind === 'prior' && ['bookingProjectHistoricalCapacity.js', 'projectCommercialGuard.js'].includes(file)) throw Error('Not in prior source');
    return `${kind}-${file}`;
  };
  const execFileSync = (command, args) => {
    if (command === 'gcloud') {
      if (args[0] === 'functions' && args[1] === 'describe') return description(args[2]);
      if (args[0] === 'functions' && args[1] === 'list') {
        if (listError) throw Error('permission denied');
        return JSON.stringify(inventory);
      }
      if (args[0] === 'functions' && args[1] === 'deploy') { deployments.push(args[2]); return 'ACTIVE'; }
      if (args[0] === 'storage') return '';
    }
    if (command === 'unzip') return source(args[1].includes('officeBookingAuthority') ? officeSource : projectSource, args[2]);
    if (command === 'git') {
      if (args[0] === 'ls-remote') {
        const ref = args[2];
        if (ref === 'refs/heads/main') mainLookups += 1;
        const sha = ref === 'refs/heads/main' ? mainAdvanced && mainLookups > 1 ? advancedMain : mainSha
          : releaseAdvanced ? advancedMain : releaseSha;
        return `${sha}\t${ref}\n`;
      }
      if (args[0] === 'rev-parse') {
        if (args[1] === 'HEAD') return releaseSha;
        const [sha, item] = args[1].split(':');
        return sourceTreeDrift && sha === releaseSha && item === 'functions' ? `drift-${item}` : `same-${item}`;
      }
      if (args[0] === 'merge-base') return '';
      if (args[0] === 'show') return source('prior', args[1].split('/').at(-1));
      if (args[0] === 'archive') return '';
    }
    if (command === 'tar') return '';
    throw Error(`Unexpected command: ${command} ${args.join(' ')}`);
  };
  const mocks = { 'node:child_process': { execFileSync }, 'node:fs': {
    readFileSync: file => source('candidate', path.basename(file)), mkdirSync() {},
    writeFileSync(_file, value) { evidence = JSON.parse(value); },
  } };
  await vm.runInNewContext(script, { require: name => mocks[name] || require(name), process,
    fetch: async () => ({ status: 401 }), console: { log() {}, error() {} } });
  return { deployments, evidence, exitCode: process.exitCode };
}

test('exact main source and approved deployed sources allow bounded Office and Project release', async () => {
  const result = await simulate();
  assert.deepEqual(result.deployments, ['officeBookingAuthority', 'projectAuthority']);
  assert.equal(result.evidence.stage, 'complete');
  assert.equal(result.evidence.expectedMainSha, mainSha);
  assert.equal(result.evidence.functions.length, 2);
  assert.equal(result.exitCode, undefined);
});
test('an already deployed candidate is an idempotent approved source', async () => {
  const result = await simulate({ officeSource: 'candidate', projectSource: 'candidate' });
  assert.equal(result.exitCode, undefined);
  assert.equal(result.evidence.officeSource.alreadyCandidate, true);
  assert.equal(result.evidence.projectSource.alreadyCandidate, true);
});
test('remote release or main drift and release-only Function changes stop before deployment', async () => {
  for (const options of [{ releaseAdvanced: true }, { mainAdvanced: true }, { sourceTreeDrift: true }]) {
    const result = await simulate(options);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.deployments, []);
  }
});
test('unapproved Office or Project source stops before any deployment', async () => {
  for (const options of [{ officeSource: 'foreign' }, { projectSource: 'foreign' }]) {
    const result = await simulate(options);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.deployments, []);
  }
});
test('missing Project, malformed inventory, or permission failure cannot authorize deployment', async () => {
  for (const options of [{ inventory: [{ name: officeName }] }, { inventory: {} }, { listError: true }]) {
    const result = await simulate(options);
    assert.equal(result.exitCode, 1);
    assert.deepEqual(result.deployments, []);
  }
});
test('an independent Office deployment detected after preflight stops before overwrite', async () => {
  const result = await simulate({ officeRevisionDrift: true });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.deployments, []);
});
