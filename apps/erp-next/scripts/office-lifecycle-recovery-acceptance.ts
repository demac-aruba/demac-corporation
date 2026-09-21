import assert from 'node:assert/strict';
import { createLifecycleRecovery, LIFECYCLE_RECOVERY_PREFIX, type LifecycleCommand } from '../lib/office-lifecycle-recovery';
import { OfficeBookingResponseError } from '../lib/office-booking-errors';

const command: LifecycleCommand = { action: 'cancel_appointment', data: { appointmentId: 'APT-SYNTHETIC', requestId: 'REQ-SYNTHETIC-1',
  expectedAppointmentToken: `ba1-${'a'.repeat(64)}`, reason: 'Synthetic cancellation' } };
const ack = () => ({ success: true, appointmentId: command.data.appointmentId, requestId: command.data.requestId,
  operation: command.action, replayed: true, appointment: { id: command.data.appointmentId, appointmentId: command.data.appointmentId } });
function fixture() {
  const map = new Map<string, string>(); let uid = 'A';
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); } };
  const sent: LifecycleCommand[] = [];
  let respond: (value: LifecycleCommand) => Promise<unknown> = async () => ack();
  const controller = () => createLifecycleRecovery({ storage, uid: 'A', authorized: () => uid === 'A', send: async value => { sent.push(value); return respond(value); } });
  return { map, storage, sent, controller, respond: (fn: typeof respond) => { respond = fn; }, account: (value: string) => { uid = value; } };
}
async function main() {
  let scenarios = 0;
  const lost = fixture(); lost.respond(async () => { throw Error('Synthetic response loss after commit'); });
  await assert.rejects(lost.controller().start(command));
  const raw = lost.storage.getItem(LIFECYCLE_RECOVERY_PREFIX + 'A'); assert.ok(raw);
  await assert.rejects(lost.controller().start({ ...command, data: { ...command.data, requestId: 'NEW-REQUEST' } }));
  assert.equal(lost.sent.length, 1); assert.equal(lost.storage.getItem(LIFECYCLE_RECOVERY_PREFIX + 'A'), raw);
  lost.respond(async () => ack()); await lost.controller().retry();
  assert.deepEqual(lost.sent, [command, command]); assert.equal(lost.map.size, 0); scenarios++;

  for (const body of [{}, { ...ack(), requestId: 'WRONG' }, { ...ack(), appointment: 'invalid' }, { ...ack(), appointment: [] },
    { ...ack(), appointment: {} }, { ...ack(), appointment: { appointmentId: 'WRONG' } }, { ...ack(), appointment: { id: 'WRONG', appointmentId: command.data.appointmentId } }]) {
    const f = fixture(); f.respond(async () => body); await assert.rejects(f.controller().start(command));
    assert.ok(f.controller().pending()); assert.equal(f.map.size, 1); scenarios++;
  }
  const rejection = new OfficeBookingResponseError('Stale', 409, 'invalid_request', 'appointment_version_conflict');
  const definite = fixture(); definite.respond(async () => { throw rejection; });
  await assert.rejects(definite.controller().start(command)); assert.equal(definite.map.size, 0); scenarios++;
  const ambiguous = fixture(); ambiguous.respond(async () => { throw Error('Lost'); }); await assert.rejects(ambiguous.controller().start(command));
  ambiguous.respond(async () => { throw rejection; }); await assert.rejects(ambiguous.controller().retry()); assert.equal(ambiguous.map.size, 1); scenarios++;
  const switched = fixture(); switched.respond(async () => { switched.account('B'); return ack(); });
  await assert.rejects(switched.controller().start(command)); assert.equal(switched.map.size, 1);
  await assert.rejects(switched.controller().retry()); assert.equal(switched.sent.length, 1); scenarios++;
  const blocked = fixture(); blocked.storage.setItem = () => { throw Error('Synthetic storage unavailable'); };
  await assert.rejects(blocked.controller().start(command)); assert.equal(blocked.sent.length, 0); scenarios++;
  const parallel = fixture(); let finish!: (value: unknown) => void;
  parallel.respond(() => new Promise(resolve => { finish = resolve; })); const recovery = parallel.controller();
  const pending = recovery.start(command); await assert.rejects(recovery.retry()); assert.equal(parallel.sent.length, 1); finish(ack()); await pending; scenarios++;
  console.log(`Office lifecycle recovery: ${scenarios} acceptance scenarios passed.`);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
