/* Read-only, real browser image-decoding checks for the owner-approved indoor catalogue. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium, webkit } = createRequire('/tmp/vrf-browser/package.json')('playwright');
const output = path.resolve('.vrf-mobile-artifacts');
fs.mkdirSync(output, { recursive: true });
const url = process.env.VRF_REVIEW_URL || 'http://127.0.0.1:4173/services/vrf-systems/';
const ids = ['cassette', 'fan-coil', 'floor-ceiling', 'air-handler', 'mini-split'];
const report = { route: url, checks: [] };

async function review(browser, name, width, phone) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
  // Match the existing read-only review harness: only adapt localhost CORS for
  // the real PUBLIC footer JSON response, never mock image bytes or ERP data.
  if (new URL(url).hostname === '127.0.0.1') {
    await context.route((u) => u.hostname === 'firebasestorage.googleapis.com' && u.pathname === '/v0/b/demac-corporation.firebasestorage.app/o/public-website%2Fconfig%2Fpublished.json' && u.searchParams.get('alt') === 'media', async (route) => {
      assert.equal(route.request().method(), 'GET');
      const response = await route.fetch({ timeout: 30000 });
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': new URL(url).origin } });
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    const section = page.locator(phone ? '#vrf-mobile-indoors' : '#indoor-unit-options');
    await section.scrollIntoViewIfNeeded();
    const images = section.locator('img[data-vrf-indoor-photo]');
    assert.equal(await images.count(), 5, 'Exactly five product images');
    await images.evaluateAll((nodes) => { for (const image of nodes) image.loading = 'eager'; });
    await page.waitForFunction((selector) => [...document.querySelectorAll(`${selector} img[data-vrf-indoor-photo]`)].every((image) => image.complete && image.naturalWidth > 0), phone ? '#vrf-mobile-indoors' : '#indoor-unit-options', { timeout: 20000 });
    const metrics = await images.evaluateAll(async (nodes) => Promise.all(nodes.map(async (image) => {
      await image.decode();
      const box = image.getBoundingClientRect();
      return { id: image.dataset.vrfIndoorPhoto, width: image.naturalWidth, height: image.naturalHeight, renderedWidth: box.width, renderedHeight: box.height, fit: getComputedStyle(image).objectFit, alt: image.alt, src: image.currentSrc };
    })));
    assert.deepEqual(metrics.map((image) => image.id), ids);
    for (const image of metrics) {
      assert.equal(image.width, 236);
      assert.equal(image.height, 159);
      assert(image.renderedWidth <= image.width + 1 && image.renderedHeight <= image.height + 1, 'Do not enlarge a small image');
      assert.equal(image.fit, 'contain', 'Keep equipment uncropped');
      assert(image.alt.length > 5, 'Meaningful product alt');
    }
    assert.equal(await section.getByText('Mini Split Units', { exact: true }).count(), 1);
    assert.equal(await section.getByText('Split Units', { exact: true }).count(), 0);
    assert.equal(await section.getByText('Wall-Mounted Split Units', { exact: true }).count(), 0);
    const cards = section.locator(phone ? 'details' : '[data-vrf-indoor-grid] > article');
    const boxes = await cards.evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width }; }));
    if (phone) {
      assert(Math.abs(boxes[0].y - boxes[1].y) < 2 && boxes[1].x > boxes[0].x, 'Phone keeps two columns');
      assert(boxes[4].width > boxes[0].width * 1.8, 'Fifth card is balanced across the last row');
      for (let i = 0; i < 5; i++) {
        await cards.nth(i).locator('summary').click();
        assert(await cards.nth(i).locator('p').isVisible(), 'Indoor description expands');
        await cards.nth(i).locator('summary').click();
      }
    } else if (width > 1180) {
      assert(boxes.every((box) => Math.abs(box.y - boxes[0].y) < 2), 'Desktop displays one balanced five-card row');
    }
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal page overflow');
    await section.evaluate((node) => scrollTo({ top: node.getBoundingClientRect().top + scrollY - (innerWidth < 768 ? 64 : 24), behavior: 'instant' }));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(output, `indoor-${name}.png`) });
    await section.screenshot({ path: path.join(output, `indoor-${name}-section.png`) });
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    report.checks.push({ name, width, phone, passed: true, images: metrics });
  } finally {
    await page.screenshot({ path: path.join(output, `indoor-${name}-last.png`) }).catch(() => {});
    await context.close();
  }
}

(async () => {
  const chrome = await chromium.launch();
  const safari = await webkit.launch();
  try {
    for (const width of [320, 390, 430, 767, 1024, 1440]) await review(chrome, `chromium-${width}`, width, width < 768);
    await review(safari, 'webkit-390', 390, true);
  } catch (error) {
    report.error = String(error.stack || error);
    console.error(error);
    process.exitCode = 1;
  } finally {
    fs.writeFileSync(path.join(output, 'indoor-review.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await chrome.close();
    await safari.close();
  }
})();
