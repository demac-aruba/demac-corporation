const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { PROJECT, assertIsolated } = require('./manualMoveSynthetic.cjs');
assertIsolated();
const app = initializeApp({ projectId: PROJECT });
const db = getFirestore(app);
const base = 'http://127.0.0.1:4315';
const get = async path => (await db.doc(path).get()).data();
async function snapshot() {
  const result = {};
  for (const collection of ['appointments', 'workOrders', 'bookingCapacityLocks', 'bookingIdempotency', 'employeeTimesheets', 'whatsappOutboundQueue']) result[collection] = (await db.collection(collection).orderBy('__name__').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return result;
}
(async () => {
  await fetch(base + '/_demo/reset', { method: 'POST' });
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [], external = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => {
      if (new URL(req.url()).origin !== base) external.push(req.url());
      if (req.url().endsWith('/_demo/booking') && req.postDataJSON()?.action === 'move_appointment') writes.push(req.postDataJSON());
    });
    await page.goto(base + '/scheduling/');
    const lane = number => page.getByRole('region', { name: `Van ${number} schedule`, exact: true });
    const source = () => lane(1).getByRole('button', { name: /Cliente sintético/ }).first();
    await source().waitFor();
    const before = await snapshot();
    async function openModal() {
      await source().dblclick();
      for (const number of [1, 2, 3, 4]) assert.equal(await lane(number).locator('[data-possible-overtime]').filter({ hasText: 'Día libre · overtime' }).getByRole('button', { name: 'REVISAR', exact: true }).count(), 3);
      await lane(1).getByRole('button', { name: 'REVISAR', exact: true }).first().click();
      await page.getByRole('dialog').waitFor();
      const text = await page.getByRole('dialog').innerText();
      assert.ok(text.includes('Van 1 tiene libre en este horario.'));
      assert.ok(text.includes('el equipo trabajará overtime durante su descanso'));
      assert.ok(text.includes('4 cupos') && text.includes('5:30 PM'));
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
    console.log('PASS: same-Van/all-Van rest targets; cancel, Escape and backdrop write nothing.');
    await openModal();
    if (process.env.EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/weekly-rest-confirmation.png` });
    const committedResponse = page.waitForResponse(response => response.url().endsWith('/_demo/booking') && response.request().postDataJSON()?.action === 'move_appointment');
    await page.getByRole('button', { name: 'Sí, estoy consciente; mover', exact: true }).dblclick();
    const committed = await committedResponse;
    assert.equal(committed.status(), 200, await committed.text());
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal(writes.length, 1);
    assert.equal(writes[0].data.overtimeConsent.accepted, true);
    const appointment = await get('appointments/DEMO-APT');
    assert.equal(appointment.startTime, '13:30');
    assert.equal(appointment.endTime, '17:30');
    assert.equal(appointment.primaryVanId, 'VAN-1');
    assert.equal(appointment.capacityLockIds.length, 4);
    await page.reload();
    await source().waitFor();
    const text = await source().innerText();
    assert.ok(text.includes('4 slots reserved'));
    assert.ok(text.includes('Overtime programado · descanso semanal'));
    assert.ok(text.includes('5:30 PM'));
    if (process.env.EVIDENCE_DIR) await page.screenshot({ path: `${process.env.EVIDENCE_DIR}/weekly-rest-saved.png` });
    assert.equal((await db.collection('employeeTimesheets').get()).size, 0);
    assert.equal((await db.collection('whatsappOutboundQueue').get()).size, 0);
    console.log('PASS: acceptance persists four slots on the same Van; reload retains the rest reason and complete estimate.');
    await fetch(base + '/_demo/reset', { method: 'POST' });
    await page.reload();
    await source().waitFor();
    await openModal();
    const date = (await get('appointments/DEMO-APT')).date;
    await db.doc('workOrders/CONFLICT').set({ appointmentId: 'OTHER', date, time: '16:30', vanId: 'VAN-1', status: 'Confirmada', appointmentDurationMinutes: 60 });
    const conflicted = await snapshot();
    const rejectedResponse = page.waitForResponse(response => response.url().endsWith('/_demo/booking') && response.request().postDataJSON()?.action === 'move_appointment');
    await page.getByRole('button', { name: 'Sí, estoy consciente; mover', exact: true }).click();
    assert.equal((await rejectedResponse).status(), 409);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await snapshot(), conflicted);
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    console.log('PASS: new conflict rejects confirmation with no partial move; no browser errors or external requests.');
  } finally { await browser.close(); await deleteApp(app); }
})().catch(error => { console.error(error); process.exitCode = 1; });
