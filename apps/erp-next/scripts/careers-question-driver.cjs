'use strict';
// Browser-only test helpers. Every transition uses the real UI and its validator.
const assert = require('node:assert/strict');
async function question(page, id) {
  await page.locator(`[data-career-question="${id}"]`).waitFor();
  assert.equal(await page.locator('[data-career-question]').count(), 1, 'exactly one conceptual question is mounted');
  assert.equal(new URL(page.url()).searchParams.get('question'), id, 'stable question ID is reflected by the shared router');
}
async function label(page, english, spanish) { return await page.locator('html').getAttribute('lang') === 'es' ? spanish : english; }
async function next(page) {
  const before = page.url();
  await page.getByRole('button', { name: await label(page, 'Continue', 'Continuar'), exact: true }).click();
  await page.waitForFunction(previous => window.location.href !== previous, before);
}
async function walkTo(page, id) {
  for (let index = 0; index < 45; index++) {
    if (new URL(page.url()).searchParams.get('question') === id) return question(page, id);
    await next(page);
  }
  throw new Error(`Could not reach question ${id}`);
}
async function details(page, values = {}) {
  const fields = { first: 'Preview', last: 'Candidate', email: 'candidate@example.test', nationality: 'AW', ...values };
  await question(page, 'profile:givenName'); await page.locator('#givenName').fill(fields.first); await next(page);
  await question(page, 'profile:familyName'); await page.locator('#familyName').fill(fields.last); await next(page);
  await question(page, 'profile:email'); await page.locator('#email').fill(fields.email); await next(page);
  await question(page, 'profile:phone');
  await page.locator('#dialCode').selectOption(values.customCode ? 'other' : '+1');
  if (values.customCode) await page.getByLabel(await label(page, 'Other country calling code', 'Otro código telefónico internacional'), { exact: true }).fill('+1');
  await page.locator('#phone').fill('2025550101'); await next(page);
  await question(page, 'profile:whatsapp'); await page.locator('#whatsapp').getByLabel(await label(page, 'Yes', 'Sí'), { exact: true }).check(); await next(page);
  await question(page, 'profile:nationality'); await page.locator('#nationality').selectOption(fields.nationality); await next(page);
  await question(page, 'profile:applyingFrom'); await page.locator('#applyingFrom').selectOption('AW'); await next(page);
  await question(page, 'profile:sameResidence'); await page.locator('#sameResidence').getByLabel(await label(page, 'Yes', 'Sí'), { exact: true }).check(); await next(page);
  await question(page, 'profile:city'); await page.locator('#city').fill('Test city'); await next(page);
  await question(page, 'profile:totalExperience');
}
module.exports = { question, next, walkTo, details, label };
