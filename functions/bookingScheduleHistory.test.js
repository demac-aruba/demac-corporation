const test = require('node:test');
const assert = require('node:assert/strict');
const { listScheduleHistory, projectHistory, PAGE_SIZE } = require('./bookingScheduleHistory');
const { createOfficeBookingApi } = require('./officeBookingAuthority');
const at = '2026-10-12T12:00:00.000Z';
const from = { dateKey: '2026-10-11', primaryVanId: 'VAN-1', primaryStart: '08:30', primaryEnd: '10:30' };
const changed = (kind = 'customer_reschedule') => ({ customerId: 'C', propertyId: 'P', date: '2027-01-01', status: 'confirmed', rescheduledAtIso: at, updatedAt: { toDate: () => new Date(at) }, lifecycleHistory: [{ id: 'E', kind, at, actorName: 'Office', reason: 'Requested', from, to: { ...from, dateKey: '2027-01-01' } }] });
function fakeDb(rows, { role = 'office', active = true, fail = false } = {}) {
  const reads = [];
  return { reads, collection(name) {
    const state = {};
    const query = {
      doc(id) { return { id, async get() { return { exists: true, data: () => ({ role, active }) }; } }; },
      where(field, op, value) { state.field = field; state.since = value; return query; },
      orderBy(field) { (state.order ||= []).push(field); return query; },
      select(...fields) { state.fields = fields; return query; },
      limit(n) { state.limit = n; return query; },
      startAfter(time, ref) { state.after = ref.id; return query; },
      async get() {
        assert.equal(name, 'appointments'); if (fail) throw Error('Synthetic read unavailable');
        reads.push(state);
        const result = rows.filter(row => row.data[state.field] !== undefined && (!state.after || row.id > state.after)).slice(0, state.limit);
        return { docs: result.map(row => ({ id: row.id, data: () => row.data })) };
      },
    };
    return query;
  } };
}
test('projection keeps recorded old placement after repeated moves and excludes unrelated/private payloads', () => {
  const row = changed(); row.secret = 'not-for-ui'; row.jobCharges = { private: true };
  row.lifecycleHistory.push({ ...row.lifecycleHistory[0], id: 'E2', kind: 'cancelled', from: row.lifecycleHistory[0].to, to: undefined }, { kind: 'details_edited', from });
  const result = projectHistory('A', row);
  assert.equal(result.events.length, 2); assert.equal(result.events[0].from.dateKey, '2026-10-11');
  assert.equal(result.events[1].to, null); assert.equal(result.appointmentId, 'A');
  assert.equal(result.secret, undefined); assert.equal(result.jobCharges, undefined);
});
test('paginated initial history completes moves then cancellations, without truncating at the page limit', async () => {
  const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, index) => ({ id: `A${String(index).padStart(3, '0')}`, data: changed() }));
  rows.push({ id: 'C', data: { ...changed('cancelled'), rescheduledAtIso: undefined, cancelledAtIso: at } });
  const db = fakeDb(rows), ids = new Set(); let cursor, result;
  do { result = await listScheduleHistory({ db, data: { cursor }, now: new Date(at) }); result.appointments.forEach(item => ids.add(item.appointmentId)); cursor = result.nextCursor; } while (cursor);
  assert.equal(ids.size, PAGE_SIZE + 2); assert.equal(db.reads.length, 3);
  assert.deepEqual(db.reads[0].order, ['rescheduledAtIso', '__name__']); assert.equal(db.reads[0].limit, 50);
  assert.equal(result.checkpoint, '2026-10-12T11:59:00.000Z');
});
test('delta reads use the commit timestamp and omit appointments with no cancellation/move evidence', async () => {
  const db = fakeDb([{ id: 'A', data: changed() }, { id: 'B', data: { updatedAt: at } }]);
  const result = await listScheduleHistory({ db, data: { since: at }, now: new Date(at) });
  assert.equal(db.reads[0].field, 'updatedAt'); assert.deepEqual(db.reads[0].since, new Date(at));
  assert.equal(result.appointments.length, 1); assert.equal(result.nextCursor, null);
});
test('invalid cursor and read failures remain errors, never a successful empty audit', async () => {
  for (const data of [{ since: 'bad' }, { cursor: [] }, { cursor: { phase: 'other' } }, { cursor: { phase: 'moves', checkpoint: at, afterId: 'a/b', afterTime: at } }]) {
    await assert.rejects(() => listScheduleHistory({ db: fakeDb([]), data }));
  }
  await assert.rejects(() => listScheduleHistory({ db: fakeDb([], { fail: true }) }), /unavailable/);
});
test('the new read uses existing office authentication and rejects anonymous, field and inactive accounts', async () => {
  const request = token => ({ method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body: { action: 'list_schedule_history', data: {} } });
  for (const [options, token, status] of [[{}, '', 401], [{ role: 'technician' }, 'token', 403], [{ active: false }, 'token', 403], [{}, 'token', 200]]) {
    const db = fakeDb([{ id: 'A', data: changed() }], options);
    const api = createOfficeBookingApi({ db, verifyIdToken: async () => ({ uid: 'office-1' }), bookingAuthority: {}, schedulingProvider: {} });
    const result = await api.handle(request(token)); assert.equal(result.status, status);
    assert.equal(db.reads.length, status === 200 ? 1 : 0);
  }
});
