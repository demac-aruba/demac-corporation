/* Actual exported routes. Test-only Auth/Firestore responses are intercepted on
 * localhost; no authentication bypass or fixture ships in application code. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { chromium, webkit } = createRequire('/tmp/vrf-browser/package.json')('playwright');
const { expect } = createRequire('/tmp/vrf-browser/package.json')('@playwright/test');
const defaults = require('../../../functions/websiteVrfDefaults.json');
const origin = process.env.WEBSITE_EDITOR_REVIEW_ORIGIN || 'http://127.0.0.1:4173';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw Error('Editor browser tests require a localhost export. Production is forbidden.');
const output = path.resolve('.website-editor-artifacts'); fs.mkdirSync(output, { recursive: true });
const report = { origin, checks: [], mutations: [], errors: [] };
const encode = (v) => typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) };
async function contextFor(browser, role = 'admin', width = 1440) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const profile = { name: 'Editor review owner', role, active: true };
  let publicContent = structuredClone(defaults);
  if (role) await context.addInitScript(() => {
    sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify({ uid: 'editor-review-owner', email: 'editor@example.test', displayName: 'Editor review owner', idToken: 'local-test-token-not-a-credential', refreshToken: 'local-test-only', expiresAt: Date.now() + 3_600_000 }));
  });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*' };
    const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers, 'access-control-allow-methods': 'GET, POST, PATCH' } });
    if (url.hostname === 'firestore.googleapis.com') {
      if (method === 'GET' && url.pathname.endsWith('/users/editor-review-owner')) return json({ name: url.pathname, fields: Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, encode(v)])) });
      if (method === 'GET') return json({ error: { message: 'No fixture document' } }, 404);
      if (method === 'POST' && url.pathname.endsWith(':runQuery')) return json([]); // Explicit read-only query fixture.
      report.mutations.push({ host: url.hostname, path: url.pathname, method }); return json({ error: { message: 'Production write forbidden in tests' } }, 403);
    }
    if (url.hostname === 'firebasestorage.googleapis.com' && url.pathname.includes('published.json')) {
      if (method !== 'GET') { report.mutations.push({ host: url.hostname, method }); return json({}, 403); }
      return json(url.pathname.includes('vrf%2F') ? publicContent : {});
    }
    if (url.hostname.endsWith('cloudfunctions.net')) {
      if (method === 'GET') return json({ ok: true, jobs: [], settings: {}, status: 'closed' });
      report.mutations.push({ host: url.hostname, path: url.pathname, method }); return json({ ok: false, message: 'No backend writes in editor review' }, 403);
    }
    if (!['GET', 'HEAD'].includes(method)) { report.mutations.push({ host: url.hostname, path: url.pathname, method }); return json({}, 403); }
    return route.continue();
  });
  return { context, profile, setPublic: (value) => { publicContent = value; } };
}
async function inspectNormal(browser, name) {
  for (const role of [null, 'admin', 'office']) {
    const { context } = await contextFor(browser, role);
    const page = await context.newPage();
    await page.goto(`${origin}/services/vrf-systems/`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-vrf-desktop]')).toBeVisible();
    await expect(page.locator('[data-website-editor-session], [data-editor-highlight]')).toHaveCount(0);
    assert.equal(await page.getByRole('button', { name: /Edit Front End|Edit selected/ }).count(), 0);
    await page.goto(`${origin}/website-editor/?edit=1#aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-website-editor-session]')).toHaveCount(0);
    await expect(page.getByText('Being signed in does not activate editing.', { exact: false })).toBeVisible();
    if (role === 'office') {
      await page.goto(`${origin}/website-manager/`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('button', { name: /Edit Front End/ })).toHaveCount(0);
    }
    report.checks.push(`${name}: ${role || 'anonymous'} ordinary visit and direct URL cannot activate editor`);
    await context.close();
  }
}
async function editorReview(browser, name) {
  const { context, profile } = await contextFor(browser);
  const settings = await context.newPage();
  await settings.goto(`${origin}/website-manager/`, { waitUntil: 'domcontentloaded' });
  await expect(settings.getByRole('button', { name: /Edit Front End/ })).toBeVisible({ timeout: 15000 });
  const popupEvent = settings.waitForEvent('popup');
  await settings.getByRole('button', { name: /Edit Front End/ }).click();
  const editor = await popupEvent;
  const errors = [];
  editor.on('pageerror', (error) => errors.push(error.message));
  try {
    await expect(editor.locator('[data-website-editor-session]')).toBeVisible({ timeout: 20000 });
    const frame = editor.frameLocator('iframe');
    await expect(editor.getByRole('button', { name: 'Hero title', exact: false }).first()).toBeVisible({ timeout: 20000 });
    await expect(frame.locator('[data-vrf-desktop]')).toBeVisible();
    await frame.locator('[data-vrf-desktop] section[data-website-image="hero.imageUrl"]').click({ position: { x: 900, y: 250 } });
    await expect(editor.getByRole('heading', { name: 'Hero image', exact: true })).toBeVisible();
    const heading = frame.locator('[data-vrf-desktop] [data-website-text="hero.title"]');
    await heading.click();
    await expect(editor.getByRole('heading', { name: 'Hero title', exact: true })).toBeVisible();
    await editor.locator('aside textarea').fill('Comfort designed for every space in');
    await editor.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(heading).toHaveText('Comfort designed for every space in');
    await expect(editor.getByText('Saved in review tab', { exact: true })).toBeVisible({ timeout: 10000 });
    await editor.screenshot({ path: path.join(output, `${name}-desktop-edit.png`) });
    await editor.getByRole('button', { name: 'Undo last edit', exact: false }).click();
    await expect(heading).toHaveText(defaults.hero.title);
    await editor.locator('aside textarea').fill('Comfort designed for every space in');
    await editor.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(editor.getByText('Saved in review tab', { exact: true })).toBeVisible({ timeout: 10000 });
    await editor.getByRole('button', { name: 'Close selected element' }).click();
    await editor.getByRole('button', { name: 'Cassette Units · image', exact: false }).first().click();
    await editor.locator('input[type="file"]').setInputFiles('apps/erp-next/public/website/vrf/indoor-cassette-approved.webp');
    await expect(frame.locator('[data-vrf-desktop] [data-vrf-indoor-photo="cassette"]')).toHaveAttribute('src', /^blob:/);
    const decoded = await frame.locator('[data-vrf-desktop] [data-vrf-indoor-photo="cassette"]').evaluate(async (img) => { await img.decode(); return img.naturalWidth; });
    assert(decoded > 0, 'Uploaded image actually decodes inside the actual page');
    await expect(editor.getByText('Saved in review tab', { exact: true })).toBeVisible({ timeout: 10000 });
    await editor.getByRole('button', { name: 'Phone', exact: true }).click();
    await expect(frame.locator('[data-vrf-mobile]')).toBeVisible();
    await expect(frame.locator('[data-vrf-mobile] [data-website-text="hero.title"]')).toHaveText('Comfort designed for every space in');
    await frame.getByRole('tab', { name: 'Mini VRF', exact: true }).click();
    await expect(frame.locator('#vrf-system-panel-2')).toBeVisible();
    await frame.locator('#vrf-mobile-indoors details').first().locator('summary').click();
    await expect(frame.locator('#vrf-mobile-indoors details').first()).toHaveAttribute('open', '');
    await editor.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(editor.getByRole('region', { name: 'Content editing panel' })).toHaveCount(0);
    await expect(frame.locator('[data-editor-highlight]')).toHaveCount(0);
    const width = await frame.locator('html').evaluate((node) => ({ width: innerWidth, scroll: node.scrollWidth }));
    assert(width.scroll <= width.width + 1, 'No phone horizontal page overflow');
    await editor.screenshot({ path: path.join(output, `${name}-phone-preview.png`) });
    await editor.getByRole('button', { name: 'Back to edit', exact: true }).click();
    await editor.getByRole('button', { name: 'Desktop', exact: true }).click();
    await editor.getByRole('button', { name: 'Publish preview', exact: true }).click();
    await expect(editor.getByRole('dialog', { name: 'Review publication' })).toBeVisible();
    await expect(editor.getByText('It does not update demac-aruba.com.', { exact: false })).toBeVisible();
    await editor.getByRole('button', { name: 'Publish this preview version', exact: true }).click();
    await expect(editor.getByText('Review version published in this tab only.', { exact: false })).toBeVisible();
    const visitor = await context.newPage();
    await visitor.goto(`${origin}/services/vrf-systems/`, { waitUntil: 'domcontentloaded' });
    await expect(visitor.locator('[data-vrf-desktop] [data-website-text="hero.title"]')).toHaveText(defaults.hero.title);
    await expect(visitor.locator('[data-editor-highlight], [data-website-editor-session]')).toHaveCount(0);
    await visitor.close();
    // Same actual navigation, not a route-list mock. Careers remains read-only.
    await frame.getByRole('navigation', { name: 'Main navigation', exact: true }).getByRole('link', { name: 'Careers', exact: true }).click();
    await expect(editor.getByText('Careers · managed in Settings', { exact: true })).toBeVisible({ timeout: 15000 });
    await expect(editor.getByRole('region', { name: 'Content editing panel' })).toHaveCount(0);
    await editor.getByRole('button', { name: 'Return to VRF', exact: true }).click();
    await expect(heading).toHaveText('Comfort designed for every space in');
    await editor.getByRole('button', { name: 'Version history', exact: true }).click();
    await editor.getByRole('button', { name: 'Restore to draft', exact: true }).first().click();
    await expect(heading).toHaveText(defaults.hero.title);
    await editor.setViewportSize({ width: 390, height: 844 });
    await editor.getByRole('button', { name: 'Close selected element' }).click().catch(() => {});
    await editor.getByRole('button', { name: 'Hero title', exact: false }).first().click();
    await expect(editor.locator('aside textarea')).toHaveValue(defaults.hero.title);
    await editor.screenshot({ path: path.join(output, `${name}-phone-edit.png`) });
    assert.equal(await editor.locator('html').evaluate((node) => node.scrollWidth > innerWidth + 1), false, 'Editor shell fits phone');
    // Forged cross-window commands carry no authority; the owner session stays
    // active and only the designated child frame can send selection/state.
    await editor.evaluate(() => window.postMessage({ protocol: 'demac-website-editor-v1', type: 'state', pageId: 'vrf', changes: [{ key: 'hero.title', value: 'FORGED' }] }, location.origin));
    await expect(frame.locator('[data-vrf-mobile] [data-website-text="hero.title"]')).not.toHaveText('FORGED');
    profile.active = false;
    await editor.locator('aside textarea').fill('Rejected after revocation');
    await editor.getByRole('button', { name: 'Apply to draft', exact: true }).click();
    await expect(editor.locator('[data-error="true"][role="alert"]')).toContainText('inactive', { timeout: 10000 });
    assert.equal(report.mutations.length, 0, 'Review must never attempt cloud mutations');
    // Cross-tab sign-out signal has no credentials and only closes editor mode.
    await settings.evaluate(() => { const channel = new BroadcastChannel('demac-website-editor-session'); channel.postMessage({ type: 'signed-out' }); channel.close(); });
    await expect(editor.locator('[data-website-editor-session]')).toHaveCount(0);
    report.checks.push(`${name}: explicit launch, actual DOM selection, typed edit, autosave, undo, decoded upload, desktop/phone, tabs/disclosures, private publish/history, Careers exclusion, cross-tab isolation, revoked-role denial and logout`);
    report.errors.push(...errors); assert.deepEqual(errors, []);
  } catch (error) {
    await editor.screenshot({ path: path.join(output, `${name}-failure.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
(async () => {
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch();
      try { await inspectNormal(browser, name); await editorReview(browser, name); } finally { await browser.close(); }
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
