'use strict';
// The actual exported production-mode UI, real HTTP service and Firebase
// emulators. No credential/test hook is compiled into application code.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const { randomUUID } = require('node:crypto');
for (const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST']) assert.match(process.env[key] || '', /^127\.0\.0\.1:\d+$/, key);
const tools = createRequire('/tmp/editor-rules/package.json');
const { chromium, webkit } = tools('playwright'), { expect } = tools('@playwright/test');
const { initializeTestEnvironment } = tools('@firebase/rules-unit-testing');
const { initializeApp, deleteApp } = tools('firebase-admin/app');
const { getFirestore, FieldValue } = tools('firebase-admin/firestore');
const { getStorage } = tools('firebase-admin/storage');
const { getAuth } = tools('firebase-admin/auth');
const C = require('../../../functions/websiteEditorialContract');
const { createWebsiteContentFirebase, PATHS } = require('../../../functions/websiteContentFirebase');
const { createWebsiteContentService } = require('../../../functions/websiteContentService');
const { createWebsiteContentHttp } = require('../../../functions/websiteContentHttp');
const projectId = 'demo-demac-website', bucketName = `${projectId}.appspot.com`, origin = 'http://127.0.0.1:4173';
const output = path.resolve('.website-editor-live-artifacts'); fs.mkdirSync(output, { recursive: true });
const report = { checks: [], forbiddenRequests: [], errors: [], localWrites: [] };
const app = initializeApp({ projectId, storageBucket: bucketName }, 'website-ui-live-proof');
const db = getFirestore(app), bucket = getStorage(app).bucket(), auth = getAuth(app);
const adapters = () => createWebsiteContentFirebase({ db, bucket, deleteField: () => FieldValue.delete(), deploymentEnabled: () => true });
let service = createWebsiteContentService(adapters()), environment, server, endpoint;
const publicURL = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}/v0/b/${bucketName}/o/${encodeURIComponent(C.PAGE.publicPath)}?alt=media`;
async function seed() {
  await environment.clearFirestore();
  const result = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${randomUUID()}@example.test`, password: randomUUID(), returnSecureToken: true }) });
  assert.equal(result.status, 200); const account = await result.json();
  const profile = { active: true, role: 'admin', name: 'Isolated editor test owner' };
  await db.doc(`users/${account.localId}`).set(profile);
  const published = C.normalizeVrf(C.defaults); published.hero.title = 'Verified public baseline in';
  await db.doc(`businessSettings/${C.PAGE.publishedId}`).set(published);
  await db.doc(`businessSettings/${C.PAGE.draftId}`).set(published);
  await db.doc('businessSettings/business-calendar').set({ closedWeekdays: [0], untouched: true });
  for (const collection of ['appointments','clients','workOrders','taskRecords']) await db.doc(`${collection}/editor-isolation-sentinel`).set({ untouched: true });
  await bucket.file(C.PAGE.publicPath).save(JSON.stringify(published), { resumable: false, metadata: { contentType: 'application/json' } });
  return { account, published };
}
async function routeNetwork(context) {
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === origin || ['blob:', 'data:'].includes(url.protocol)) return route.continue();
    let destination;
    if (url.hostname === 'firestore.googleapis.com' && url.pathname.startsWith(`/v1/projects/${projectId}/`)) {
      if (!['GET','HEAD','OPTIONS'].includes(method) && !(method === 'POST' && url.pathname.endsWith(':runQuery'))) {
        report.forbiddenRequests.push(`Direct Firestore mutation ${url.pathname}`); return route.abort();
      }
      destination = `http://${process.env.FIRESTORE_EMULATOR_HOST}${url.pathname}${url.search}`;
    } else if (url.hostname === 'firebasestorage.googleapis.com' && url.pathname.startsWith(`/v0/b/${bucketName}/o`)) {
      if (!['GET','HEAD','OPTIONS'].includes(method)) {
        const name = url.searchParams.get('name') || '';
        if (method !== 'POST' || !name.startsWith('public-website/vrf/editor/')) { report.forbiddenRequests.push(`Unexpected Storage mutation ${name}`); return route.abort(); }
        report.localWrites.push('website image upload');
      }
      destination = `http://${process.env.FIREBASE_STORAGE_EMULATOR_HOST}${url.pathname}${url.search}`;
    } else if (url.hostname === `us-central1-${projectId}.cloudfunctions.net` && url.pathname === '/websiteContentApi') {
      destination = endpoint;
      if (method === 'POST') report.localWrites.push(`editor command: ${request.postDataJSON().action}`);
    } else if (['GET','HEAD'].includes(method) && !/(?:googleapis\.com|cloudfunctions\.net|firebaseapp\.com)$/.test(url.hostname)) return route.continue();
    else { report.forbiddenRequests.push(`${method} ${url.hostname}${url.pathname}`); return route.abort(); }
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization,content-type', 'access-control-allow-methods': 'GET,POST,HEAD,OPTIONS' } });
    const headers = await request.allHeaders(); delete headers.host; delete headers['content-length'];
    const response = await fetch(destination, { method, headers, ...(!['GET','HEAD'].includes(method) ? { body: request.postDataBuffer() } : {}) });
    const received = Object.fromEntries(response.headers); delete received['content-encoding']; delete received['content-length']; delete received['transfer-encoding'];
    received['access-control-allow-origin'] = origin;
    await route.fulfill({ status: response.status, headers: received, body: Buffer.from(await response.arrayBuffer()) });
  });
}
async function run(engine, name) {
  const { account, published } = await seed(), browser = await engine.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ origin, account }) => {
    if (location.origin !== origin) return;
    sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify({ uid: account.localId, email: account.email, idToken: account.idToken, refreshToken: account.refreshToken, expiresAt: Date.now() + 3_600_000 }));
  }, { origin, account });
  await routeNetwork(context);
  const settings = await context.newPage(); let editor, anonymous;
  settings.on('pageerror', error => report.errors.push(error.message));
  try {
    await settings.goto(`${origin}/website-manager/`, { waitUntil: 'domcontentloaded' });
    const launch = settings.getByRole('button', { name: /Edit Front End/ }); await expect(launch).toBeVisible({ timeout: 20000 });
    async function openEditor() {
      const opening = settings.waitForEvent('popup'); await launch.click(); const page = await opening;
      page.on('pageerror', error => report.errors.push(error.message));
      await expect(page.locator('[data-website-editor-session]')).toBeVisible({ timeout: 20000 });
      await expect(page.getByRole('button', { name: /Hero title/ }).first()).toBeVisible({ timeout: 20000 });
      await expect(page.getByText('Editing a private draft', { exact: false })).toBeVisible();
      return page;
    }
    editor = await openEditor();
    let frame = editor.frameLocator('iframe'), heading = frame.locator('[data-vrf-desktop] [data-website-text="hero.title"]');
    await expect(heading).toHaveText(published.hero.title);
    await heading.click(); await editor.locator('aside textarea').fill('Persisted website content from the real editor in');
    await editor.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(editor.getByText('Saved in cloud', { exact: true })).toBeVisible({ timeout: 15000 });
    assert.equal((await db.doc(PATHS.draft).get()).data().hero.title, 'Persisted website content from the real editor in');
    assert.equal((await (await fetch(publicURL)).json()).hero.title, published.hero.title);
    await editor.getByRole('button', { name: 'Exit', exact: true }).click(); await editor.close();
    service = createWebsiteContentService(adapters()); // Fresh API service, same durable data.
    editor = await openEditor(); frame = editor.frameLocator('iframe'); heading = frame.locator('[data-vrf-desktop] [data-website-text="hero.title"]');
    await expect(heading).toHaveText('Persisted website content from the real editor in');
    await editor.getByRole('button', { name: 'Cassette Units · image', exact: false }).first().click();
    await editor.locator('input[type="file"]').setInputFiles('apps/erp-next/public/website/vrf/indoor-cassette-approved.webp');
    await expect(editor.getByText('Saved in cloud', { exact: true })).toBeVisible({ timeout: 15000 });
    const image = frame.locator('[data-vrf-desktop] [data-vrf-indoor-photo="cassette"]');
    await expect(image).toHaveAttribute('src', /^https:\/\/firebasestorage\.googleapis\.com\//);
    assert(await image.evaluate(async img => { await img.decode(); return img.naturalWidth > 0; }));
    await editor.getByRole('button', { name: 'Publish page', exact: true }).click();
    await expect(editor.getByRole('dialog', { name: 'Review publication' })).toBeVisible();
    await editor.getByRole('button', { name: 'Publish VRF page', exact: true }).click();
    await expect(editor.getByText('Published version verified.', { exact: true })).toBeVisible({ timeout: 15000 });
    const visible = await (await fetch(publicURL)).json(); assert.match(visible.publicationId, /^[0-9a-f-]{36}$/);
    assert.equal(visible.hero.title, 'Persisted website content from the real editor in');
    await editor.screenshot({ path: path.join(output, `${name}-cloud-published.png`) });
    anonymous = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
    await routeNetwork(anonymous); const visitor = await anonymous.newPage(); visitor.on('pageerror', error => report.errors.push(error.message));
    await visitor.goto(`${origin}${C.PAGE.route}`, { waitUntil: 'domcontentloaded' });
    await expect(visitor.locator('[data-vrf-mobile] [data-website-text="hero.title"]')).toHaveText(visible.hero.title, { timeout: 15000 });
    await expect(visitor.locator('[data-website-editor-session], [data-editor-highlight]')).toHaveCount(0);
    const visitorImage = visitor.locator('[data-vrf-mobile] [data-vrf-indoor-photo="cassette"]'); await visitorImage.scrollIntoViewIfNeeded();
    await expect(visitorImage).toHaveAttribute('src', visible.indoorUnits[0].imageUrl);
    assert(await visitorImage.evaluate(async img => { await img.decode(); return img.naturalWidth > 0; }));
    await visitor.screenshot({ path: path.join(output, `${name}-anonymous-phone.png`) });
    await editor.getByRole('button', { name: 'Version history', exact: true }).click();
    await editor.getByRole('button', { name: 'Restore to draft', exact: true }).first().click();
    await expect(heading).toHaveText(published.hero.title);
    assert.equal((await (await fetch(publicURL)).json()).publicationId, visible.publicationId);
    for (const collection of ['appointments','clients','workOrders','taskRecords']) assert.deepEqual((await db.doc(`${collection}/editor-isolation-sentinel`).get()).data(), { untouched: true });
    assert.deepEqual((await db.doc('businessSettings/business-calendar').get()).data(), { closedWeekdays: [0], untouched: true });
    assert.deepEqual((await db.doc(`businessSettings/${C.PAGE.draftId}`).get()).data(), published);
    assert.deepEqual(report.forbiddenRequests, []); assert.deepEqual(report.errors, []);
    report.checks.push(`${name}: production-mode UI → real Auth/HTTP/Firestore/Storage, durable reopen, decoded cloud image, publication/anonymous phone proof, draft-only restore and operational isolation`);
  } catch (error) { await editor?.screenshot({ path: path.join(output, `${name}-failure.png`) }).catch(() => {}); throw error; }
  finally { await anonymous?.close(); await context.close(); await browser.close(); }
}
(async () => {
  try {
    environment = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8187, rules: fs.readFileSync('firestore.rules','utf8') }, storage: { host: '127.0.0.1', port: 9297, rules: fs.readFileSync('storage.rules','utf8') } });
    const handler = createWebsiteContentHttp({ service: { execute: (...args) => service.execute(...args) }, verifyToken: (token, revoked) => auth.verifyIdToken(token, revoked), allowedOrigins: [origin] });
    server = createServer(async (request, response) => {
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 600_000) { response.writeHead(413); response.end(); return; } }
      request.get = name => request.headers[name.toLowerCase()];
      try { request.body = body ? JSON.parse(body) : null; } catch { request.body = null; }
      const reply = { set: (key,value) => { response.setHeader(key,value); return reply; }, status: code => { response.statusCode=code; return reply; }, json: value => { response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(value)); }, send: value => response.end(value) };
      await handler(request, reply);
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); endpoint=`http://127.0.0.1:${server.address().port}/websiteContentApi`;
    for (const [engine,name] of [[chromium,'chromium'],[webkit,'webkit']]) await run(engine,name);
    report.status='passed';
  } catch (error) { report.status='failed'; report.failure=String(error.stack || error); process.exitCode=1; }
  finally {
    fs.writeFileSync(path.join(output,'live-browser-review.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2));
    if (server) await new Promise(resolve=>server.close(resolve)); await environment?.cleanup(); await db.terminate(); await deleteApp(app);
  }
})();
