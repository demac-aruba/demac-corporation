'use strict';
// PR-scoped preservation gate. Compare to the actual PR base, not a stale hash.
// This is a read-only Git comparison; it never resets files or suppresses tests.
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const base = process.env.WEBSITE_EDITOR_BASE_SHA || '';
assert.match(base, /^[0-9a-f]{40}$/, 'Exact PR base SHA is required');
const protectedPaths = ['firestore.rules', 'storage.rules', 'firebase.json', '.firebaserc', '.github/workflows/firebase-rules-deploy.yml', 'functions/bootstrap.js', 'functions/package.json', 'src', 'services', 'scripts', 'apps/erp-next/lib/canonical-operations.ts'];
const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--', ...protectedPaths], { encoding: 'utf8' }).trim();
assert.equal(changed, '', `The frontend editor must not change deployment rules or operational sources:\n${changed}`);
console.log('Website editor release scope: production Firebase paths, bootstrap, Legacy, operational readers and scripts equal the PR base.');
