const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { PROJECT, assertIsolated } = require('./manualMoveSynthetic.cjs');
assertIsolated();
const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const base = 'http://127.0.0.1:4315';
const get = async (path) => (await db.doc(path).get()).data();
async function snapshot() {
  const result = {};
  for (const collection of ['appointments', 'workOrders', 'bookingCapacityLocks', 'bookingIdempotency']) result[collection] = (await db.collection(collection).orderBy('__name__').get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  return result;
}
(async () => {
  await fetch(base + '/_demo/reset', { method: 'POST' });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [], external = [], writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (req) => {
      if (new URL(req.url()).origin !== base) external.push(req.url());
      if (req.url().endsWith('/_demo/booking') && req.postDataJSON()?.action === 'move_appointment') writes.push(req.postDataJSON());
    });
    await page.goto(base + '/scheduling/');
    const source = () => page.getByRole('region', { name: 'Van 1 schedule', exact: true }).getByRole('button', { name: /Cliente sintético/ });
    await source().waitFor();
    const before = await snapshot();
    async function openModal() {
      await source().dblclick();
      await page.getByRole('region', { name: 'Van 2 schedule', exact: true }).getByRole('button', { name: 'REVISAR', exact: true }).first().click();
      await page.getByRole('dialog').waitFor();
      const text = await page.getByRole('dialog').innerText();
      assert.ok(text.includes('Esta cita requiere 3 cupos y la van dispone de 2 cupos ordinarios. El trabajo podría extenderse fuera de su jornada y requerir overtime. ¿Estás consciente y deseas continuar?'));
      assert.ok(text.includes('5:30 PM'));
    }
    for (const cancel of ['button', 'escape', 'backdrop']) {
      await openModal();
      assert.deepEqual(await snapshot(), before);
      if (cancel === 'button') await page.getByRole('button', { name: 'No, cancelar', exact: true }).click();
      else if (cancel === 'escape') await page.keyboard.press('Escape');
      else await page.locator('[role=presentation]').last().click({ position: { x: 5, y: 5 } });
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      assert.deepEqual(await snapshot(), before);
      assert.equal(writes.length, 0);
    }
    console.log('PASS: cancel button, Escape and backdrop write nothing and retain every source lock.');
    await openModal();
    if (process.env.EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/preview-modal.png` });
    await page.getByRole('button', { name: 'Sí, estoy consciente; mover', exact: true }).dblclick();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const destination = () => page.getByRole('region', { name: 'Van 2 schedule', exact: true }).getByRole('button', { name: /Cliente sintético/ }).first();
    await destination().waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].data.overtimeConsent.accepted, true);
    assert.equal((await get('appointments/DEMO-APT')).endTime, '17:30');
    assert.equal((await get('workOrders/DEMO-WO')).scheduledSlots, 3);
    await page.reload();
    await destination().waitFor();
    const text = await destination().innerText();
    assert.ok(text.includes('3 capacity spots reserved'));
    assert.ok(text.includes('Posible overtime aceptado'));
    assert.ok(text.includes('5:30 PM'));
    const metrics = await page.locator('[data-schedule-metrics]').innerText();
    assert.ok(metrics.includes('22') && metrics.includes('2/24') && metrics.includes('1 traslado(s)'));
    if (process.env.EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/preview-moved.png` });
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS: acceptance persists 3 slots / 180 minutes; refreshed agenda and 2/24 ordinary occupancy retain the estimate; no external requests or browser errors.');
    await fetch(base + '/_demo/reset', { method: 'POST' });
    await page.reload();
    await source().waitFor();
    await openModal();
    const date = (await get('appointments/DEMO-APT')).date;
    await db.doc('workOrders/DEMO-CONFLICT').set({ appointmentId: 'DEMO-OTHER', date, time: '17:00', vanId: 'VAN-2', status: 'Confirmada', appointmentDurationMinutes: 60 });
    const conflictedBefore = await snapshot();
    await page.getByRole('button', { name: 'Sí, estoy consciente; mover', exact: true }).click();
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByText(/complete destination interval conflicts/).first().waitFor();
    assert.deepEqual(await snapshot(), conflictedBefore);
    console.log('PASS: a conflict appearing while the modal is open fails without a partial move.');
    await fetch(base + '/_demo/reset', { method: 'POST' });
  } finally { await browser.close(); await deleteApp(app); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
