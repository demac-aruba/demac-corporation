import { OfficeBookingResponseError, definiteCreateRejection } from './office-booking-errors';

export type LifecycleCommand = { action: 'cancel_appointment' | 'reschedule_appointment';
  data: { appointmentId: string; requestId: string; reason: string; note?: string;
    expectedAppointmentToken?: string; offerId?: string; offerVersion?: number; optionId?: string; changeKind?: string } };
export type LifecycleAcknowledgement = { success: true; appointmentId: string; requestId: string;
  operation: LifecycleCommand['action']; replayed: boolean; appointment: Record<string, unknown> };
export const LIFECYCLE_RECOVERY_PREFIX = 'demac.booking.lifecycle.pending.v1:';
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const allowed = ['appointmentId', 'requestId', 'reason', 'note', 'expectedAppointmentToken', 'offerId', 'offerVersion', 'optionId', 'changeKind'];
function decode(raw: string, uid: string): LifecycleCommand {
  const value = JSON.parse(raw);
  const command = value?.command as LifecycleCommand;
  const data = command?.data;
  if (raw.length > 8192 || value?.version !== 1 || value.uid !== uid || !command || !data
      || !['cancel_appointment', 'reschedule_appointment'].includes(command.action)
      || Object.keys(value).some(key => !['version', 'uid', 'command'].includes(key))
      || Object.keys(command).some(key => !['action', 'data'].includes(key))
      || Object.keys(data).some(key => !allowed.includes(key))
      || typeof data.appointmentId !== 'string' || !data.appointmentId || data.appointmentId.length > 180
      || !/^[A-Za-z0-9_-]{8,240}$/.test(data.requestId) || typeof data.reason !== 'string' || !data.reason.trim()
      || (command.action === 'cancel_appointment' ? !/^ba1-[a-f0-9]{64}$/.test(data.expectedAppointmentToken || '')
        : !data.offerId || !data.optionId || !Number.isSafeInteger(data.offerVersion) || Number(data.offerVersion) < 1)) {
    throw new Error('The pending appointment change needs review. Its original request was preserved.');
  }
  return command;
}
function definiteRejection(error: unknown) {
  return definiteCreateRejection(error) || (error instanceof OfficeBookingResponseError && error.status === 409
    && error.code === 'invalid_request' && ['appointment_version_conflict', 'appointment_token_required',
      'partial-completion-history-locked', 'completed_work_requires_reconciliation', 'lifecycle_offer_mismatch',
      'work_order_identity_conflict', 'appointment_already_cancelled'].includes(error.reason));
}
export function createLifecycleRecovery({ storage, uid, authorized, send, changed = () => {} }: {
  storage: StoragePort; uid: string; authorized: () => boolean;
  send: (command: LifecycleCommand) => Promise<unknown>; changed?: () => void;
}) {
  const key = LIFECYCLE_RECOVERY_PREFIX + uid;
  let running = false;
  const pending = () => { const raw = storage.getItem(key); return raw === null ? null : decode(raw, uid); };
  async function execute(raw: string, uncertain: boolean) {
    if (running || !authorized() || storage.getItem(key) !== raw) throw new Error('Resolve the original appointment request with its original account.');
    const command = decode(raw, uid);
    const clear = () => { if (storage.getItem(key) !== raw) throw new Error('The recovery record changed. Review the original request.'); storage.removeItem(key); changed(); };
    running = true;
    changed();
    try {
      const result = await send(command) as LifecycleAcknowledgement;
      const appointment = result?.appointment;
      if (!authorized() || result?.success !== true || result.appointmentId !== command.data.appointmentId
          || result.requestId !== command.data.requestId || result.operation !== command.action
          || typeof result.replayed !== 'boolean' || !appointment || typeof appointment !== 'object' || Array.isArray(appointment)
          || (!appointment.id && !appointment.appointmentId)
          || (appointment.id !== undefined && appointment.id !== command.data.appointmentId)
          || (appointment.appointmentId !== undefined && appointment.appointmentId !== command.data.appointmentId)) {
        throw new Error('The appointment change is not yet verified. Recover the exact pending request.');
      }
      clear();
      return result;
    } catch (error) {
      if (!uncertain && authorized() && definiteRejection(error)) clear();
      throw error;
    } finally { running = false; changed(); }
  }
  return { pending, isRunning: () => running,
    async start(command: LifecycleCommand) {
      if (!authorized() || running || storage.getItem(key) !== null) throw new Error('Recover the pending appointment change before starting another.');
      const raw = JSON.stringify({ version: 1, uid, command });
      decode(raw, uid);
      storage.setItem(key, raw); // A failed journal write prevents any network mutation.
      return execute(raw, false);
    },
    async retry() {
      const raw = storage.getItem(key);
      if (raw === null) throw new Error('There is no pending appointment change.');
      return execute(raw, true);
    },
  };
}
