'use strict';
// Test the actual static production build with intake OFF. No accounts or real data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, firefox } = require('playwright');
const base = process.env.CAREERS_MENU_TEST_URL || 'http://127.0.0.1:4176';
assert.equal(new URL(base).hostname, '127.0.0.1', 'Tests only run against the local compiled site.');
const out = path.resolve('careers-menu-results');
fs.mkdirSync(out, { recursive: true });
const expected = ['Home', 'About Us', 'Services', 'Projects', 'Industries We Serve', 'Careers', 'Contact'];
const hrefs = ['/', '/about', '/services', '/project-gallery', '/#industries', '/careers', '/contact'];
const engines = { chromium, webkit, firefox };
const scenarios = [
  ...[320, 390, 768, 1024, 1041, 1120, 1180, 1280, 1366, 1649, 1920].map(width => ({ engine: 'chromium', width })),
  { engine: 'webkit', width: 390 }, { engine: 'webkit', width: 1366 },
  { engine: 'firefox', width: 1366 },
];
const results = [];
async function linkList(locator, wanted, wantedHrefs) {
  const links = await locator.locator('a').evaluateAll(items => items.map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') })));
  assert.deepEqual(links.map(a => a.text), wanted, 'Careers must be immediately before Contact without changing the existing order.');
  const normalized = links.map(a => a.href.replace(/\/(\?|#|$)/g, '$1') || '/');
  const expectedHrefs = wantedHrefs.map(href => href.replace(/\/(\?|#|$)/g, '$1') || '/');
  assert.deepEqual(normalized, expectedHrefs, 'Existing destinations must not change.');
}
async function currentMenu(page) {
  const desktop = page.locator('.public-header .public-nav');
  if (await desktop.isVisible()) return desktop;
  const menu = page.locator('.public-header .public-mobile-menu');
  if (await menu.getAttribute('open') === null) await menu.locator('summary').click();
  return menu.locator('div').first();
}
async function geometry(page) {
  const measured = await page.evaluate(() => {
    const box = element => { const r = element.getBoundingClientRect(); return { label: element.textContent.trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
    const nav = document.querySelector('.public-header .public-nav');
    const visible = nav && getComputedStyle(nav).display !== 'none';
    const items = visible ? [document.querySelector('.public-header .public-brand'), ...nav.querySelectorAll('a'), ...document.querySelectorAll('.public-header-actions a')].map(box) : [];
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, items };
  });
  assert(measured.scrollWidth <= measured.width + 1, `Horizontal overflow: ${JSON.stringify(measured)}`);
  for (let i = 0; i < measured.items.length; i++) {
    const box = measured.items[i];
    assert(box.left >= 0 && box.right <= measured.width, `Header item outside viewport: ${JSON.stringify(measured)}`);
    if (i) assert(measured.items[i - 1].right <= box.left + 1, `Header overlap: ${JSON.stringify(measured)}`);
  }
  return measured;
}
async function availability(page) {
  await page.locator('[data-careers-availability]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('h1').innerText(), 'Careers');
  assert.equal(await page.locator('#careers-availability-title').innerText(), 'Applications are not open yet.');
  assert.equal(await page.locator('form,input,textarea,select').count(), 0, 'Do not expose a candidate form while intake is disabled.');
  assert(!/Preview unavailable|Review tools|Test data only|PREVIEW-0001/i.test(await page.locator('body').innerText()), 'No internal review content on the public destination.');
  assert.equal(await page.locator('.public-nav a[href^="/careers"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.public-mobile-menu a[href^="/careers"]').getAttribute('aria-current'), 'page');
  await geometry(page);
}
(async () => {
  for (const spec of scenarios) {
    const id = `${spec.engine}-${spec.width}`;
    const browser = await engines[spec.engine].launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: spec.width, height: 940 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [], careersCalls = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/\/careers(?:Public|Admin)(?:$|[/?])/.test(url)) careersCalls.push(url);
      return new URL(url).origin === new URL(base).origin ? route.continue() : route.abort();
    });
    try {
      const response = await page.goto(`${base}/`, { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      await linkList(page.locator('.public-header .public-nav'), expected, hrefs);
      await linkList(page.locator('.public-mobile-menu > div'), [...expected, 'Staff Login'], [...hrefs, '/login']);
      await linkList(page.locator('nav[aria-label="Footer quick links"]'), expected, hrefs);
      const header = await geometry(page);
      const menu = await currentMenu(page);
      await page.screenshot({ path: path.join(out, `${id}-01-menu.png`), fullPage: false });
      await menu.getByRole('link', { name: 'Careers', exact: true }).click();
      await page.waitForURL(url => url.pathname === '/careers/' || url.pathname === '/careers');
      await availability(page);
      await page.screenshot({ path: path.join(out, `${id}-02-careers.png`), fullPage: true });
      await page.evaluate(() => history.back());
      await page.waitForURL(url => url.pathname === '/');
      await page.locator('.public-nav a[aria-current="page"]').waitFor({ state: 'attached' });
      await page.evaluate(() => history.forward());
      await availability(page);
      await page.reload({ waitUntil: 'networkidle' });
      await availability(page);
      await (await currentMenu(page)).getByRole('link', { name: 'Contact', exact: true }).click();
      await page.waitForURL(url => url.pathname.replace(/\/$/, '') === '/contact');
      await page.locator('h1').waitFor({ state: 'visible' });
      assert.equal(await page.locator('.public-header .public-nav a[href^="/careers"]').count(), 1);
      await page.locator('nav[aria-label="Footer quick links"]').getByRole('link', { name: 'Careers', exact: true }).click();
      await availability(page);
      assert.deepEqual(careersCalls, [], 'Visibility must not activate Careers services.');
      assert.deepEqual(errors, [], 'No JavaScript errors on public navigation.');
      results.push({ id, status: 'PASS', browserVersion: browser.version(), header, verified: ['desktop/mobile/footer order and destinations', 'anonymous branded landing', 'no form or Careers API access', 'Back/Forward/reload', 'Contact preserved', 'footer navigation', 'layout containment', 'no JavaScript errors'] });
    } catch (error) {
      results.push({ id, status: 'FAIL', error: error.stack, errors });
      await page.screenshot({ path: path.join(out, `${id}-failure.png`), fullPage: true }).catch(() => {});
    } finally { await context.close(); await browser.close(); }
  }
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify({ build: 'production; Careers LIVE/ADMIN off; no real services', results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
  if (results.some(result => result.status !== 'PASS')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
