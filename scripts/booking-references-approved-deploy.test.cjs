const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'booking-references-approved-deploy.cjs'), 'utf8');

async function rejectedRelease({ mainChanged = false, to = '2975606772', status = 'sent' } = {}) {
  const commands = [], errors = [], written = [];
  const sha = 'a'.repeat(40), main = 'b'.repeat(40);
  const env = { GITHUB_REPOSITORY: 'demac-aruba/demac-corporation',
    GITHUB_REF: 'refs/heads/release/booking-references-20261007', GITHUB_SHA: sha, RUNNER_TEMP: '/isolated-test' };
  const context = { process: { env }, console: { log() {}, error: message => errors.push(message) },
    require: name => {
      if (name === 'node:fs') return { mkdirSync() {}, writeFileSync: (file, body) => written.push({ file, body }) };
      if (name === 'node:module') return { createRequire: () => module => {
        if (module === 'firebase-admin/app') return { initializeApp() {}, applicationDefault() {} };
        if (module === 'firebase-admin/firestore') return { getFirestore: () => ({ collection: collection => {
          assert.equal(collection, 'whatsappOutboundQueue');
          return { doc: id => { assert.match(id, /^pr557-owner-smoke-20261007-0[0-5]$/);
            return { get: async () => ({ exists: true, data: () => ({ testRunId: 'pr557-owner-smoke-20261007', to, status, messageId: 'synthetic-id' }) }) }; } };
        } }) };
        throw Error('Unexpected module');
      } };
      if (name === 'node:child_process') return { execFileSync: (binary, args) => {
        commands.push({ binary, args }); assert.equal(binary, 'git', 'No production CLI may be reached by a rejected preflight');
        if (args[0] === 'ls-remote') return `${args[2] === 'refs/heads/main' ? main : sha}\t${args[2]}\n`;
        if (args[0] === 'merge-base') return '';
        if (args[1] === 'HEAD') return sha;
        if (mainChanged && args[1].startsWith(main + ':')) return 'unreviewed-tree';
        return args[1].split(':').pop() + '-reviewed-tree';
      } };
      return require(name);
    } };
  vm.runInNewContext(source, context, { filename: 'booking-references-approved-deploy.cjs' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(context.process.exitCode, 1);
  assert.equal(commands.some(call => call.binary !== 'git'), false);
  assert.ok(errors.length);
  assert.ok(written.some(item => item.file.endsWith('/summary.json')));
  return errors.join('\n');
}
test('unreviewed current main blocks all cloud operations', async () => {
  assert.match(await rejectedRelease({ mainChanged: true }), /Main differs/);
});
test('a smoke to any other recipient cannot authorize release', async () => {
  await rejectedRelease({ to: 'another-recipient@g.us' });
});
test('a queued/unacknowledged smoke cannot authorize release', async () => {
  await rejectedRelease({ status: 'queued' });
});
