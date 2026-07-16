import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { OperationResult, useAppState } from './AppState';

export type VanHalfDayWeekday = 1 | 2 | 3 | 4 | 5 | 6;
export const VAN_HALF_DAY_EFFECTIVE_FROM = '2026-08-01';

export interface VanHalfDaySchedule {
  id: string;
  vanId: string;
  weekday: VanHalfDayWeekday;
  active: boolean;
  workdayStart: '08:00';
  workdayEnd: '13:00';
  extraMorningSlot: '11:30';
  notes?: string;
  updatedAt?: string;
}

type VanHalfDayStateValue = {
  vanHalfDaySchedules: VanHalfDaySchedule[];
  halfDayLoading: boolean;
  halfDayError: string | null;
  refreshVanHalfDays: () => Promise<void>;
  saveVanHalfDaySchedule: (schedule: VanHalfDaySchedule) => Promise<OperationResult>;
};

const VanHalfDayStateContext = createContext<VanHalfDayStateValue | undefined>(undefined);
const SYNC_INTERVAL_MS = 30_000;

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('permission') || normalized.includes('denied') || normalized.includes('insufficient')) {
    return 'Firebase rechazó la operación. Publica las reglas que permiten administrar las tardes libres de las vans.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) {
    return 'No se pudo conectar con Firebase para sincronizar las tardes libres.';
  }
  return `No se pudieron sincronizar las tardes libres: ${message}`;
}

export function VanHalfDayStateProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAppState();
  const [vanHalfDaySchedules, setVanHalfDaySchedules] = useState<VanHalfDaySchedule[]>([]);
  const [halfDayLoading, setHalfDayLoading] = useState(false);
  const [halfDayError, setHalfDayError] = useState<string | null>(null);

  const refreshVanHalfDays = useCallback(async (showLoader = true) => {
    if (currentUser?.authProvider !== 'firebase') {
      setVanHalfDaySchedules([]);
      setHalfDayError(null);
      return;
    }
    if (showLoader) setHalfDayLoading(true);
    try {
      const remote = await listFirestoreCollection<VanHalfDaySchedule>('vanHalfDaySchedules');
      setVanHalfDaySchedules(remote.sort((a, b) => a.vanId.localeCompare(b.vanId)));
      setHalfDayError(null);
    } catch (error) {
      setHalfDayError(friendlyError(error));
    } finally {
      if (showLoader) setHalfDayLoading(false);
    }
  }, [currentUser?.authProvider]);

  useEffect(() => { void refreshVanHalfDays(true); }, [refreshVanHalfDays, currentUser?.id]);

  useEffect(() => {
    if (currentUser?.authProvider !== 'firebase') return undefined;
    const timer = setInterval(() => { void refreshVanHalfDays(false); }, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [currentUser?.authProvider, refreshVanHalfDays]);

  const saveVanHalfDaySchedule = async (schedule: VanHalfDaySchedule): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setVanHalfDaySchedules((previous) => [schedule, ...previous.filter((item) => item.id !== schedule.id)]);
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('vanHalfDaySchedules', schedule);
      setVanHalfDaySchedules((previous) => [schedule, ...previous.filter((item) => item.id !== schedule.id)]
        .sort((a, b) => a.vanId.localeCompare(b.vanId)));
      setHalfDayError(null);
      return { ok: true };
    } catch (error) {
      const message = friendlyError(error);
      setHalfDayError(message);
      return { ok: false, message };
    }
  };

  const value = useMemo<VanHalfDayStateValue>(() => ({
    vanHalfDaySchedules,
    halfDayLoading,
    halfDayError,
    refreshVanHalfDays: () => refreshVanHalfDays(true),
    saveVanHalfDaySchedule,
  }), [vanHalfDaySchedules, halfDayLoading, halfDayError, refreshVanHalfDays]);

  return <VanHalfDayStateContext.Provider value={value}>{children}</VanHalfDayStateContext.Provider>;
}

export function useVanHalfDayState() {
  const context = useContext(VanHalfDayStateContext);
  if (!context) throw new Error('useVanHalfDayState debe utilizarse dentro de VanHalfDayStateProvider');
  return context;
}

export function vanHasHalfDayOnDate(vanId: string, date: string, schedules: VanHalfDaySchedule[]) {
  if (date < VAN_HALF_DAY_EFFECTIVE_FROM) return false;
  const weekday = new Date(`${date}T12:00:00`).getDay();
  return schedules.some((schedule) => schedule.active && schedule.vanId === vanId && schedule.weekday === weekday);
}
