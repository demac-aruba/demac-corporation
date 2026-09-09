'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const root = path.resolve(__dirname, '..'), ts = require('typescript');
test('Recruitment is always discoverable to the existing super-admin role, independent of public intake flags', () => {
  const source = fs.readFileSync(path.join(root, 'lib/navigation.ts'), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  for (const value of [undefined, 'false', 'true']) {
    const exports = {}; vm.runInNewContext(js, { exports, process: { env: { NEXT_PUBLIC_CAREERS_ADMIN_ENABLED: value, NEXT_PUBLIC_CAREERS_LIVE_ENABLED: 'false' } } });
    const management = exports.navigationGroups.find(g => g.label === 'Management');
    assert.equal(management.items[0].label, 'Recruitment'); assert.equal(management.items[0].href, '/recruitment');
    assert.deepEqual(Array.from(management.items[0].roles), ['super_admin']); assert.equal(management.items[1].label, 'Employees');
    assert.equal(exports.navigationGroups.flatMap(g => g.items).filter(i => i.href === '/recruitment').length, 1);
  }
});
test('the protected route checks active Firebase principal before mounting the data-fetching workspace', () => {
  const source = fs.readFileSync(path.join(root, 'app/(erp)/recruitment/page.tsx'), 'utf8');
  assert(source.includes("status === 'loading'")); assert(source.includes("mode !== 'firebase'"));
  assert(source.includes('!principal.active')); assert(source.includes("principal.role !== 'super_admin'"));
  assert(source.indexOf("mode !== 'firebase'") < source.indexOf('return <RecruitmentWorkspace'));
});
test('public and maintenance activation guards remain off-by-default; release entry exports admin only', () => {
  const repository = path.resolve(root, '../..');
  const route = fs.readFileSync(path.join(root, 'app/careers/page.tsx'), 'utf8');
  assert(route.includes("process.env.NEXT_PUBLIC_CAREERS_LIVE_ENABLED === 'true'")); assert(route.includes('<CareersAvailability'));
  const entry = fs.readFileSync(path.join(repository, 'functions/careers-admin-entry.cjs'), 'utf8');
  assert(entry.includes("exports.careersAdmin = require('./careers').careersAdmin"));
  assert(!entry.includes('exports.careersPublic')); assert(!entry.includes('exports.careersMaintenance'));
  const runtime = fs.readFileSync(path.join(repository, 'functions/careers.js'), 'utf8');
  assert(runtime.includes("process.env.CAREERS_RELEASE_APPROVED!=='true'"));
});
