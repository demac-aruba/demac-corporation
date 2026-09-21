import assert from 'node:assert/strict';
import { confirmOfficeAppointment, createOfficeTemporaryHold, officeBookingOutcomeUnknown } from '../lib/office-booking-authority';
import { firebaseClientConfig } from '../lib/firebase/client-config';

// Real Office API adapter, synthetic session and transport. No network is permitted.
const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalProject = firebaseClientConfig.projectId;
firebaseClientConfig.projectId = 'demo-budget-transport';
globalThis.window = {
  sessionStorage: { getItem: () => JSON.stringify({ uid: 'SYNTHETIC-ACTOR', idToken: 'synthetic-test-token', expiresAt: Date.now() + 3_600_000 }) },
  setTimeout, clearTimeout,
} as unknown as Window & typeof globalThis;
const request = { requestId: 'SYNTHETIC-REQUEST', offerId: 'SYNTHETIC-OFFER', offerVersion: 1, optionId: 'SYNTHETIC-OPTION' };
let cases = 0;
async function main() {
  try {
    for (const status of [400, 401, 403, 409, 429, 408, 500, 503]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 'synthetic', message: 'Synthetic rejection' } }), { status });
      await assert.rejects(confirmOfficeAppointment(request), (error: unknown) => {
        assert.equal(officeBookingOutcomeUnknown(error), status >= 500 || status === 408);
        return true;
      });
      cases += 1;
    }
    for (const hold of [false, true]) {
      const calls: unknown[] = [];
      const records = new Map<string, object>();
      globalThis.fetch = async (url, init) => {
        assert.equal(String(url), 'https://us-central1-demo-budget-transport.cloudfunctions.net/officeBookingAuthority');
        const payload = JSON.parse(String(init?.body));
        assert.equal(payload.action, hold ? 'create_temporary_hold' : 'create_appointment');
        calls.push(payload);
        if (!records.has(payload.data.requestId)) records.set(payload.data.requestId, {
          success: true, appointmentId: 'SYNTHETIC-APPOINTMENT', workOrderIds: ['SYNTHETIC-WO'],
          createMode: hold ? 'temporary_hold' : 'confirmed', appointment: {},
        });
        // The server committed, but its response was lost before the adapter received it.
        if (calls.length === 1) throw new TypeError('Synthetic transport disconnected after commit');
        return new Response(JSON.stringify(records.get(payload.data.requestId)));
      };
      const create = hold ? createOfficeTemporaryHold : confirmOfficeAppointment;
      await assert.rejects(create(request), (error: unknown) => officeBookingOutcomeUnknown(error));
      const recovered = await create(request);
      assert.equal(recovered.appointmentId, 'SYNTHETIC-APPOINTMENT');
      assert.equal(records.size, 1);
      assert.deepEqual(calls[0], calls[1]);
      cases += 1;
    }
    globalThis.fetch = async () => new Response('interrupted JSON response', { status: 200 });
    await assert.rejects(confirmOfficeAppointment(request), (error: unknown) => officeBookingOutcomeUnknown(error));
    cases += 1;
    console.log(`Project budget transport acceptance: ${cases} cases passed; no external requests.`);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
    firebaseClientConfig.projectId = originalProject;
  }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
