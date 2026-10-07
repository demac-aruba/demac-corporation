const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'booking-references-corrective-deploy.cjs'), 'utf8');
const reviewed = 'a54e836ba33b8388b377d911f180783852659152';
const selected = ['officeBookingAuthority', 'queueAppointmentConfirmation'];
const changedRoots = { officeBookingAuthority: 'officeBookingAuthorityFacade.js', queueAppointmentConfirmation: 'appointmentNotifications.js' };

async function simulate(options = {}) {
  const commands = [], errors = [], summaries = [], deployed = new Set();
  const sha = 'a'.repeat(40), main = 'b'.repeat(40);
  const context = { AbortSignal, URL, process: { env: {
    GITHUB_REPOSITORY: options.wrongRepository ? 'other/repo' : 'demac-aruba/demac-corporation',
    GITHUB_REF: options.wrongBranch ? 'refs/heads/main' : 'refs/heads/release/booking-references-correction-20261007',
    GITHUB_SHA: sha, RUNNER_TEMP: '/isolated-test' } },
    console: { log() {}, error: message => errors.push(message) },
    fetch: async (url, args) => {
      assert.match(url, /^https:\/\/us-central1-demac-corporation.cloudfunctions.net\/(officeBookingAuthority|bookingVisitReferences)$/);
      assert.ok(['https://demac-aruba.com', 'https://www.demac-aruba.com'].includes(args.headers.Origin));
      assert.equal(args.headers.Authorization, undefined);
      if (args.method === 'POST') assert.equal(args.body, '{}');
      else assert.equal(args.method, 'OPTIONS');
      return { status: args.method === 'OPTIONS' ? 204 : 401, headers: { get: () => args.headers.Origin } };
    },
    require: name => {
      if (name === 'node:fs') return { mkdirSync() {}, existsSync: () => true, unlinkSync() {},
        writeFileSync: (file, body) => { if (file.endsWith('/package-lock.json')) return; assert.ok(file.endsWith('/summary.json')); summaries.push(JSON.parse(body)); } };
      if (name === 'node:child_process') return { execFileSync: (binary, args) => {
        commands.push({ binary, args });
        if (binary === 'git') {
          if (args[0] === 'ls-remote') return `${args[2] === 'refs/heads/main' ? main : sha}\t${args[2]}\n`;
          if (args[0] === 'archive') { assert.ok(args.includes(reviewed + ':functions')); return ''; }
          if (args[0] === 'show') {
            const [ref, file] = args[1].split(':functions/');
            if (file === 'package.json') return JSON.stringify({ dependencies: { 'synthetic-module': '1.0.0' } });
            const changed = Object.values(changedRoots).includes(file);
            return `${changed && ref === reviewed ? 'corrected' : 'previous'}:${file}`;
          }
          if (args[1] === 'HEAD') return sha;
          if (options.mainChanged && args[1].startsWith(main + ':')) return 'unreviewed';
          if (options.releaseChanged && args[1].startsWith('HEAD:')) return 'unreviewed';
          return args[1].split(':').pop() + '-reviewed-tree';
        }
        if (binary === 'gcloud') {
          assert.ok(args.includes('--project=demac-corporation') || args[0] === 'storage');
          if (args[0] === 'scheduler') { assert.equal(args[2], 'describe'); return JSON.stringify({
            schedule: options.schedulerChanged && deployed.size ? '0 9 * * *' : '0,5,10 8 * * *', timeZone: 'America/Aruba', state: 'ENABLED' }); }
          if (args[0] === 'storage') { assert.equal(args[1], 'cp'); return ''; }
          assert.equal(args[0], 'functions');
          const name = args[2];
          if (args[1] === 'deploy') {
            assert.ok(selected.includes(name), 'No other function may be deployed');
            assert.ok(args.includes('--run-service-account=synthetic-runtime'));
            assert.ok(args.includes('--source=/isolated-test/booking-reference-correction-source'));
            deployed.add(name); return 'ACTIVE';
          }
          assert.equal(args[1], 'describe');
          return JSON.stringify({ state: 'ACTIVE', buildConfig: { runtime: 'nodejs22', entryPoint: name,
            source: { storageSource: { bucket: 'synthetic', object: name } } },
            serviceConfig: { revision: name + (deployed.has(name) ? '-new' : '-old'), serviceAccountEmail: 'synthetic-runtime',
              availableMemory: options.configChanged && deployed.has(name) ? 'changed' : '256Mi' } });
        }
        if (binary === 'unzip') {
          const name = path.basename(args[1], '.zip'), file = args[2];
          if (file === 'package-lock.json') return JSON.stringify({ packages: { '': { dependencies: { 'synthetic-module': '1.0.0' } } } });
          if (file === 'package.json') return JSON.stringify({ dependencies: { 'synthetic-module': '1.0.0' } });
          if (name === options.unknownSource) return 'unexpected-source';
          return `${deployed.has(name) && changedRoots[name] === file ? 'corrected' : 'previous'}:${file}`;
        }
        assert.equal(binary, 'tar'); return '';
      } };
      if (name === './booking-references-release-config.cjs') return require('./booking-references-release-config.cjs');
      return require(name);
    } };
  vm.runInNewContext(source, context);
  await new Promise(resolve => setImmediate(resolve));
  return { commands, errors, summaries, deployed: [...deployed], code: context.process.exitCode };
}
for (const option of ['wrongRepository', 'wrongBranch', 'mainChanged', 'releaseChanged']) {
  test(`${option} blocks every cloud operation`, async () => {
    const result = await simulate({ [option]: true });
    assert.equal(result.code, 1); assert.ok(result.errors.length);
    assert.equal(result.commands.some(command => command.binary === 'gcloud'), false);
  });
}
test('unknown deployed source anywhere in the nine-function surface blocks all writes', async () => {
  for (const name of ['officeBookingAuthority', 'queueAppointmentConfirmation', 'wacliOutboundAck']) {
    const result = await simulate({ unknownSource: name });
    assert.equal(result.code, 1); assert.deepEqual(result.deployed, []); assert.match(result.errors[0], /unknown live source/);
  }
});
test('approved correction deploys exactly two functions and verifies preserved runtime/scheduler', async () => {
  const result = await simulate();
  assert.equal(result.code, undefined, result.errors.join('\n'));
  assert.deepEqual(result.deployed, selected);
  const final = result.summaries.at(-1);
  assert.equal(final.stage, 'complete'); assert.equal(final.otherSevenFunctionsUnchanged, true);
  assert.equal(final.schedulerPreserved, true); assert.equal(final.actualDomainAnonymousBoundariesPassed, true);
});
test('runtime drift stops release before the second function', async () => {
  const result = await simulate({ configChanged: true });
  assert.equal(result.code, 1); assert.deepEqual(result.deployed, [selected[0]]);
  assert.match(result.errors[0], /runtime configuration changed/);
});
test('scheduler drift is detected and cannot report completion', async () => {
  const result = await simulate({ schedulerChanged: true });
  assert.equal(result.code, 1); assert.notEqual(result.summaries.at(-1).stage, 'complete');
  assert.match(result.errors[0], /Daily scheduler changed/);
});
