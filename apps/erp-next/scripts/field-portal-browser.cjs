// Browser component verification only. Authenticated gateway UAT is a separate gate.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const tools = process.env.FIELD_PORTAL_TEST_TOOLS;
if (!tools) throw new Error('FIELD_PORTAL_TEST_TOOLS must point to the isolated test installation.');
const { chromium } = require(path.join(tools, 'node_modules/playwright'));
const esbuild = require(path.join(tools, 'node_modules/esbuild'));
const app = path.resolve(__dirname, '..');
const output = path.resolve(process.env.FIELD_PORTAL_EVIDENCE || path.join(app, '.field-portal-browser'));
fs.mkdirSync(output, { recursive: true });
const build = esbuild.buildSync({ entryPoints: [path.join(__dirname, 'field-portal-browser.fixture.tsx')], bundle: true, write: false, outfile: path.join(output, 'app.js'), jsx: 'automatic', tsconfig: path.join(app, 'tsconfig.json'), nodePaths: [path.join(tools, 'node_modules')], external: ['/images/*'] });
const bundle = build.outputFiles.find((file) => file.path.endsWith('.js')).text;
const image = fs.readFileSync(path.join(app, 'public/images/field/tropical-reference.webp')).toString('base64');
const css = build.outputFiles.find((file) => file.path.endsWith('.css')).text.replaceAll('/images/field/tropical-reference.webp', `data:image/webp;base64,${image}`);
async function load(page, mode) {
  await page.setContent('<html lang="es"><head><style>body{margin:0}button,input{font:inherit}</style></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate((mode) => { window.testMode = mode; }, mode);
  await page.addScriptTag({ content: bundle });
}
(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.FIELD_PORTAL_BROWSER_EXECUTABLE ? { executablePath: process.env.FIELD_PORTAL_BROWSER_EXECUTABLE } : {}), args: ['--no-sandbox'] });
  try {
    for (const [name, width, height] of [['mobile-390', 390, 844], ['mobile-360', 360, 800], ['desktop', 1365, 1000]]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [], network = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('request', (req) => { if (!/^(data:|blob:|about:)/.test(req.url())) network.push(req.url()); });
      await load(page, 'home');
      await page.getByRole('heading', { name: 'Portal del Técnico', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, `01-inicio-${name}.png`) });
      await page.getByRole('button', { name: 'Agenda', exact: true }).click();
      await page.getByRole('heading', { name: 'Mi agenda', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Perfil', exact: true }).click();
      await page.getByRole('heading', { name: 'Mi perfil', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `04-perfil-${name}.png`) });
      await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).click();
      await page.getByRole('button', { name: 'Inicio', exact: true }).click();
      await page.getByRole('button', { name: 'Abrir próximo trabajo', exact: true }).click();
      await page.getByRole('heading', { name: 'Trabajo en curso', exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, `02-contexto-${name}.png`) });
      const events = await page.evaluate(() => window.events);
      assert.deepEqual(events, ['signout', 'open:DEMO-WO1'], 'navigation invokes only the requested callbacks');
      await load(page, 'error');
      await page.getByRole('alert').waitFor();
      assert.equal(await page.getByText('No tienes trabajos asignados para hoy', { exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => window.events), ['retry']);
      await load(page, 'empty');
      await page.getByText('No tienes trabajos asignados para hoy', { exact: true }).waitFor();
      await load(page, 'loading');
      await page.getByText('Cargando tus trabajos…', { exact: true }).waitFor();
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      console.log(`PASS ${name}: navigation, callbacks, no horizontal overflow, loading/error/empty separation, zero network`);
      await page.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
