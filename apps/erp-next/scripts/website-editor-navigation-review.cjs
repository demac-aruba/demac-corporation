'use strict';
// Complementary regression: actual page/Settings routes and native anchor
// activation on descendants inside editable image containers. Local fixtures only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const tools = createRequire('/tmp/vrf-browser/package.json');
const { chromium, webkit } = tools('playwright');
const { expect } = tools('@playwright/test');
const defaults = require('../../../functions/websiteVrfDefaults.json');
const origin = 'http://127.0.0.1:4173';
const output = path.resolve('.website-editor-artifacts');
fs.mkdirSync(output, { recursive: true });
const report = { checks: [], mutations: [], errors: [] };
async function run(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(() => sessionStorage.setItem('demac.erp-next.firebase.session.v1', JSON.stringify({ uid: 'editor-nav-fixture', email: 'editor@example.test', idToken: 'test-only-not-a-credential', refreshToken: 'test-only', expiresAt: Date.now() + 3_600_000 })));
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' };
    const json = (value, status = 200) => route.fulfill({ status, headers, contentType: 'application/json', body: JSON.stringify(value) });
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.hostname === 'firestore.googleapis.com') {
      if (method === 'GET' && url.pathname.endsWith('/users/editor-nav-fixture')) return json({ fields: { name: { stringValue: 'Local review owner' }, active: { booleanValue: true }, role: { stringValue: 'admin' } } });
      if (method === 'GET') return json({}, 404);
      if (method === 'POST' && url.pathname.endsWith(':runQuery')) return json([]);
    }
    if (!['GET', 'HEAD'].includes(method)) { report.mutations.push({ host: url.hostname, path: url.pathname, method }); return json({}, 403); }
    if (url.hostname === 'firebasestorage.googleapis.com' && url.pathname.includes('published.json')) return json(url.pathname.includes('vrf%2F') ? defaults : {});
    if (url.hostname.endsWith('cloudfunctions.net')) return json({ ok: true, jobs: [], settings: {} });
    return route.continue();
  });
  const settings = await context.newPage();
  let editor;
  try {
    await settings.goto(`${origin}/website-manager/`, { waitUntil: 'domcontentloaded' });
    const launch = settings.getByRole('button', { name: /Edit Front End/ });
    await expect(launch).toBeVisible({ timeout: 15000 });
    const opened = settings.waitForEvent('popup'); await launch.click(); editor = await opened;
    editor.on('pageerror', (error) => report.errors.push(error.message));
    await expect(editor.locator('[data-website-editor-session]')).toBeVisible({ timeout: 20000 });
    const frame = editor.frameLocator('iframe');
    await expect(editor.getByRole('button', { name: /Hero title/ }).first()).toBeVisible({ timeout: 20000 });
    for (const [container, linkLabel, descendant] of [
      ['section[data-website-image="hero.imageUrl"]', defaults.hero.primaryCta.label, false],
      ['section[data-website-image="hero.imageUrl"]', defaults.hero.primaryCta.label, true],
      ['section[data-website-image="hero.imageUrl"]', defaults.hero.secondaryCta.label, true],
      ['section[data-website-image="finalCta.imageUrl"]', defaults.finalCta.primaryCta.label, true],
    ]) {
      const link = frame.locator(`[data-vrf-desktop] ${container}`).getByRole('link', { name: linkLabel, exact: false }).first();
      await expect(link).toBeVisible();
      const href = await link.getAttribute('href');
      // The descendant cases deliberately exercise bubbling/native activation,
      // not coordinate hit-testing through the floating editing panel.
      if (descendant) await link.locator('span').last().dispatchEvent('click', { bubbles: true, cancelable: true });
      else await link.click({ position: { x: 5, y: 8 } });
      await expect(editor.getByRole('button', { name: 'Return to VRF', exact: true })).toBeVisible({ timeout: 10000 });
      const child = editor.frames().find((item) => item.parentFrame());
      assert.equal(new URL(child.url()).pathname.replace(/\/$/, ''), '/contact');
      assert.equal(new URL(child.url()).search, new URL(href, origin).search);
      await expect(editor.getByRole('region', { name: 'Content editing panel' })).toHaveCount(0);
      await editor.getByRole('button', { name: 'Return to VRF', exact: true }).click();
      await expect(frame.locator('[data-vrf-desktop] [data-website-text="hero.title"]')).toHaveText(defaults.hero.title);
      report.checks.push(`${name}: ${container} ${linkLabel} (${descendant ? 'descendant event' : 'pointer'}) preserves navigation`);
    }
    await frame.locator('[data-vrf-desktop] section[data-website-image="hero.imageUrl"]').click({ position: { x: 850, y: 200 } });
    await expect(editor.getByRole('heading', { name: 'Hero image', exact: true })).toBeVisible();
    await frame.locator('[data-vrf-desktop] [data-website-text="hero.title"]').click();
    await expect(editor.getByRole('heading', { name: 'Hero title', exact: true })).toBeVisible();
    await editor.screenshot({ path: path.join(output, `${name}-navigation-verified.png`) });
    report.checks.push(`${name}: background and title remain directly selectable after route round trips`);
    assert.deepEqual(report.mutations, []); assert.deepEqual(report.errors, []);
  } catch (error) {
    await editor?.screenshot({ path: path.join(output, `${name}-navigation-failure.png`) }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}
(async () => {
  try {
    for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]]) {
      const browser = await engine.launch(); try { await run(browser, name); } finally { await browser.close(); }
    }
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = String(error.stack || error); process.exitCode = 1; }
  finally { fs.writeFileSync(path.join(output, 'navigation-review.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2)); }
})();
