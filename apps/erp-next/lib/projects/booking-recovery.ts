import { verifyCentralProjectBooking, type ProjectBookingConfirmation, type ProjectBookingExpectation } from './booking-handoff';
import { definiteCreateRejection } from '../office-booking-errors';
import type { OfficeCreateAppointmentResult } from '../office-booking-authority';

type Prepared = { command: ProjectBookingConfirmation; expectation: ProjectBookingExpectation };
type Pending = Prepared & { schemaVersion: 1; uid: string };
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type VerifiedProjectBooking = ReturnType<typeof verifyCentralProjectBooking>;
export type BookingSender = (mode: ProjectBookingExpectation['mode'], command: ProjectBookingConfirmation) => Promise<OfficeCreateAppointmentResult>;
const PREFIX = 'demac.projects.booking.pending.v1:';
const MAX_BYTES = 16 * 1024;
const id = (value: unknown): value is string => typeof value === 'string' && value.length > 0
  && value.length <= 180 && value.trim() === value && !/[\x00-\x1f/]/.test(value);
const version = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0;
function decode(raw: string, uid: string): Pending {
  if (raw.length > MAX_BYTES) throw new Error('Pending Project booking exceeds the recovery limit.');
  let value: Pending;
  try { value = JSON.parse(raw) as Pending; } catch { throw new Error('The pending Project booking needs manual review. Its recovery record was preserved.'); }
  const e = value?.expectation;
  const c = value?.command;
  if (!value || value.schemaVersion !== 1 || value.uid !== uid || !e || !c || e.actorId !== uid
      || !id(e.selection?.projectId) || (e.selection.phaseId !== null && !id(e.selection.phaseId))
      || !version(e.selection.expectedVersion) || !id(e.customerId) || !id(e.propertyId)
      || !['confirmed', 'temporary_hold'].includes(e.mode) || !id(c.requestId) || c.requestId.length < 8
      || !id(c.offerId) || c.offerId !== e.offerId || !version(c.offerVersion) || c.offerVersion !== e.offerVersion
      || !id(c.optionId) || c.optionId !== e.optionId
      || Object.keys(value).some(key => !['schemaVersion', 'uid', 'command', 'expectation'].includes(key))
      || Object.keys(c).some(key => !['requestId', 'offerId', 'offerVersion', 'optionId', 'bookingMode', 'backdatingAcknowledged'].includes(key))) {
    throw new Error('The pending Project booking cannot be verified. Do not create a replacement; reconcile the original request.');
  }
  return value;
}
/** Exact pending intent, not a browser Project, new booking authority, or automatic outbox. */
export function createProjectBookingRecovery({ storage, uid, send, authorized }: {
  storage: StoragePort; uid: string; send: BookingSender; authorized: () => boolean;
}) {
  if (!id(uid)) throw new Error('An authenticated user is required for booking recovery.');
  const key = PREFIX + uid;
  let pendingText: string | null = storage.getItem(key);
  if (pendingText !== null) decode(pendingText, uid);
  let uncertain = pendingText !== null;
  let running = false;
  const assertJournal = () => {
    if (storage.getItem(key) !== pendingText) throw new Error('The pending booking changed in another view. Close and reopen the drawer to reconcile it.');
  };
  const clear = () => { assertJournal(); storage.removeItem(key); pendingText = null; uncertain = false; };
  async function execute(): Promise<VerifiedProjectBooking> {
    if (!pendingText || running) throw new Error('A Project booking is already being processed, or no request is pending.');
    if (!authorized()) throw new Error('Sign in as the original authorized operator to recover this booking.');
    assertJournal();
    running = true;
    try {
      const pending = decode(pendingText, uid);
      const result = await send(pending.expectation.mode, pending.command);
      if (!authorized()) { uncertain = true; throw new Error('Your session or permission changed. The original booking is retained for recovery.'); }
      const verified = verifyCentralProjectBooking(result, pending.expectation);
      // Missing acknowledgements and cleanup failures keep the exact original command.
      try { clear(); } catch { uncertain = true; throw new Error('The booking was verified, but its recovery record could not be cleared. Retry the exact request.'); }
      return verified;
    } catch (error) {
      uncertain = uncertain || !definiteCreateRejection(error);
      if (!uncertain) {
        try { clear(); } catch { uncertain = true; }
      }
      throw error;
    } finally { running = false; }
  }
  return {
    pending: () => pendingText ? decode(pendingText, uid) : null,
    isRunning: () => running,
    async start(prepared: Prepared) {
      if (pendingText || running || !authorized()) throw new Error('Resolve the pending booking or current permissions before creating another.');
      assertJournal();
      const raw = JSON.stringify({ schemaVersion: 1, uid, command: prepared.command, expectation: prepared.expectation });
      decode(raw, uid);
      // A storage failure here prevents any network write.
      storage.setItem(key, raw);
      pendingText = raw;
      return execute();
    },
    retry: execute,
  };
}
