import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { deleteFirestoreDocument, listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { OperationResult, useAppState } from './AppState';

export interface CalendarClosure {
  id: string;
  date: string;
  reason: string;
  notes?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface BusinessCalendarSettings {
  id: string;
  closedWeekdays: number[];
  updatedAt?: string;
}

const SYNC_INTERVAL_MS = 30_000;
const DEFAULT_SETTINGS: BusinessCalendarSettings = { id: 'business-calendar', closedWeekdays: [0] };

type CalendarStateValue = {
  calendarClosures: CalendarClosure[];
  businessCalendarSettings: BusinessCalendarSettings;
  calendarLoading: boolean;
  calendarDataError: string | null;
  refreshCalendarData: () => Promise<void>;
  saveBusinessCalendarSettings: (settings: BusinessCalendarSettings) => Promise<OperationResult>;
  saveCalendarClosure: (closure: CalendarClosure) => Promise<OperationResult>;
  removeCalendarClosure: (id: string) => Promise<OperationResult>;
};

const CalendarStateContext = createContext<CalendarStateValue | undefined>(undefined);

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('permission') || normalized.includes('denied') || normalized.includes('insufficient')) {
    return 'Firebase rechazó el calendario laboral. Publica las reglas nuevas para cierres y ajustes del negocio.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) return 'No se pudo conectar con Firebase para cargar el calendario laboral.';
  return `No se pudo sincronizar el calendario laboral: ${message}`;
}

export function CalendarStateProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useAppState();
  const [calendarClosures, setCalendarClosures] = useState<CalendarClosure[]>([]);
  const [businessCalendarSettings, setBusinessCalendarSettings] = useState<BusinessCalendarSettings>(DEFAULT_SETTINGS);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarDataError, setCalendarDataError] = useState<string | null>(null);

  const restoreDemo = useCallback(() => {
    setCalendarClosures([]);
    setBusinessCalendarSettings(DEFAULT_SETTINGS);
    setCalendarDataError(null);
  }, []);

  const refreshCalendarData = useCallback(async (showLoader = true) => {
    if (currentUser?.authProvider !== 'firebase') {
      restoreDemo();
      return;
    }
    if (showLoader) setCalendarLoading(true);
    try {
      const [remoteClosures, remoteSettings] = await Promise.all([
        listFirestoreCollection<CalendarClosure>('calendarClosures'),
        listFirestoreCollection<BusinessCalendarSettings>('businessSettings'),
      ]);
      setCalendarClosures(remoteClosures.filter((item) => item.active !== false).sort((a, b) => a.date.localeCompare(b.date)));
      const saved = remoteSettings.find((item) => item.id === DEFAULT_SETTINGS.id);
      setBusinessCalendarSettings(saved ? { ...saved, closedWeekdays: saved.closedWeekdays ?? [0] } : DEFAULT_SETTINGS);
      setCalendarDataError(null);
    } catch (error) {
      setCalendarDataError(friendlyError(error));
    } finally {
      if (showLoader) setCalendarLoading(false);
    }
  }, [currentUser?.authProvider, restoreDemo]);

  useEffect(() => { void refreshCalendarData(true); }, [refreshCalendarData, currentUser?.id]);

  useEffect(() => {
    if (currentUser?.authProvider !== 'firebase') return undefined;
    const timer = setInterval(() => { void refreshCalendarData(false); }, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [currentUser?.authProvider, refreshCalendarData]);

  const saveBusinessCalendarSettings = async (settings: BusinessCalendarSettings): Promise<OperationResult> => {
    const normalized = { ...settings, closedWeekdays: [...new Set(settings.closedWeekdays)].sort(), updatedAt: new Date().toISOString() };
    if (currentUser?.authProvider !== 'firebase') {
      setBusinessCalendarSettings(normalized);
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('businessSettings', normalized);
      setBusinessCalendarSettings(normalized);
      setCalendarDataError(null);
      return { ok: true };
    } catch (error) {
      const message = friendlyError(error);
      setCalendarDataError(message);
      return { ok: false, message };
    }
  };

  const saveCalendarClosure = async (closure: CalendarClosure): Promise<OperationResult> => {
    const normalized = { ...closure, active: true, updatedAt: new Date().toISOString() };
    if (currentUser?.authProvider !== 'firebase') {
      setCalendarClosures((previous) => [...previous.filter((item) => item.id !== normalized.id), normalized].sort((a, b) => a.date.localeCompare(b.date)));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument('calendarClosures', normalized);
      setCalendarClosures((previous) => [...previous.filter((item) => item.id !== normalized.id), normalized].sort((a, b) => a.date.localeCompare(b.date)));
      setCalendarDataError(null);
      return { ok: true };
    } catch (error) {
      const message = friendlyError(error);
      setCalendarDataError(message);
      return { ok: false, message };
    }
  };

  const removeCalendarClosure = async (id: string): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setCalendarClosures((previous) => previous.filter((item) => item.id !== id));
      return { ok: true };
    }
    try {
      await deleteFirestoreDocument('calendarClosures', id);
      setCalendarClosures((previous) => previous.filter((item) => item.id !== id));
      setCalendarDataError(null);
      return { ok: true };
    } catch (error) {
      const message = friendlyError(error);
      setCalendarDataError(message);
      return { ok: false, message };
    }
  };

  const value = useMemo<CalendarStateValue>(() => ({
    calendarClosures,
    businessCalendarSettings,
    calendarLoading,
    calendarDataError,
    refreshCalendarData: () => refreshCalendarData(true),
    saveBusinessCalendarSettings,
    saveCalendarClosure,
    removeCalendarClosure,
  }), [calendarClosures, businessCalendarSettings, calendarLoading, calendarDataError, refreshCalendarData]);

  return <CalendarStateContext.Provider value={value}>{children}</CalendarStateContext.Provider>;
}

export function useCalendarState() {
  const context = useContext(CalendarStateContext);
  if (!context) throw new Error('useCalendarState debe utilizarse dentro de CalendarStateProvider');
  return context;
}
