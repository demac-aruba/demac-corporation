import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FIELD_PREVIEW_BRANCH, assertFieldPreviewBuildSafety } from '../lib/field-preview-build-safety';

// Configuration-shaped strings only. No real app, account, API key or service call.
const production = { projectId: 'demac-corporation', apiKey: 'synthetic-production-public-key', messagingSenderId: '111111', appId: '1:111111:web:production' };
const valid: Record<string, string | undefined> = {
  VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: FIELD_PREVIEW_BRANCH,
  DEMAC_FIELD_PREVIEW_PROJECT_ID: 'demac-synthetic-test',
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demac-synthetic-test',
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: 'demac-synthetic-test.firebaseapp.com',
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demac-synthetic-test.firebasestorage.app',
  NEXT_PUBLIC_FIREBASE_API_KEY: 'synthetic-test-public-key',
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: '222222',
  NEXT_PUBLIC_FIREBASE_APP_ID: '1:222222:web:synthetic',
  NEXT_PUBLIC_ISOLATED_PREVIEW: 'false',
  NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED: 'false',
  NEXT_PUBLIC_PERFORMANCE_ENVIRONMENT: 'preview', NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: '',
};
let cases = 0;
const accepted = (env: Record<string, string | undefined>) => { assert.doesNotThrow(() => assertFieldPreviewBuildSafety(env, production)); cases += 1; };
const denied = (changes: Record<string, string | undefined>) => {
  const env = { ...valid, ...changes };
  const before = JSON.stringify(env);
  assert.throws(() => assertFieldPreviewBuildSafety(env, production), /^Error: Field preview build blocked:/);
  assert.equal(JSON.stringify(env), before, 'a build check never rewrites configuration'); cases += 1;
};
accepted(valid);
accepted({ ...valid, NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'demac-synthetic-test.appspot.com' });
accepted({ VERCEL: '1', VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: 'main' });
accepted({ VERCEL: '1', VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'feature/unrelated' });
accepted({ VERCEL_GIT_COMMIT_REF: FIELD_PREVIEW_BRANCH, NEXT_PUBLIC_ISOLATED_PREVIEW: 'true' });
denied({ VERCEL_ENV: 'production' });
denied({ VERCEL_ENV: undefined });
for (const project of [undefined, '', 'demac-corporation', 'demo-demac-dwellings', ' invalid-project', 'ABC', 'https://example.invalid']) denied({ DEMAC_FIELD_PREVIEW_PROJECT_ID: project });
denied({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'demac-corporation' });
denied({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined });
for (const domain of ['demac-corporation.firebaseapp.com', 'trycloudflare.com', 'demac-synthetic-test.firebaseapp.com.evil.invalid']) denied({ NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: domain });
for (const bucket of ['demac-corporation.firebasestorage.app', 'demac-synthetic-test.appspot.com.evil.invalid', undefined]) denied({ NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: bucket });
for (const key of [production.apiKey, 'demo-key', '', '   ', undefined]) denied({ NEXT_PUBLIC_FIREBASE_API_KEY: key });
for (const sender of [production.messagingSenderId, '00000', 'wrong', undefined]) denied({ NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: sender });
for (const app of [production.appId, '1:333333:web:wrong', '1:222222:web:', '1:222222:web:valid:extra', undefined]) denied({ NEXT_PUBLIC_FIREBASE_APP_ID: app });
denied({ NEXT_PUBLIC_ISOLATED_PREVIEW: 'true' });
denied({ NEXT_PUBLIC_ISOLATED_PREVIEW: undefined });
denied({ NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED: 'true' });
denied({ NEXT_PUBLIC_PERFORMANCE_ENVIRONMENT: 'production' });
denied({ NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: 'synthetic-analytics-id' });
denied({ NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: undefined });
const config = readFileSync('next.config.ts', 'utf8');
assert.match(config, /assertFieldPreviewBuildSafety\(process\.env, firebaseDefaults\)/, 'the actual Next config must invoke the guard');
assert.ok(config.indexOf('assertFieldPreviewBuildSafety(process.env') < config.indexOf('const firebasePublicEnv'), 'guard runs before resolving production defaults');
cases += 1;
console.log(`Field preview build safety acceptance passed (${cases} cases).`);
