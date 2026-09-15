/* Read-only browser acceptance for the actual exported VRF route. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium, webkit } = createRequire('/tmp/vrf-browser/package.json')('playwright');
const output = path.resolve('.vrf-mobile-artifacts');
fs.mkdirSync(output, { recursive: true });
const url = process.env.VRF_REVIEW_URL || 'http://127.0.0.1:4173/services/vrf-systems/';
const report = { route: url, checks: [], imageChecks: [], stickyChecks: [], publicConfigReads: [], desktop: null };

async function configureLocalPublicConfigRead(context) {
  const origin = new URL(url).origin;
  if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) return;
  // The export is tested on localhost, not its deployed origin. WebKit reports
  // the public footer config's CORS rejection as a page error even though its
  // existing loader catches failed reads. Proxy only this exact PUBLIC JSON GET
  // with its real upstream body/status and a localhost CORS header. No fixtures,
  // authenticated requests, Firebase writes or production settings are changed.
  await context.route((requestUrl) => requestUrl.hostname === 'firebasestorage.googleapis.com'
    && requestUrl.pathname === '/v0/b/demac-corporation.firebasestorage.app/o/public-website%2Fconfig%2Fpublished.json'
    && requestUrl.searchParams.get('alt') === 'media', async (route) => {
    assert.equal(route.request().method(), 'GET', 'Public configuration review is read-only');
    const response = await route.fetch({ timeout: 30000 });
    report.publicConfigReads.push({ status: response.status(), localOriginCorsProxy: true });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': origin } });
  });
}

async function recordImages(page, root) {
  return root.locator('[role="img"][style*="background-image"]:visible').evaluateAll(async (nodes) => {
    const results = [];
    for (const node of nodes) {
      const urls = [...getComputedStyle(node).backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
      const candidates = await Promise.all(urls.map((src) => new Promise((resolve) => {
        const image = new Image();
        const timer = setTimeout(() => resolve({ src, ok: false, reason: 'timeout' }), 12000);
        image.onload = () => { clearTimeout(timer); resolve({ src, ok: image.naturalWidth > 0, width: image.naturalWidth, height: image.naturalHeight }); };
        image.onerror = () => { clearTimeout(timer); resolve({ src, ok: false, reason: 'load-error' }); };
        image.src = src;
      })));
      results.push({ label: node.getAttribute('aria-label'), candidates, usable: candidates.some((c) => c.ok) });
    }
    return results;
  });
}

async function reviewStickyNavigation(page, root, name) {
  const nav = root.getByRole('navigation', { name: 'Explore VRF solutions' });
  // A Playwright click can scroll a tab into the viewport without passing the
  // navigation's natural position. Explicitly cross that threshold before
  // asserting sticky behavior; preserve the original two-pixel tolerance.
  for (const id of ['systems', 'indoors', 'services']) {
    const target = await root.locator(`#vrf-mobile-${id}`).evaluate((node) => {
      const top = node.getBoundingClientRect().top + window.scrollY + 100;
      window.scrollTo({ top, behavior: 'instant' });
      return top;
    });
    await page.waitForFunction((top) => Math.abs(window.scrollY - top) <= 2, target, { timeout: 5000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const metrics = await nav.evaluate((node) => ({ top: node.getBoundingClientRect().top, position: getComputedStyle(node).position, scrollY: window.scrollY }));
    report.stickyChecks.push({ name, section: id, ...metrics });
    assert.equal(metrics.position, 'sticky', 'Section navigation uses sticky positioning');
    assert(Math.abs(metrics.top) <= 2, `Section navigation stays reachable on scroll: ${JSON.stringify(metrics)}`);
  }
}

async function mobileReview(browser, name, width, height, interactions) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await configureLocalPublicConfigRead(context);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    const root = page.locator('[data-vrf-mobile]');
    assert(await root.isVisible(), `${name}: mobile presentation is visible`);
    assert(!(await page.locator('[data-vrf-desktop]').isVisible()), `${name}: desktop presentation is hidden`);
    assert.equal(await page.locator('h1:visible').count(), 1, 'Only one accessible/visible H1');
    const dimensions = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
    assert(dimensions.scroll <= dimensions.width + 1, `${name}: horizontal page overflow ${JSON.stringify(dimensions)}`);
    const units = root.locator('#vrf-mobile-indoors details');
    const [first, second] = await Promise.all([units.nth(0).boundingBox(), units.nth(1).boundingBox()]);
    assert(first && second && Math.abs(first.y - second.y) <= 1 && second.x > first.x, `${name}: indoor units must not stack into one column`);
    const tabs = root.locator('[aria-label="Choose your VRF system"] [role="tab"]');
    assert.equal(await tabs.count(), 3, 'All three approved system choices remain available');
    const taps = await root.locator('button:visible').evaluateAll((nodes) => nodes.filter((n) => n.getBoundingClientRect().height < 43).map((n) => ({ text: n.textContent, height: n.getBoundingClientRect().height })));
    assert.deepEqual(taps, [], 'Mobile buttons have at least 44px tap height');
    if (interactions) {
      for (let index = 0; index < 3; index++) {
        await tabs.nth(index).click();
        assert.equal(await tabs.nth(index).getAttribute('aria-selected'), 'true');
        assert(await root.locator(`#vrf-system-panel-${index}`).isVisible());
        assert.equal(await root.locator('[id^="vrf-system-panel-"]:visible').count(), 1);
        const checked = await recordImages(page, root.locator(`#vrf-system-panel-${index}`));
        report.imageChecks.push(...checked);
        assert(checked.length && checked.every((item) => item.usable), `System ${index + 1} image must actually decode`);
      }
      await tabs.nth(0).focus();
      await page.keyboard.press('ArrowRight');
      assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true', 'Arrow key tab navigation');
      await page.keyboard.press('Home');
      for (let index = 0; index < await units.count(); index++) {
        await units.nth(index).locator('summary').click();
        assert.equal(await units.nth(index).getAttribute('open'), '', 'Indoor detail opens');
        assert(await units.nth(index).locator('p').isVisible(), 'Indoor description remains available');
        await units.nth(index).locator('summary').click();
      }
      const process = root.locator('[aria-label="Explore the project process"] [role="tab"]');
      for (let index = 0; index < await process.count(); index++) {
        await process.nth(index).click();
        assert(await root.locator(`#vrf-step-panel-${index}`).isVisible());
      }
      const service = root.locator('#vrf-mobile-services details').first();
      await service.locator('summary').click();
      assert(await service.locator('p').isVisible());
      await service.locator('summary').click();
      const faq = root.locator('#vrf-mobile-faq details').first();
      await faq.locator('summary').click();
      assert(await faq.locator('p').isVisible(), 'FAQ works');
      await faq.locator('summary').click();
      await root.getByRole('button', { name: 'Next building types', exact: true }).click();
      assert(await root.locator('#vrf-building-rail').evaluate((node) => node.scrollLeft > 0), 'Building rail moves horizontally');
      await root.locator('#vrf-building-rail').evaluate((node) => { node.scrollLeft = 0; });
      await process.nth(0).click();
      await tabs.nth(0).click();
    }
    await reviewStickyNavigation(page, root, name);
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, `${name}-hero.png`) });
    if (interactions) {
      await page.screenshot({ path: path.join(output, `${name}-full.png`), fullPage: true });
      for (const id of ['systems', 'indoors', 'buildings', 'services', 'faq']) {
        await page.locator(`#vrf-mobile-${id}`).evaluate((node) => { scrollTo({ top: node.getBoundingClientRect().top + scrollY - 65, behavior: 'instant' }); });
        await page.waitForTimeout(200);
        await page.screenshot({ path: path.join(output, `${name}-${id}.png`) });
      }
    }
    assert.deepEqual(errors, [], `No uncaught JavaScript errors: ${name}`);
    report.checks.push({ name, width, height, scrollHeight: dimensions.height, passed: true, interactions });
  } finally {
    await page.screenshot({ path: path.join(output, `${name}-last-state.png`) }).catch(() => {});
    await context.close();
  }
}

(async () => {
  const chrome = await chromium.launch();
  const safari = await webkit.launch();
  try {
    for (const width of [320, 360, 390, 412, 430, 600, 767]) await mobileReview(chrome, `chromium-${width}`, width, 844, width === 390);
    await mobileReview(safari, 'webkit-iphone-390', 390, 844, true);
    const context = await chrome.newContext({ viewport: { width: 1440, height: 1000 } });
    await configureLocalPublicConfigRead(context);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    assert(!(await page.locator('[data-vrf-mobile]').isVisible()), 'Mobile UI must not appear on desktop');
    assert(await page.locator('[data-vrf-desktop]').isVisible(), 'Approved desktop renderer remains');
    assert.equal(await page.locator('h1:visible').count(), 1);
    await page.screenshot({ path: path.join(output, 'desktop-1440.png'), fullPage: true });
    report.desktop = { passed: true, width: 1440, visibleH1: 1 };
    await context.close();
    fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = String(error.stack || error);
    fs.writeFileSync(path.join(output, 'review.json'), JSON.stringify(report, null, 2));
    console.error(error);
    process.exitCode = 1;
  } finally { await chrome.close(); await safari.close(); }
})();
