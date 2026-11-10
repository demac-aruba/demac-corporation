import type { AuthPrincipal } from './security';
import { mutateFirestoreDocumentWithReads } from './firebase/firestore-rest';

/** Reuse the employee attendance web transaction (batchGet + atomic commit).
 * A retry revalidates the exact target; unrelated settings can safely advance.
 */
export async function mutatePayrollCorrection<T extends { id: string }>(id: string, changesFor: (current: T | null) => Record<string, unknown> | null): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await mutateFirestoreDocumentWithReads<T>('employeePayrollSettings', id, [], changesFor); }
    catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
      if (attempt >= 2 || !['FAILED_PRECONDITION', 'ABORTED', 'ALREADY_EXISTS'].includes(code)) {
        if (cause instanceof Error) cause.message = cause.message.replaceAll('Attendance', 'Payroll input').replaceAll('attendance', 'payroll input');
        throw cause;
      }
    }
  }
}

export type PayrollInputValues = Record<string, string | number>;
export type PayrollInputChange = {
  id: string; action: 'edit' | 'delete'; at: string; actorId: string; actorName: string;
  reason: string; request: string; before: PayrollInputValues; after: PayrollInputValues;
};
export type PayrollInputAudit = {
  changeHistory?: PayrollInputChange[];
  updatedAt: string;
  updatedByUserId?: string;
  updatedByName?: string;
};
export type PayrollCorrection = { requestId: string; action: 'edit' | 'delete'; reason: string; principal: AuthPrincipal };

// Matches the existing payroll editor; Firestore payrollRole enforces actual access.
export function assertPayrollCorrectionPermission(principal: AuthPrincipal) {
  if (!principal.active || !principal.userId || !principal.displayName?.trim()
    || !(principal.role === 'super_admin' || principal.role === 'finance' || principal.capabilities.has('payroll_sensitive.view'))) {
    throw new Error('Corrections are restricted to authorized payroll users.');
  }
}

export function payrollInputDate(value: string) {
  const time = Date.parse(`${value}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) {
    throw new Error('Enter a valid date.');
  }
  return value;
}

export function payrollInputAmount(value: string) {
  const normalized = value.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized) || !Number.isFinite(Number(normalized)) || Number(normalized) <= 0
    || !Number.isSafeInteger(Math.round(Number(normalized) * 100))) throw new Error('Enter a positive Afl. amount with at most two decimals.');
  return Math.round(Number(normalized) * 100) / 100;
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => JSON.parse(stable(item))));
  if (value && typeof value === 'object') return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).filter(([, v]) => v !== undefined).map(([k, v]) => [k, JSON.parse(stable(v))])));
  return JSON.stringify(value);
}

/** One atomic target patch, preserving full existing history and rejecting stale edits.
 * Exact request replay is recognized even after a later correction; it returns current state.
 */
export function payrollCorrectionPatch<T extends PayrollInputAudit>(input: {
  current: T; expected: T; before: PayrollInputValues; expectedValues: PayrollInputValues;
  after: PayrollInputValues; correction: PayrollCorrection;
}) {
  const { current, expected, before, expectedValues, after, correction } = input;
  assertPayrollCorrectionPermission(correction.principal);
  const reason = correction.reason.trim();
  if (!reason || reason.length > 500) throw new Error('Enter a reason for this change of 1 to 500 characters.');
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(correction.requestId) || !['edit', 'delete'].includes(correction.action)) throw new Error('Invalid correction request.');
  const history = current.changeHistory ?? [];
  if (!Array.isArray(history) || history.some((event) => !event || !event.id || !event.before || !event.after || !event.request)
    || new Set(history.map((event) => event.id)).size !== history.length) throw new Error('Invalid correction history. Review before saving.');
  const request = stable({ action: correction.action, reason, actorId: correction.principal.userId,
    expectedValues, expectedUpdatedAt: expected.updatedAt, expectedRevision: expected.changeHistory?.length ?? 0, after });
  const replay = history.find((event) => event.id === correction.requestId);
  if (replay) {
    if (replay.request !== request) throw new Error('This correction request already exists with different details. Reopen the record.');
    return null;
  }
  if (stable(before) !== stable(expectedValues) || current.updatedAt !== expected.updatedAt
    || stable(history) !== stable(expected.changeHistory ?? [])) throw new Error('Record details changed. Refresh and review before saving.');
  if (before.status !== 'active') throw new Error('Deleted records cannot be changed.');
  if (stable(before) === stable(after)) throw new Error('Change at least one value before saving.');
  const now = new Date().toISOString();
  const event: PayrollInputChange = { id: correction.requestId, action: correction.action, at: now,
    actorId: correction.principal.userId, actorName: correction.principal.displayName, reason, request, before, after };
  return { updatedAt: now, updatedByUserId: event.actorId, updatedByName: event.actorName,
    changeHistory: [...history, event], ...(correction.action === 'delete' ? {
      voidedAt: now, voidedByUserId: event.actorId, voidedByName: event.actorName, voidReason: reason,
    } : {}) };
}
