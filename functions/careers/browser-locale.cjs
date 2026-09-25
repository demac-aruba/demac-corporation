'use strict';
// Additional real-browser journey using only the caller's demo authorities.
const assert = require('node:assert/strict');
const path = require('node:path');
const flow = require('../../apps/erp-next/scripts/careers-question-driver.cjs');
module.exports = async function verifySpanishCandidate({ browser, makeContext, job, site, output, name, service, db, collections }) {
  const ctx = await makeContext(browser, false, { width: 390, height: 844 });
  const page = await ctx.newPage(), errors = [];
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.dismiss());
  const email = `spanish-${name}@example.test`;
  const shot = async suffix => {
    await page.screenshot({ path: path.join(output, `${name}-es-${suffix}.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Spanish candidate view must not overflow');
  };
  try {
    await page.goto(`${site}/careers/?lang=es`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: `Ver ${job.translations.es.title}`, exact: true }).click();
    await page.getByRole('button', { name: 'Aplicar ahora', exact: true }).click();
    await page.getByRole('heading', { name: '¿Cuál es tu nombre?', exact: true }).waitFor();
    await flow.details(page, { first: '  María  ', last: `Spanish ${name}`, email, nationality: 'CO' });
    await page.locator('#totalExperience').fill('6'); await flow.next(page);
    await page.locator('#relevantExperience').fill('3'); await flow.next(page);
    await page.getByRole('heading', { name: '¿Has trabajado con sistemas VRF?', exact: true }).waitFor();
    const yes = page.getByLabel('Sí', { exact: true });
    await yes.check(); assert.equal(await yes.inputValue(), 'Yes', 'Spanish label keeps the canonical Yes value');
    await flow.next(page);
    const date = page.getByLabel('Fecha de inicio más temprana', { exact: true });
    assert.equal(await date.getAttribute('type'), 'date'); await date.fill('2026-10-01'); await flow.next(page);
    const url = page.getByLabel('URL del portafolio', { exact: true });
    assert.equal(await url.getAttribute('type'), 'url'); await url.fill('javascript:alert(1)');
    await page.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.getByText('Escribe una dirección web válida que comience por http o https.', { exact: true }).waitFor();
    await shot('01-url-error');
    await url.fill('https://example.test/spanish-portfolio'); await flow.next(page);
    await page.locator('#languages').getByLabel('Inglés', { exact: true }).check();
    await page.locator('#languages').getByLabel('Español', { exact: true }).check(); await flow.next(page);
    await page.locator('#availability').getByLabel('Dentro de 2 semanas', { exact: true }).check(); await flow.next(page);
    const png = await require('sharp')({ create: { width: 64, height: 64, channels: 3, background: '#cbddee' } }).png().toBuffer();
    await page.locator('#photo').setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: png });
    await page.getByText('Foto seleccionada para revisión', { exact: true }).waitFor();
    await page.locator('#cv').setInputFiles({ name: 'cv-prueba.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% QA only\n%%EOF') });
    await page.getByRole('button', { name: 'Revisar solicitud', exact: true }).click();
    await page.getByRole('heading', { name: 'Revisa tu solicitud', exact: true }).waitFor();
    await page.getByText('Inglés, Español', { exact: true }).waitFor();
    await page.getByText('Dentro de 2 semanas', { exact: true }).waitFor();
    await page.getByText('Aviso de privacidad de reclutamiento', { exact: true }).click();
    // Existing policy prose has no locale metadata. Never silently translate it.
    await page.getByText('El aviso de privacidad se muestra en su versión original configurada; su versión española revisada aún está pendiente.', { exact: true }).waitFor();
    await page.getByText('QA notice for emulator tests only. Never a live policy.', { exact: true }).waitFor();
    await page.locator('#privacy').check(); await shot('02-review');
    const saveResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/careersPublic') && response.request().postDataJSON()?.action === 'application.submit');
    await page.getByRole('button', { name: 'Enviar solicitud', exact: true }).click();
    const response = await saveResponse, result = await response.json();
    assert.equal(response.status(), 200); assert.equal(result.ok, true);
    const submitted = response.request().postDataJSON().payload;
    assert.equal(submitted.localeAtSubmit, 'es');
    assert.equal(submitted.presentationVersion, require('./submission-contract').PRESENTATION_VERSION);
    assert.equal(result.result.localeAtSubmit, 'es');
    await page.getByRole('heading', { name: '¡Solicitud recibida!', exact: true }).waitFor();
    await page.getByText('Tu solicitud está guardada. El envío de la solicitud no confirma la entrega del correo.', { exact: true }).waitFor();
    await shot('03-received');
    await ctx.close();
    const matches = await db.collection(collections.applications).where('profile.email', '==', email).get();
    assert.equal(matches.size, 1, 'one candidate record after Spanish submission');
    const saved = await service.getApplication('qa-admin', matches.docs[0].id);
    assert.equal(saved.profile.givenName, 'María');
    assert.deepEqual(saved.profile.languages, ['English', 'Spanish']);
    assert.equal(saved.profile.availability, 'Within 2 weeks');
    for (const q of job.questions) {
      assert.equal(saved.profile.answers[q.id], q.kind === 'yesno' ? 'Yes' : q.kind === 'date' ? '2026-10-01' : 'https://example.test/spanish-portfolio');
    }
    assert.equal(saved.submissionSnapshot.localeAtSubmit, 'es');
    assert.equal(saved.submissionSnapshot.fields.find(row => row.id === 'profile:givenName').value, '  María  ');
    assert.equal(saved.submissionSnapshot.questions[0].label, job.translations.es.questions[0].label);
    assert.equal(saved.submissionSnapshot.questions[0].value, 'Yes');
    assert.equal(saved.documents.length, 2);
    // Fresh authorized admin context proves snapshot rendering after the candidate closes.
    const admin = await makeContext(browser, true, { width: 1440, height: 1000 });
    try {
      const office = await admin.newPage(); office.setDefaultTimeout(15000);
      office.on('pageerror', error => errors.push(error.message));
      await office.goto(`${site}/recruitment/?tab=applicants&candidate=${saved.id}`, { waitUntil: 'domcontentloaded' });
      await office.locator('[data-submitted-locale="es"]').waitFor();
      assert.equal(await office.locator('[data-submitted-question="profile:givenName"] dd').textContent(), '  María  ');
      await office.getByRole('heading', { name: 'Role answers', exact: true }).waitFor();
      await office.screenshot({ path: path.join(output, `${name}-es-04-original-expedient.png`), fullPage: true });
      await office.reload({ waitUntil: 'domcontentloaded' });
      await office.locator('[data-submitted-locale="es"]').waitFor();
      assert.equal(await office.locator('[data-submitted-question="profile:givenName"] dd').textContent(), '  María  ');
    } finally { await admin.close(); }
    assert.deepEqual(errors, []);
    return ['Spanish public form from an admin-authored vacancy', 'Spanish date/URL validation and selected-option labels', 'original configured privacy notice, not invented translation', 'Spanish receipt follows actual committed emulator submission', 'canonical option values and private documents persist after closing the browser'];
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${name}-es-FAIL.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await ctx.close().catch(() => {}); }
};
