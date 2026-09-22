'use strict';
// Website function packaging belongs to its functions boundary, never the
// operational services tree. Only these reviewed source files may be deployed.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..'), output = path.join(root, '.website-content-build');
const files = ['websiteContentApi.js', 'websiteContentHttp.js', 'websiteContentFirebase.js', 'websiteContentService.js', 'websiteEditorialContract.js', 'websiteVrfDefaults.json'];
const external = /^(node:crypto|firebase-admin\/(app|auth|firestore|storage)|firebase-functions\/v2\/https)$/;
fs.mkdirSync(output, { recursive: true });
for (const filename of fs.readdirSync(output)) {
  if (!files.includes(filename) && !['package.json', 'package-lock.json', 'node_modules', '.env', '.env.demac-corporation'].includes(filename)) throw Error(`Unexpected file in isolated codebase: ${filename}`);
}
for (const filename of files) {
  const source = fs.readFileSync(path.join(root, 'functions', filename), 'utf8');
  for (const match of source.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    const id = match[1];
    assert(id.startsWith('./') ? files.includes(`${id.slice(2)}${path.extname(id) ? '' : '.js'}`) : external.test(id), `Forbidden deployment dependency: ${id}`);
  }
  fs.writeFileSync(path.join(output, filename), source);
}
fs.copyFileSync(path.join(__dirname, 'package.json'), path.join(output, 'package.json'));
const config = JSON.parse(fs.readFileSync(path.join(root, 'firebase.website-content.json'), 'utf8'));
assert.deepEqual(Object.keys(config), ['functions']); assert.equal(config.functions.length, 1);
assert.equal(config.functions[0].codebase, 'website-content'); assert.equal(config.functions[0].source, '.website-content-build');
console.log(`Website-only deployment package verified: ${files.length} files; operational bootstrap and rules excluded.`);
