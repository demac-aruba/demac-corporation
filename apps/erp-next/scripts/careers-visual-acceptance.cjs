/* Actual Next export, with existing acceptance checks retained.
   Fictional fixtures only; block all external HTTP/S, including production. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, webkit, firefox } = require('playwright');
const output = process.env.CAREERS_TEST_OUTPUT || path.join(process.cwd(), 'careers-ui-results');
const flow = require('./careers-question-driver.cjs');
const base = process.env.CAREERS_TEST_URL || 'http://127.0.0.1:4173';
const testOrigin = new URL(base).origin;
fs.mkdirSync(output, { recursive: true });
const matrix = [
  { name: 'chromium-390', type: chromium, width: 390, height: 844, touch: true },
  { name: 'chromium-320', type: chromium, width: 320, height: 740, touch: true },
  { name: 'chromium-desktop', type: chromium, width: 1366, height: 900 },
  { name: 'webkit-390', type: webkit, width: 390, height: 844, touch: true },
  { name: 'webkit-desktop', type: webkit, width: 1440, height: 900 },
  { name: 'firefox-desktop-dark', type: firefox, width: 1366, height: 900, dark: true },
];
function isLocalResource(raw) {
  const url = new URL(raw);
  if (url.protocol === 'blob:') return new URL(url.pathname).origin === testOrigin;
  if (url.protocol === 'data:') return /^data:image\/(png|jpeg|webp);base64,/i.test(raw);
  return url.origin === testOrigin;
}
assert.equal(isLocalResource('https://example.com/test'), false);
assert.equal(isLocalResource('blob:https://example.com/test'), false);
assert.equal(isLocalResource(`blob:${base}/test`), true);
const report = [];
(async () => {
  for (const test of matrix) {
    const browser = await test.type.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: test.width, height: test.height }, isMobile: !!test.touch, hasTouch: !!test.touch, colorScheme: test.dark ? 'dark' : 'light', reducedMotion: 'reduce' });
    const blocked = [];
    await context.route('**/*', route => {
      const raw = route.request().url();
      if (isLocalResource(raw)) return route.continue();
      blocked.push(raw); return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.dismiss());
    const checks = [];
    const check = (condition, description) => { assert.ok(condition, `${test.name}: ${description}`); checks.push(description); };
    async function shot(name) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
      await page.screenshot({ path: path.join(output, `${test.name}-${name}.png`), fullPage: true, animations: 'disabled' });
      const dims = await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth }));
      check(dims.scroll <= dims.width + 1, `no horizontal overflow: ${name}`);
      const icons = await page.locator('svg[data-career-icon]').evaluateAll(elements => elements.filter(el => el.getClientRects().length).map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
      check(icons.every(d => d.width > 0 && d.width <= 32 && d.height > 0 && d.height <= 32), `every visible Careers icon stays bounded: ${name}`);
    }
    try {
      const response = await page.goto(`${base}/careers/`, { waitUntil: 'networkidle' });
      check(response.status() === 200, 'compiled careers route returns HTTP 200');
      await page.locator('[data-careers-version="premium-v3"]').waitFor();
      await page.getByRole('button', { name: 'View VRF Specialist', exact: true }).waitFor();
      check(await page.getByRole('button', { name: /^View / }).count() === 9, 'nine preview vacancies');
      const ribbon = await page.locator('details').filter({ has: page.locator('summary', { hasText: 'Review tools' }) }).evaluate(el => el.parentElement.getBoundingClientRect().height);
      check(ribbon <= 52, 'preview ribbon stays compact');
      if (test.width >= 380 && test.width <= 760) {
        const cards = await page.getByRole('article').evaluateAll(items => items.map(item => {
          const title = item.querySelector('h2').getBoundingClientRect();
          const button = item.querySelector('button').getBoundingClientRect();
          return { separated: title.right <= button.left, aligned: Math.max(title.top, button.top) < Math.min(title.bottom, button.bottom), target: button.width >= 44 && button.height >= 44 };
        }));
        check(cards.length === 9 && cards.every(card => card.separated && card.aligned && card.target), 'compact phone cards pair each title with its touch-sized action without overlap');
      }
      await shot('01-jobs');
      await page.getByRole('button', { name: 'View VRF Specialist', exact: true }).click();
      await page.getByRole('heading', { name: 'VRF Specialist', exact: true }).waitFor();
      check(await page.locator('dt').filter({ hasText: /^Location$/ }).count() === 1, 'job facts and icons are rendered');
      await shot('02-role');
      await page.getByRole('button', { name: 'Apply now', exact: true }).click();
      await flow.question(page, 'profile:givenName');
      check(await page.getByRole('button', { name: 'Step 3: Documents & review', exact: true }).isDisabled(), 'future steps cannot bypass validation');
      const circle = await page.locator('[data-step-state="active"] > span').evaluate(el => ({ radius: getComputedStyle(el).borderRadius, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height }));
      check(circle.radius === '50%' && circle.width === circle.height && circle.width >= 44, 'active step is a touch-sized circle');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByText('Enter your first name.', { exact: true }).waitFor();
      check(await page.locator('#givenName').getAttribute('aria-invalid') === 'true', 'missing details produce field errors');
      await shot('03-details-error');
      await flow.details(page, { customCode: true, nationality: 'CO' });
      await page.locator('#totalExperience').fill('8'); await flow.next(page);
      await flow.question(page, 'profile:relevantExperience'); await page.locator('#relevantExperience').fill('5');
      await shot('04a-experience-number'); await flow.next(page);
      await flow.question(page, 'role:brands');
      const multiUrl = page.url();
      await page.locator('#q-brands').getByLabel('Daikin', { exact: true }).check();
      check(page.url() === multiUrl && await page.locator('[data-career-question]').count() === 1, 'multiselect does not auto-advance or display a second question');
      await shot('04b-experience-multiselect'); await flow.next(page);
      await flow.question(page, 'role:commissioning'); await page.locator('#q-commissioning').getByLabel('Yes', { exact: true }).check(); await flow.next(page);
      await flow.question(page, 'role:commissioning-detail'); await page.locator('#q-commissioning-detail').fill('Fictional commissioning work for UI testing.'); await flow.next(page);
      await flow.question(page, 'role:drawings'); await page.locator('#q-drawings').getByLabel('Yes', { exact: true }).check(); await flow.next(page);
      await flow.question(page, 'role:certification'); await flow.next(page);
      await flow.question(page, 'profile:languages'); await page.locator('#languages').getByLabel('English', { exact: true }).check(); await flow.next(page);
      await flow.question(page, 'profile:availability'); await page.locator('#availability').getByLabel('Within 2 weeks', { exact: true }).check();
      await shot('04c-availability-separate');
      check(await page.locator('[data-step-state="complete"] svg').count() === 1, 'completed step has a check');
      await page.getByRole('button', { name: /Step 1: Your details/ }).click();
      await flow.question(page, 'profile:givenName');
      check(await page.locator('#givenName').inputValue() === 'Preview', 'back navigation preserves contact details');
      await flow.walkTo(page, 'profile:phone');
      const customCode = page.getByLabel('Other country calling code', { exact: true });
      check((await customCode.count() ? await customCode.inputValue() : await page.locator('#dialCode').inputValue()) === '+1', 'custom country code survives navigation');
      await flow.walkTo(page, 'role:commissioning-detail');
      check(await page.locator('#q-commissioning-detail').inputValue() === 'Fictional commissioning work for UI testing.', 'conditional answers survive navigation');
      await shot('04d-experience-text');
      await page.getByRole('button', { name: /Step 3: Documents & review/ }).click();
      await page.getByRole('heading', { name: 'Photo & documents', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Review application', exact: true }).click();
      await page.getByText('Add a recent photo for your profile.', { exact: true }).waitFor();
      check(true, 'required photo prevents continuing');
      const iconDimensions = await page.locator('label > svg').evaluateAll(elements => elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
      check(iconDimensions.length >= 4 && iconDimensions.every(d => d.width >= 16 && d.width <= 24 && d.height >= 16 && d.height <= 24), 'file control icons remain compact despite shared illustration CSS');
      await shot('05-documents-empty');
      const image = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 96; c.height = 96; const ctx = c.getContext('2d'); ctx.fillStyle = '#deedfb'; ctx.fillRect(0, 0, 96, 96); ctx.fillStyle = '#23558c'; ctx.font = '40px sans-serif'; ctx.fillText('QA', 16, 60); return c.toDataURL('image/png').split(',')[1]; });
      await page.locator('#photo').setInputFiles({ name: 'qa-photo.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
      await page.getByAltText('Your selected profile photo').waitFor();
      await page.getByText('Photo selected for review', { exact: true }).waitFor();
      await page.locator('#cv').setInputFiles({ name: 'preview-cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% QA fixture, not an actual CV\n%%EOF') });
      check(await page.locator('#supporting-files').getAttribute('accept') === null, 'supporting files use general file picker, not photo-only selector');
      check(await page.locator('#supporting-files').getAttribute('capture') === null, 'file chooser does not force camera');
      check(await page.getByLabel('Photograph a document', { exact: true }).getAttribute('capture') === 'environment', 'document camera is a separate action');
      await page.locator('#supporting-files').setInputFiles({ name: 'a-long-preview-certificate-name-for-mobile-layout-testing.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% Test certificate\n%%EOF') });
      check(await page.locator('[data-file-state="selected"]').count() === 2, 'both files show true selected-for-review status');
      await shot('06-documents-ready');
      await page.getByRole('button', { name: 'Review application', exact: true }).click();
      await page.getByRole('heading', { name: 'Review your application', exact: true }).waitFor();
      check(!(await page.getByLabel(/Keep my profile for future openings/).isChecked()), 'future opportunities opt-in starts unchecked');
      await page.getByRole('button', { name: 'Edit How many years of experience are relevant to this role?', exact: true }).click();
      await flow.question(page, 'profile:relevantExperience');
      await page.locator('#relevantExperience').fill('4.5');
      await page.getByRole('button', { name: 'Return to review', exact: true }).click();
      await page.getByRole('heading', { name: 'Review your application', exact: true }).waitFor();
      check(await page.locator('dd').filter({ hasText: /^4\.5$/ }).count() === 1, 'editing returns directly to review with the revised answer');
      await page.locator('#privacy').check();
      await shot('07-review');
      await page.getByRole('button', { name: 'Submit preview application', exact: true }).click();
      await page.getByRole('heading', { name: 'Application completed', exact: true }).waitFor();
      check(await page.getByText('PREVIEW-0001', { exact: true }).count() === 1, 'one confirmation reference');
      check(await page.getByText(/No email has been sent/).count() === 1, 'success does not fabricate email delivery');
      await shot('08-complete');
      await page.locator('summary').filter({ hasText: 'Review tools' }).click();
      await page.getByRole('button', { name: 'Review this candidate', exact: true }).click();
      await page.locator('#profile-stage').selectOption('Interview');
      await page.locator('#recruiter-note').fill('Test note. Verify the new mobile presentation.');
      await page.getByRole('button', { name: 'Save preview note', exact: true }).click();
      await page.getByText('Test note. Verify the new mobile presentation.', { exact: true }).waitFor();
      await shot('09-profile');
      await page.getByRole('button', { name: '← All applicants', exact: true }).click();
      check(await page.getByText('1 matching preview application', { exact: true }).count() === 1, 'applicant list agrees with completed application');
      await shot('10-applicants');
      await page.getByRole('button', { name: /^Vacancies/ }).click();
      await shot('11-vacancies');
      await page.getByRole('button', { name: 'Edit vacancy & questions →', exact: true }).first().click();
      await shot('12-editor');
      check(errors.length === 0, `no uncaught JavaScript errors (${errors.join('; ')})`);
      report.push({ scenario: test.name, browserVersion: browser.version(), result: 'PASS', checks });
      console.log(`PASS ${test.name}: ${checks.length} checks`);
    } catch (error) {
      await page.screenshot({ path: path.join(output, `${test.name}-FAIL.png`), fullPage: true }).catch(() => {});
      report.push({ scenario: test.name, result: 'FAIL', error: String(error), pageErrors: errors, blockedRequests: blocked, visibleAlerts: await page.getByRole('alert').allTextContents(), checks });
      console.error(`FAIL ${test.name}: ${error.stack}`);
    } finally { await context.close(); await browser.close(); fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); }
  }
  if (report.some(test => test.result !== 'PASS')) process.exitCode = 1;
  console.log('Browser emulation is not real Samsung, iPhone or Mac hardware certification. Native OS file picker remains a real-device check.');
})().catch(error => { console.error(error); process.exitCode = 1; });
