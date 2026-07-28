import { useCallback, useEffect, useMemo, useState } from 'react';
import { PayrollAdjustment } from '../payroll/adjustments';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { User } from '../types';

function sortAdjustments(items: PayrollAdjustment[]) {
  return [...items].sort((first, second) => {
    const dateComparison = second.date.localeCompare(first.date);
    if (dateComparison) return dateComparison;
    return second.createdAt.localeCompare(first.createdAt);
  });
}

export function usePayrollAdjustments(currentUser: User | null) {
  const firebase = currentUser?.authProvider === 'firebase';
  const [adjustments, setAdjustments] = useState<PayrollAdjustment[]>([]);
  const [loading, setLoading] = useState(firebase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!firebase) return;
    setLoading(true);
    try {
      const remote = await listFirestoreCollection<PayrollAdjustment>('employeePayrollAdjustments');
      setAdjustments(sortAdjustments(remote));
      setError('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.toLowerCase().includes('permission') || message.toLowerCase().includes('denied')
        ? 'Firebase rechazó bonos y deducciones. Publica las reglas nuevas de Firestore.'
        : `No se pudieron cargar bonos y deducciones: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [firebase]);

  useEffect(() => { void refresh(); }, [refresh, currentUser?.id]);

  async function saveAdjustment(adjustment: PayrollAdjustment) {
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const normalized: PayrollAdjustment = {
        ...adjustment,
        amountAfl: Math.round(Math.max(0, Number(adjustment.amountAfl || 0)) * 100) / 100,
        concept: adjustment.concept.trim(),
        updatedAt: now,
        createdAt: adjustment.createdAt || now,
        createdByUserId: adjustment.createdByUserId ?? currentUser?.id,
        createdByName: adjustment.createdByName ?? currentUser?.name,
      };
      if (firebase) await saveFirestoreDocument('employeePayrollAdjustments', normalized);
      setAdjustments((previous) => sortAdjustments([
        normalized,
        ...previous.filter((candidate) => candidate.id !== normalized.id),
      ]));
      setError('');
      return { ok: true, adjustment: normalized };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }

  async function voidAdjustment(adjustment: PayrollAdjustment, reason: string) {
    const now = new Date().toISOString();
    return saveAdjustment({
      ...adjustment,
      status: 'voided',
      voidReason: reason.trim(),
      voidedAt: now,
      voidedByUserId: currentUser?.id,
      voidedByName: currentUser?.name,
      updatedAt: now,
    });
  }

  const activeAdjustments = useMemo(
    () => adjustments.filter((adjustment) => adjustment.status === 'active'),
    [adjustments],
  );

  return {
    adjustments,
    activeAdjustments,
    loading,
    busy,
    error,
    refresh,
    saveAdjustment,
    voidAdjustment,
  };
}
