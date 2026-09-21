'use strict';
// Runs the real bootstrap export through Firebase Functions, Auth and Firestore.
// The generated discovery entry selects ONLY Projects: operational triggers must
// never run against fixtures. No shipping source is transformed or copied.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '../..');
if (process.versions.node.split('.')[0] !== '22') throw new Error('Use the Functions Node 22 runtime.');
const cli = path.join(process.env.PROJECTS_UI_TOOLS || '', 'node_modules/firebase-tools/lib/bin/firebase.js');
if (!process.env.PROJECTS_UI_TOOLS || !fs.existsSync(cli)) throw new Error('Set PROJECTS_UI_TOOLS to the isolated firebase-tools installation.');
const env = { ...process.env, GCLOUD_PROJECT: 'demo-demac-projects', GOOGLE_CLOUD_PROJECT: 'demo-demac-projects', CI: 'true' };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH';
env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || '');
for (const key of Object.keys(env)) {
  if (/^(GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_TOKEN|GOOGLE_OAUTH_ACCESS_TOKEN|CLOUDSDK_AUTH_ACCESS_TOKEN|VERCEL_TOKEN|FIREBASE_CONFIG|FIRESTORE_EMULATOR_HOST|FIREBASE_AUTH_EMULATOR_HOST|PROJECTS_REGISTRY_ENABLED|PROJECTS_ALLOWED_ORIGINS)$/.test(key)) delete env[key];
}
const directory = fs.mkdtempSync(path.join(ROOT, '.projects-http-emulator-'));
const dependencies = require('../package.json').dependencies;
fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'projects-http-emulator-only', private: true, main: 'index.cjs', engines: { node: '22' }, dependencies }, null, 2));
fs.writeFileSync(path.join(directory, 'index.cjs'), `'use strict';\nexports.projectsRegistry = require(${JSON.stringify(path.join(ROOT, 'functions/bootstrap.js'))}).projectsRegistry;\n`);
fs.symlinkSync(path.join(ROOT, 'functions/node_modules'), path.join(directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
fs.writeFileSync(path.join(directory, '.env.local'), 'PROJECTS_REGISTRY_ENABLED=true\nPROJECTS_ALLOWED_ORIGINS=https://erp.example.test,http://127.0.0.1:4173\n');
fs.copyFileSync(path.join(ROOT, 'firestore.rules'), path.join(directory, 'firestore.rules'));
const config = {
  functions: { source: '.', codebase: 'projects-http-test', runtime: 'nodejs22' },
  firestore: { rules: 'firestore.rules' },
  emulators: {
    functions: { host: '127.0.0.1', port: 5001 },
    firestore: { host: '127.0.0.1', port: 8180 },
    auth: { host: '127.0.0.1', port: 9199 },
    hub: { host: '127.0.0.1', port: 4400 },
    logging: { host: '127.0.0.1', port: 4500 },
    ui: { enabled: false }, singleProjectMode: true,
  },
};
fs.writeFileSync(path.join(directory, 'firebase.json'), JSON.stringify(config, null, 2));
const testFile = path.join(ROOT, 'functions/projects/registry-http.emulator.cjs');
const result = spawnSync(process.execPath, [cli, 'emulators:exec', '--non-interactive', '--project', 'demo-demac-projects', '--config', 'firebase.json', '--only', 'functions,firestore,auth', `node --test "${testFile}"`], { cwd: directory, env, stdio: 'inherit' });
if (result.error) throw result.error;
// Keep local emulator logs for debugging; never upload them as public evidence.
process.exitCode = result.status ?? 1;
