/* Regressions for the owner's desktop screenshot and real browser history.
 * Run after the unchanged workflow acceptance scenarios; never contact Firebase.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, firefox } = require('playwright');
const base = process.env.CAREERS_TEST_URL || 'http://127.0.0.1:4173';
const origin = new URL(base).origin;
const output = process.env.CAREERS_TEST_OUTPUT || path.join(process.cwd(), 'careers-ui-results');
fs.mkdirSync(output, { recursive: true });
const matrix = [
  { name: 'desktop-1649', type: chromium, width: 1649, height: 927 },
  { name: 'desktop-1920', type: chromium, width: 1920, height: 1080 },
  { name: 'tablet-1024', type: chromium, width: 1024, height: 768 },
  { name: 'mobile-390', type: chromium, width: 390, height: 844, touch: true },
  { name: 'mobile-320', type: chromium, width: 320, height: 740, touch: true },
  { name: 'webkit-1440', type: webkit, width: 1440, height: 900 },
  { name: 'webkit-390', type: webkit, width: 390, height: 844, touch: true },
  { name: 'firefox-1366', type: firefox, width: 1366, height: 900 },
];
const results = [];
(async () => {
  for (const test of matrix) {
    const browser = await test.type.launch();
    const context = await browser.newContext({ viewport: { width: test.width, height: test.height }, isMobile: !!test.touch, hasTouch: !!test.touch, reducedMotion: 'reduce' });
    await context.route('**/*', route => {
      const u = new URL(route.request().url());
      const local = u.origin === origin || (u.protocol === 'blob:' && new URL(u.pathname).origin === origin) || (u.protocol === 'data:' && /^data:image\/(png|jpeg|webp);base64,/i.test(u.href));
      return local ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = []; const dialogs = []; const checks = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => { dialogs.push(dialog.type()); return dialog.dismiss(); });
    const check = (value, label) => { assert.ok(value, `${test.name}: ${label}`); checks.push(label); };
    const waitHeading = name => page.getByRole('heading', { name, exact: true }).first().waitFor();
    async function shot(name) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(output, `navigation-${test.name}-${name}.png`), fullPage: true });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no viewport overflow`);
    }
    async function factsAreBounded() {
      const facts = await page.locator('[data-career-facts] > div').evaluateAll(items => items.map(item => {
        const box = item.getBoundingClientRect(); const icon = item.querySelector('svg').getBoundingClientRect(); const text = item.querySelector('dd').getBoundingClientRect();
        return { box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height }, icon: { left: icon.left, right: icon.right, width: icon.width, height: icon.height }, text: { left: text.left, right: text.right, width: text.width, top: text.top, bottom: text.bottom } };
      }));
      check(facts.length === 4, 'four fact cards');
      check(facts.every(f => f.icon.width >= 20 && f.icon.width <= 30 && f.icon.height <= 30), 'role icons stay between 20 and 30px, not full-size illustrations');
      check(facts.every(f => f.text.left >= f.icon.right && f.text.right <= f.box.right && f.text.top >= f.box.top && f.text.bottom <= f.box.bottom && f.text.width >= 58), 'all fact labels remain inside their own card without icon/text overlap');
      check(facts.every(f => f.box.height <= 160), 'fact cards do not grow into oversized desktop illustrations');
    }
    try {
      await page.goto(`${base}/careers/`, { waitUntil: 'networkidle' });
      const job = page.getByRole('button', { name: 'View HVAC Technician', exact: true });
      await job.waitFor();
      await job.focus();
      await page.waitForTimeout(100);
      const listScroll = await page.evaluate(() => scrollY);
      await job.click();
      await waitHeading('HVAC Technician');
      check(new URL(page.url()).searchParams.get('role') === 'hvac-technician', 'opening a position creates a distinct URL');
      await factsAreBounded();
      // Reproduce the inherited rule loading after module CSS, as it can on Vercel.
      await page.addStyleTag({ content: '.public-site svg { display:block; width:100%; height:100%; }' });
      await factsAreBounded();
      const back = page.getByRole('button', { name: 'Back to open positions', exact: true });
      check((await back.innerText()).trim() === '' && await back.locator('svg').count() === 1, 'position back control is icon-only with an accessible name');
      check(await back.evaluate(el => el.getBoundingClientRect().width >= 44 && el.getBoundingClientRect().height >= 44), 'back control has a touch-sized target');
      await page.goBack(); await waitHeading('Careers');
      await page.waitForFunction(expected => Math.abs(scrollY - expected) < 5, listScroll);
      check(true, 'browser Back restores catalogue scroll position');
      await page.goForward(); await waitHeading('HVAC Technician');
      check(new URL(page.url()).searchParams.get('role') === 'hvac-technician', 'browser Forward restores the position');
      await back.click(); await waitHeading('Careers');
      await page.goForward(); await waitHeading('HVAC Technician');
      check(true, 'icon Back traverses history instead of adding a duplicate parent page');
      await shot('01-role');
      await page.getByRole('button', { name: 'Apply now', exact: true }).click();
      await waitHeading('Your details');
      check(new URL(page.url()).searchParams.get('step') === 'details', 'application has a URL for its first stage');
      await page.locator('#givenName').fill('Navigation');
      await page.locator('#familyName').fill('Test');
      await page.locator('#email').fill('navigation@example.test');
      await page.locator('#dialCode').selectOption('+1');
      await page.locator('#phone').fill('2025550101');
      await page.locator('#nationality').selectOption('AW');
      await page.locator('#applyingFrom').selectOption('AW');
      await page.locator('#city').fill('Test city');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await waitHeading('Your experience');
      await page.locator('#totalExperience').fill('6');
      await page.locator('#relevantExperience').fill('4');
      await page.locator('#q-systems').getByLabel('Split units', { exact: true }).check();
      await page.locator('#q-drawings').getByLabel('Yes', { exact: true }).check();
      await page.locator('#q-languages').getByLabel('English', { exact: true }).check();
      await page.locator('#availability').selectOption('Immediately');
      await page.goBack(); await waitHeading('Your details');
      check(await page.locator('#email').inputValue() === 'navigation@example.test', 'native Back preserves typed contact information');
      await page.goForward(); await waitHeading('Your experience');
      check(await page.locator('#relevantExperience').inputValue() === '4', 'native Forward preserves experience answers');
      await shot('02-experience');
      await page.getByRole('button', { name: 'Continue', exact: true }).click(); await waitHeading('Photo & documents');
      check(new URL(page.url()).searchParams.get('step') === 'documents', 'documents have a distinct stage URL');
      const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 96; canvas.height = 96; const c = canvas.getContext('2d'); c.fillStyle = '#edf3fa'; c.fillRect(0,0,96,96); c.fillStyle = '#0b2458'; c.font = '28px sans-serif'; c.fillText('TEST',10,55); return canvas.toDataURL().split(',')[1]; });
      await page.locator('#photo').setInputFiles({ name: 'test-photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
      await page.getByAltText('Your selected profile photo').waitFor();
      await page.locator('#cv').setInputFiles({ name: 'test-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% synthetic fixture\n%%EOF') });
      await page.getByRole('button', { name: 'Review application', exact: true }).click(); await waitHeading('Review your application');
      await page.goBack(); await waitHeading('Photo & documents');
      check(await page.getByAltText('Your selected profile photo').count() === 1 && await page.getByText('test-cv.pdf', { exact: true }).count() === 1, 'photo and CV survive native Back from review');
      await page.goForward(); await waitHeading('Review your application');
      await page.getByRole('button', { name: 'Back to documents', exact: true }).click(); await waitHeading('Photo & documents');
      await page.goForward(); await waitHeading('Review your application');
      check(true, 'form icon Back participates in the same browser history');
      await page.locator('#privacy').check();
      await page.getByRole('button', { name: 'Submit preview application', exact: true }).click(); await waitHeading('Application completed');
      const receipt = new URL(page.url()).searchParams.get('receipt');
      check(receipt === 'PREVIEW-0001', 'one receipt is recorded in navigation');
      await page.goBack(); await waitHeading('Review your application');
      check(await page.locator('#privacy').isDisabled(), 'completed application is reviewable, not silently editable or resubmitted by Back');
      await page.getByRole('button', { name: 'View confirmation', exact: true }).click(); await waitHeading('Application completed');
      check(new URL(page.url()).searchParams.get('receipt') === receipt, 'revisiting confirmation does not create another application');
      await page.getByRole('button', { name: 'Review this candidate', exact: true }).click();
      await page.locator('#profile-stage').waitFor();
      await page.goBack(); await waitHeading('Application completed');
      await page.goForward(); await page.locator('#profile-stage').waitFor();
      check(true, 'browser Back and Forward also enter and leave recruitment preview');
      const state = await page.evaluate(() => JSON.stringify(history.state));
      check(!state.includes('navigation@example.test') && !state.includes('2025550101') && !state.includes('data:image') && !state.includes('test-cv.pdf'), 'history state contains no private draft fields or files');
      const direct = await context.newPage();
      await direct.goto(`${base}/about/`, { waitUntil: 'networkidle' });
      await direct.goto(`${base}/careers/?role=vrf-specialist&step=review`, { waitUntil: 'networkidle' });
      await direct.getByRole('heading', { name: 'Your details', exact: true }).waitFor();
      check(new URL(direct.url()).searchParams.get('step') === 'details', 'deep link cannot bypass required form steps');
      await direct.goBack();
      check(new URL(direct.url()).pathname === '/about/', 'initial replaceState does not trap Back inside Careers');
      await direct.goto(`${base}/careers/?role=vrf-specialist`, { waitUntil: 'networkidle' });
      await direct.getByRole('heading', { name: 'VRF Specialist', exact: true }).waitFor();
      await direct.reload({ waitUntil: 'networkidle' });
      await direct.getByRole('heading', { name: 'VRF Specialist', exact: true }).waitFor();
      check(true, 'a direct position URL survives refresh without becoming the catalogue');
      await direct.goto(`${base}/careers/?role=unknown-role`, { waitUntil: 'networkidle' });
      await direct.getByRole('heading', { name: 'Careers', exact: true }).waitFor();
      check(!new URL(direct.url()).searchParams.has('role'), 'unknown role URLs recover to the catalogue');
      await direct.close();
      check(errors.length === 0, `no page errors (${errors.join(';')})`);
      check(dialogs.length === 0, 'internal browser history never triggers a leave-page confirmation');
      results.push({ scenario: test.name, browser: browser.version(), result: 'PASS', checks });
      console.log(`PASS navigation-${test.name}: ${checks.length} checks`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `navigation-${test.name}-FAIL.png`), fullPage: true }).catch(() => {});
      results.push({ scenario: test.name, result: 'FAIL', error: String(error), pageErrors: errors, checks });
      console.error(`FAIL navigation-${test.name}: ${error.stack}`);
    } finally { await context.close(); await browser.close(); fs.writeFileSync(path.join(output, 'navigation-report.json'), JSON.stringify(results, null, 2)); }
  }
  if (results.some(test => test.result !== 'PASS')) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
