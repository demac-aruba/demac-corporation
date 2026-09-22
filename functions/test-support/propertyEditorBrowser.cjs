// Real compiled ERP, real preview authority and persisted emulator records. No production destinations.
const fs = require('node:fs'); const path = require('node:path'); const assert = require('node:assert/strict');
const { chromium, webkit } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const credentials = JSON.parse(fs.readFileSync(process.env.PREVIEW_CREDENTIALS_FILE, 'utf8'));
const base = process.env.PREVIEW_URL || 'http://127.0.0.1:4397';
if (!/^http:\/\/127\.0\.0\.1:4397$/.test(base) && !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(base)) throw Error('Synthetic preview only');
const output = process.env.PREVIEW_EVIDENCE_DIR; fs.mkdirSync(output, { recursive: true });
const fonts = (dialog) => dialog.evaluate(el => Object.fromEntries(['h2','h3','header p','input','label>span'].map(selector => [selector, parseFloat(getComputedStyle(el.querySelector(selector)).fontSize)])));
async function login(page) {
  await page.goto(base + '/login'); await page.getByLabel('Email', { exact: true }).fill(credentials.office);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in securely' }).click(); await page.waitForURL(url => !url.pathname.includes('/login'));
}
async function crm(page) {
  await page.goto(base + '/crm'); await page.getByRole('button', { name: /DO DEMO Owner A / }).click();
  await page.getByRole('button', { name: 'Properties', exact: true }).click();
}
async function openProperty(page, name) {
  await page.locator('article').filter({ has: page.getByText(name, { exact: true }) }).getByRole('button', { name: 'Edit property' }).click();
  const dialog = page.getByRole('dialog', { name: 'Editar propiedad', exact: true });
  await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).waitFor();
  await dialog.getByLabel('Nombre de la propiedad', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"]').getAttribute('aria-busy') === 'false');
  return dialog;
}
async function noOverflow(dialog) { assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 2), false, 'Dialog must fit viewport'); }
async function main() {
  const browser = await chromium.launch({ headless: true }); const context = await browser.newContext({ viewport: { width: 1512, height: 1040 } }); const page = await context.newPage();
  page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(20000);
  const errors = [], outside = [], responses = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!request.url().startsWith(base) && !request.url().startsWith('data:')) outside.push(new URL(request.url()).origin); });
  page.on('response', async response => { if (response.url().endsWith('/officeBookingAuthority')) { try { responses.push({ input: response.request().postDataJSON(), body: await response.json() }); } catch {} } });
  const name = `DEMO Coral Premium ${Date.now()}`;
  try {
    await login(page); console.log('PASS preview login'); await crm(page); console.log('PASS CRM owner navigation');
    assert.equal(await page.getByLabel('Open property dwellings & areas').count(), 0);
    await page.getByRole('button', { name: '+ Add property', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Crear propiedad', exact: true });
    await dialog.getByLabel('Nombre de la propiedad', { exact: true }).fill(name);
    await dialog.getByLabel('Dirección completa *', { exact: true }).fill('DEMO Coral Lane 55');
    await dialog.getByLabel('Zona *', { exact: true }).fill('Oranjestad');
    await dialog.getByRole('combobox', { name: 'Tipo de propiedad', exact: true }).selectOption('Complejo de apartamentos');
    await dialog.getByRole('button', { name: 'Varias unidades Apartamentos y anexos', exact: true }).click();
    await dialog.getByRole('switch', { name: 'Incluir oficina principal', exact: true }).click();
    await dialog.getByRole('spinbutton', { name: 'Cantidad de apartamentos' }).fill('3');
    await dialog.getByRole('button', { name: 'Añadir anexo', exact: true }).click();
    assert.equal(await dialog.locator('article').count(), 5);
    await dialog.getByRole('button', { name: 'Editar Apartamento 1', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Contactos de esta unidad · opcional', exact: true }).selectOption('DEMO-access');
    await dialog.getByRole('textbox', { name: 'Indicaciones de acceso', exact: true }).fill('DEMO: entrada lateral, timbre 1.');
    await noOverflow(dialog);
    const standardFonts = await fonts(dialog);
    await page.screenshot({ path: path.join(output, 'crear-complejo-desktop.png') });
    console.log('PASS property draft configured');
    let committed; let originalPayload;
    await page.route('**/officeBookingAuthority', async route => {
      const input = route.request().postDataJSON();
      if (input.action !== 'create_property') return route.continue();
      originalPayload = route.request().postData(); const response = await route.fetch(); committed = await response.json();
      assert.equal(committed.success, true, JSON.stringify(committed)); await route.abort();
    });
    await dialog.getByRole('button', { name: 'Crear propiedad', exact: true }).click();
    await dialog.getByRole('button', { name: 'Reintentar guardado', exact: true }).waitFor();
    assert.equal(await dialog.getByLabel('Nombre de la propiedad').inputValue(), name);
    assert.equal(await dialog.getByRole('button', { name: 'Cancelar', exact: true }).isDisabled(), true);
    await page.unroute('**/officeBookingAuthority');
    const retry = page.waitForRequest(request => request.url().endsWith('/officeBookingAuthority') && request.postDataJSON()?.action === 'create_property');
    await dialog.getByRole('button', { name: 'Reintentar guardado', exact: true }).click();
    assert.equal((await retry).postData(), originalPayload);
    await dialog.waitFor({ state: 'hidden' });
    console.log('PASS create complex + main office + 3 apartments + annex; lost response after commit recovers identical request');
    dialog = await openProperty(page, name);
    assert.equal(await dialog.locator('article').count(), 5);
    assert.equal(await dialog.getByRole('spinbutton', { name: 'Cantidad de apartamentos' }).inputValue(), '3');
    assert.equal(await dialog.getByRole('switch', { name: 'Incluir oficina principal' }).isDisabled(), true);
    await dialog.getByRole('spinbutton', { name: 'Cantidad de apartamentos' }).fill('0');
    assert.equal(await dialog.getByRole('spinbutton', { name: 'Cantidad de apartamentos' }).inputValue(), '3');
    await dialog.getByRole('button', { name: 'Editar Apartamento 1', exact: true }).click();
    assert.equal(await dialog.getByRole('textbox', { name: 'Indicaciones de acceso', exact: true }).inputValue(), 'DEMO: entrada lateral, timbre 1.');
    await dialog.getByLabel('Nombre de la unidad', { exact: true }).fill('Suite Coral');
    await dialog.getByLabel('Código de Suite Coral', { exact: true }).fill('CORAL-01');
    await dialog.getByText('Ver áreas y equipos A/C', { exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Nombre del área', exact: true }).fill('Sala');
    await dialog.getByRole('textbox', { name: 'Código del área', exact: true }).fill('SALA');
    await dialog.getByRole('button', { name: 'Área', exact: true }).click();
    const before = responses.filter(row => row.input.action === 'list_property_locations' && row.body.property?.id === committed.property.id).at(-1).body;
    await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
    dialog = await openProperty(page, name);
    const after = responses.filter(row => row.input.action === 'list_property_locations' && row.body.property?.id === committed.property.id).at(-1).body;
    assert.equal(after.dwellings.find(row => row.name === 'Suite Coral').id, before.dwellings.find(row => row.name === 'Apartamento 1').id);
    assert.equal(after.areas.length, 1); assert.equal(after.assignments.length, 1);
    await dialog.getByRole('button', { name: 'Editar Suite Coral', exact: true }).click();
    await page.screenshot({ path: path.join(output, 'editar-complejo-desktop.png') });
    assert.deepEqual(await fonts(dialog), standardFonts);
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    console.log('PASS edit/reopen preserves unit identity, contacts and areas; reducing count cannot delete saved units');
    await page.getByRole('link', { name: 'ST Settings', exact: true }).click();
    const control = page.getByRole('region', { name: 'Accessibility text size', exact: true });
    await control.getByRole('button', { name: '+4', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.demacTextSize === '4');
    await crm(page); dialog = await openProperty(page, name);
    const enlarged = await fonts(dialog);
    for (const [key, size] of Object.entries(standardFonts)) assert.equal(enlarged[key], size + 4, `${key} must follow operator +4 setting once`);
    await noOverflow(dialog); await page.screenshot({ path: path.join(output, 'editar-complejo-texto-grande.png') });
    await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(dialog);
    await dialog.getByRole('button', { name: 'Editar Suite Coral', exact: true }).click();
    await dialog.getByRole('textbox', { name: 'Indicaciones de acceso', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'editar-complejo-mobile-texto-grande.png') });
    assert.ok(await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).isVisible());
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.setViewportSize({ width: 1512, height: 1040 }); dialog = await openProperty(page, name);
    assert.deepEqual(await fonts(dialog), enlarged, 'Opening twice must not compound font offset');
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Dark', exact: true }).click(); dialog = await openProperty(page, name);
    await page.screenshot({ path: path.join(output, 'editar-complejo-dark.png') }); await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await page.getByRole('link', { name: 'ST Settings', exact: true }).click(); await control.getByRole('button', { name: 'Standard', exact: true }).click();
    console.log('PASS real Settings +4 scales title, section headings, subtitle, label and input exactly once; desktop, mobile, dark mode');
    await crm(page); dialog = await openProperty(page, 'DEMO Garden House');
    assert.equal(await dialog.getByRole('switch', { name: 'Incluir casa principal', exact: true }).getAttribute('aria-checked'), 'true');
    await dialog.getByText('Áreas generales y A/C sin vivienda', { exact: true }).click();
    await dialog.getByText('Existing unclassified A/C', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
    console.log('PASS existing residence/main house and unclassified equipment remain accessible');
    assert.deepEqual(errors, []); assert.deepEqual(outside, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ propertyId: committed.property.id, propertyName: name, standardFonts, enlargedFonts: enlarged, errors, outside }, null, 2));
  } catch (error) { await page.screenshot({ path: path.join(output, 'failure.png') }); console.error((await page.locator('body').ariaSnapshot()).slice(-12000)); throw error; }
  finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
