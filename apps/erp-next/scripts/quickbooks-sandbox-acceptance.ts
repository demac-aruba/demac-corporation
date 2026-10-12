import assert from 'node:assert/strict';
import type { QuickBooksSandboxStatus } from '../lib/firebase/quickbooks-sandbox';

async function run() {
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'demo-qbo-synthetic';
  process.env.NEXT_PUBLIC_QBO_SANDBOX_ENABLED = 'true';
  process.env.NEXT_PUBLIC_ISOLATED_PREVIEW = 'false';
  const storage = new Map<string, string>();
  const sessionStorage = { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) };
  let navigated = '';
  const location = { pathname: '/integrations/', search: '', hash: '', assign: (url: string) => { navigated = url; } };
  Object.assign(globalThis, { sessionStorage, window: { sessionStorage, location, history: {
    state: null, replaceState: (_state: unknown, _title: string, url: string) => { assert.equal(url, '/integrations/'); location.hash = ''; },
  } } });
  const { persistFirebaseWebSession } = await import('../lib/firebase/session');
  const client = await import('../lib/firebase/quickbooks-sandbox');
  const signIn = (uid = 'owner') => persistFirebaseWebSession({ uid, email: 'synthetic@example.test', idToken: 'synthetic-firebase', refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000 });
  const pendingKey = 'demac.quickbooks.sandbox.v1';
  const ticket = Buffer.alloc(32, 3).toString('base64url');
  const status: QuickBooksSandboxStatus = { configured: true, environment: 'sandbox', syncEnabled: false, connection: null };
  const calls: Array<{ url: string; body: Record<string, string> | null }> = [];
  let fetcher = async (_body: Record<string, string> | null) => new Response(JSON.stringify(status));
  globalThis.fetch = async (input, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, string> : null;
    calls.push({ url: String(input), body });
    assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
    return fetcher(body);
  };
  signIn();
  process.env.NEXT_PUBLIC_ISOLATED_PREVIEW = 'true';
  assert.equal((await client.loadQuickBooksSandbox('owner')).configured, false);
  assert.equal(calls.length, 0, 'Isolated previews never contact the real provider/backend');
  process.env.NEXT_PUBLIC_ISOLATED_PREVIEW = 'false';
  process.env.NEXT_PUBLIC_QBO_SANDBOX_ENABLED = 'false';
  assert.equal((await client.loadQuickBooksSandbox('owner')).configured, false);
  assert.equal(calls.length, 0, 'Disabled integration never calls an undeployed function');
  process.env.NEXT_PUBLIC_QBO_SANDBOX_ENABLED = 'true';

  fetcher = async () => new Response(JSON.stringify({ authorizationUrl: 'https://appcenter.intuit.com/connect/oauth2?state=synthetic' }));
  await client.startQuickBooksSandbox('owner');
  const pending = JSON.parse(storage.get(pendingKey)!);
  assert.equal(pending.uid, 'owner'); assert.equal(pending.proof.length, 43);
  assert.equal(calls.at(-1)?.body?.proofHash.length, 64);
  assert.equal(calls.at(-1)?.body?.proof, undefined, 'Start sends only the proof hash');
  assert.match(navigated, /^https:\/\/appcenter.intuit.com\/connect\/oauth2/);

  location.hash = `#qbo_ticket=${ticket}`;
  let release: () => void = () => {};
  const wait = new Promise<void>(resolve => { release = resolve; });
  fetcher = async () => { await wait; return new Response(JSON.stringify(status)); };
  const first = client.loadQuickBooksSandbox('owner');
  const second = client.loadQuickBooksSandbox('owner');
  release(); await Promise.all([first, second]);
  assert.equal(calls.filter(call => call.body?.action === 'finish').length, 1, 'StrictMode/remount duplicates share finish');
  assert.equal(location.hash, ''); assert.equal(storage.has(pendingKey), false);

  storage.set(pendingKey, JSON.stringify({ ...pending, ticket }));
  fetcher = async () => { throw new Error('private-provider-detail'); };
  await assert.rejects(client.loadQuickBooksSandbox('owner'), error => error instanceof Error && !error.message.includes('private-provider-detail'));
  assert.equal(storage.has(pendingKey), true, 'Transient failure preserves proof and ticket for safe retry');
  fetcher = async () => new Response(JSON.stringify(status));
  await client.loadQuickBooksSandbox('owner');
  assert.equal(storage.has(pendingKey), false);

  location.hash = `#qbo_ticket=${ticket}`;
  const count = calls.length;
  await assert.rejects(client.loadQuickBooksSandbox('owner'), /sesión/);
  assert.equal(calls.length, count, 'A returned ticket without its browser proof is never submitted');
  location.hash = '#qbo_error=authorization-cancelled';
  await assert.rejects(client.loadQuickBooksSandbox('owner'), /Cancelaste/);
  assert.equal(location.hash, '');

  storage.set(pendingKey, JSON.stringify({ ...pending, ticket }));
  fetcher = async () => { signIn('other'); return new Response(JSON.stringify(status)); };
  await assert.rejects(client.loadQuickBooksSandbox('owner'), /sesión/);
  assert.equal(storage.has(pendingKey), true, 'Stale response cannot remove another session flow');
  signIn();
  fetcher = async () => new Response(JSON.stringify({ authorizationUrl: 'https://evil.example/connect' }));
  navigated = '';
  await assert.rejects(client.startQuickBooksSandbox('owner'));
  assert.equal(navigated, '', 'Untrusted authorization destination is rejected');
  console.log('QuickBooks sandbox browser acceptance: PASS (preview isolation, proof binding, retry, cancellation, session race, redirect guard).');
}
void run().catch(error => { console.error(error); process.exitCode = 1; });
