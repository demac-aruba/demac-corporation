'use strict';
// Additional real-browser journey using only the caller's demo authorities.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
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
    await page.getByRole('button',{name:'Revisar solicitud',exact:true}).click();
    await page.getByText('Agrega al menos un archivo de esta categoría.',{exact:true}).waitFor();
    await page.getByRole('heading',{name:'Foto y documentos',exact:true}).waitFor();
    await page.locator('#files-certificate').setInputFiles({name:'certificado-prueba.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\n% Test training certificate\n%%EOF')});
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
    await page.getByRole('heading', { name: '¡Solicitud enviada!', exact: true }).waitFor();
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
    assert.equal(saved.documents.length, 3);
    assert.equal(saved.documents.filter(file=>file.category==='certificate').length,1);
    assert.equal(saved.candidateMail.locale,'es');assert.equal(saved.candidateMail.status,'queued');
    assert(saved.candidateMessage.subject.startsWith('Recibimos tu solicitud'));
    assert.equal(saved.candidateMessage.to,email);
    assert(!saved.candidateMessage.text.includes('QA PRIVATE NOTE'));
    // Fresh authorized admin context proves snapshot rendering after the candidate closes.
    const admin = await makeContext(browser, true, { width: 1440, height: 1000 });
    const office = await admin.newPage(), reads = [], pendingRequests = new Set(), failedRequests = [], completedTrees = [], responseFacts = new WeakMap();
    let lastNetworkActivity = Date.now(), phase = 'initial-read';
    office.setDefaultTimeout(15000);
    office.on('pageerror', error => errors.push(error.message));
    office.on('request', request => { pendingRequests.add(request); lastNetworkActivity = Date.now(); });
    const finished = request => { pendingRequests.delete(request); lastNetworkActivity = Date.now(); };
    office.on('requestfinished', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && url.pathname.endsWith('/__next._tree.txt')) {
        completedTrees.push({ phase, origin: url.origin, path: url.pathname, method: request.method(),
          type: request.resourceType(), response: responseFacts.get(request) || null });
      }
      finished(request);
    });
    office.on('response', response => responseFacts.set(response.request(), { status: response.status(), contentType: response.headers()['content-type'], length: response.headers()['content-length'] }));
    office.on('requestfailed', request => {
      failedRequests.push({ phase, origin: new URL(request.url()).origin, path: new URL(request.url()).pathname, method: request.method(), type: request.resourceType(), response: responseFacts.get(request) || null, error: request.failure()?.errorText });
      finished(request);
    });
    // Readiness is still the authorized response plus exact DOM assertions below.
    // Drain finite static-export prefetches ONLY before deliberately reloading or
    // closing the context; cancelling active WebKit routes produces page errors.
    // Keep routing/egress isolation and every page-error assertion enabled.
    const drainBeforeNavigation = async () => {
      const deadline = Date.now() + 15000;
      while (pendingRequests.size || Date.now() - lastNetworkActivity < 500) {
        assert(Date.now() < deadline, 'pending administrator requests must finish before deliberate navigation/teardown');
        await new Promise(resolve => setTimeout(resolve, 25));
      }
    };
    office.on('response', async response => {
      if (response.request().method() !== 'POST' || !response.url().endsWith('/careersAdmin')) return;
      const action = response.request().postDataJSON()?.action;
      if (action !== 'applications.get') return;
      const body = await response.json().catch(() => ({}));
      // Diagnostics contain only test status/schema flags, never tokens or answer values.
      reads.push({ status: response.status(), ok: body.ok, code: body.code,
        snapshotVersion: body.result?.submissionSnapshot?.schemaVersion });
    });
    const openSavedProfile = async navigate => {
      const read = office.waitForResponse(response => response.request().method() === 'POST'
        && response.url().endsWith('/careersAdmin') && response.request().postDataJSON()?.action === 'applications.get');
      const [response] = await Promise.all([read, navigate()]);
      assert.equal(response.status(), 200, 'fresh admin must receive an authorized application response');
      const body = await response.json();
      assert.equal(body.ok, true); assert.equal(body.result.id, saved.id);
      assert.equal(body.result.submissionSnapshot?.localeAtSubmit, 'es');
      await office.locator('[data-submitted-locale="es"]').waitFor();
    };
    try {
      await openSavedProfile(() => office.goto(`${site}/recruitment/?tab=applicants&candidate=${saved.id}`, { waitUntil: 'domcontentloaded' }));
      assert.equal(await office.locator('[data-submitted-question="profile:givenName"] dd').textContent(), '  María  ');
      await office.getByRole('heading', { name: 'Role answers', exact: true }).waitFor();
      await office.locator('[data-candidate-mail="queued"]').waitFor();
      await office.getByText('View the prepared confirmation',{exact:true}).click();
      await office.getByText(saved.candidateMessage.subject,{exact:true}).waitFor();
      assert.equal(await office.locator('iframe[title="Prepared candidate confirmation email"]').getAttribute('sandbox'),'');
      await office.frameLocator('iframe[title="Prepared candidate confirmation email"]').getByText(saved.reference,{exact:true}).waitFor();
      await office.screenshot({path:path.join(output,`${name}-es-05-candidate-mail.png`),fullPage:true});
      await office.getByText('View the prepared confirmation',{exact:true}).click();
      await office.screenshot({ path: path.join(output, `${name}-es-04-original-expedient.png`), fullPage: true });
      await drainBeforeNavigation();
      phase = 'reload';
      await openSavedProfile(() => office.reload({ waitUntil: 'domcontentloaded' }));
      assert.equal(await office.locator('[data-submitted-question="profile:givenName"] dd').textContent(), '  María  ');
      await drainBeforeNavigation();
      // A failed event is not dismissed by method alone: the installed static
      // router must actually consume its HEAD metadata and complete that route's
      // tree GET in this same phase. The adapter experiment did not fix these
      // Chromium events and has been removed; all traffic is unmodified again.
      const network = require('./browser-network-audit.cjs').auditNetworkEvents(failedRequests, completedTrees, site);
      fs.writeFileSync(path.join(output, `${name}-es-network-evidence.json`), JSON.stringify({
        failedEvents: failedRequests, completedTrees, ...network,
      }, null, 2));
      assert.deepEqual(network.failures, [], 'administrator requests must complete their intended operation before teardown');
      phase = 'teardown';
    } catch (error) {
      await office.screenshot({ path: path.join(output, `${name}-es-admin-FAIL.png`), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(output, `${name}-es-admin-diagnostic.json`), JSON.stringify({
        path: new URL(office.url()).pathname, phase, reads, errors, failedRequests, completedTrees, failure: error.message,
        pendingPaths: [...pendingRequests].map(request => new URL(request.url()).pathname),
        headings: await office.locator('h1, h2').allTextContents().catch(() => []),
        snapshotNodes: await office.locator('[data-submitted-locale]').count().catch(() => -1),
      }, null, 2));
      throw error;
    } finally { await admin.close(); }
    assert.deepEqual(errors, []);
    return ['Spanish public form from an admin-authored vacancy', 'Spanish date/URL validation and selected-option labels', 'original configured privacy notice, not invented translation', 'Spanish receipt follows actual committed emulator submission', 'canonical option values and private documents persist after closing the browser'];
  } catch (error) {
    await page.screenshot({ path: path.join(output, `${name}-es-FAIL.png`), fullPage: true }).catch(() => {});
    throw error;
  } finally { await ctx.close().catch(() => {}); }
};
