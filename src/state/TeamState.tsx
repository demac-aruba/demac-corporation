import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { demoDailyVanAssignments, demoStaffAbsences, demoStaffProfiles, demoTeamVans, demoVanMaintenanceLogs } from '../data/teamDemo';
import { deleteFirestoreDocument, listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { DailyVanAssignment, StaffAbsence, StaffProfile, Van, VanMaintenanceLog } from '../types';
import { OperationResult, useAppState as useCoreAppState } from './AppState';

const SYNC_INTERVAL_MS = 30_000;

type TeamStateValue = {
  staffProfiles: StaffProfile[];
  vans: Van[];
  dailyVanAssignments: DailyVanAssignment[];
  staffAbsences: StaffAbsence[];
  vanMaintenanceLogs: VanMaintenanceLog[];
  teamLoading: boolean;
  teamDataError: string | null;
  refreshTeamData: () => Promise<void>;
  saveStaffProfile: (profile: StaffProfile) => Promise<OperationResult>;
  saveVanProfile: (van: Van) => Promise<OperationResult>;
  saveDailyVanAssignment: (assignment: DailyVanAssignment) => Promise<OperationResult>;
  saveStaffAbsence: (absence: StaffAbsence) => Promise<OperationResult>;
  removeStaffAbsence: (id: string) => Promise<OperationResult>;
  saveVanMaintenanceLog: (log: VanMaintenanceLog) => Promise<OperationResult>;
};

const TeamStateContext = createContext<TeamStateValue | undefined>(undefined);

function sortStaff(items: StaffProfile[]) { return [...items].sort((a, b) => a.name.localeCompare(b.name)); }
function sortVans(items: Van[]) { return [...items].sort((a, b) => a.name.localeCompare(b.name)); }
function sortAssignments(items: DailyVanAssignment[]) { return [...items].sort((a, b) => `${b.date}-${a.vanId}`.localeCompare(`${a.date}-${b.vanId}`)); }
function sortAbsences(items: StaffAbsence[]) { return [...items].sort((a, b) => b.fromDate.localeCompare(a.fromDate)); }
function sortMaintenance(items: VanMaintenanceLog[]) { return [...items].sort((a, b) => b.date.localeCompare(a.date)); }

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (normalized.includes('permission') || normalized.includes('denied') || normalized.includes('insufficient')) {
    return 'Firebase rechazó la operación. Publica las reglas nuevas para personal, vans, despacho, ausencias y mantenimiento.';
  }
  if (normalized.includes('network') || normalized.includes('fetch')) return 'No se pudo conectar con Firebase. Revisa la conexión e intenta nuevamente.';
  return `No se pudieron sincronizar los datos de Equipo: ${message}`;
}

export function TeamStateProvider({ children }: { children: ReactNode }) {
  const { currentUser } = useCoreAppState();
  const [staffProfiles, setStaffProfiles] = useState<StaffProfile[]>(demoStaffProfiles);
  const [vans, setVans] = useState<Van[]>(demoTeamVans);
  const [dailyVanAssignments, setDailyVanAssignments] = useState<DailyVanAssignment[]>(demoDailyVanAssignments);
  const [staffAbsences, setStaffAbsences] = useState<StaffAbsence[]>(demoStaffAbsences);
  const [vanMaintenanceLogs, setVanMaintenanceLogs] = useState<VanMaintenanceLog[]>(demoVanMaintenanceLogs);
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamDataError, setTeamDataError] = useState<string | null>(null);

  const restoreDemo = useCallback(() => {
    setStaffProfiles(demoStaffProfiles);
    setVans(demoTeamVans);
    setDailyVanAssignments(demoDailyVanAssignments);
    setStaffAbsences(demoStaffAbsences);
    setVanMaintenanceLogs(demoVanMaintenanceLogs);
    setTeamDataError(null);
  }, []);

  const refreshTeamData = useCallback(async (showLoader = true) => {
    if (currentUser?.authProvider !== 'firebase') {
      restoreDemo();
      return;
    }
    if (showLoader) setTeamLoading(true);
    try {
      const [remoteStaff, remoteVans, remoteAssignments, remoteAbsences, remoteMaintenance] = await Promise.all([
        listFirestoreCollection<StaffProfile>('staffProfiles'),
        listFirestoreCollection<Van>('vans'),
        listFirestoreCollection<DailyVanAssignment>('dailyVanAssignments'),
        listFirestoreCollection<StaffAbsence>('staffAbsences'),
        listFirestoreCollection<VanMaintenanceLog>('vanMaintenanceLogs'),
      ]);
      setStaffProfiles(sortStaff(remoteStaff.length ? remoteStaff : demoStaffProfiles));
      setVans(sortVans(remoteVans.length ? remoteVans : demoTeamVans));
      setDailyVanAssignments(sortAssignments(remoteAssignments));
      setStaffAbsences(sortAbsences(remoteAbsences));
      setVanMaintenanceLogs(sortMaintenance(remoteMaintenance));
      setTeamDataError(null);
    } catch (error) {
      setTeamDataError(friendlyError(error));
    } finally {
      if (showLoader) setTeamLoading(false);
    }
  }, [currentUser?.authProvider, restoreDemo]);

  useEffect(() => { void refreshTeamData(true); }, [refreshTeamData, currentUser?.id]);

  useEffect(() => {
    if (currentUser?.authProvider !== 'firebase') return undefined;
    const timer = setInterval(() => { void refreshTeamData(false); }, SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [currentUser?.authProvider, refreshTeamData]);

  async function saveDocument<T extends { id: string }>(collection: string, item: T, setter: React.Dispatch<React.SetStateAction<T[]>>, sorter: (items: T[]) => T[]) {
    if (currentUser?.authProvider !== 'firebase') {
      setter((previous) => sorter([item, ...previous.filter((candidate) => candidate.id !== item.id)]));
      return { ok: true };
    }
    try {
      await saveFirestoreDocument(collection, item);
      setter((previous) => sorter([item, ...previous.filter((candidate) => candidate.id !== item.id)]));
      setTeamDataError(null);
      return { ok: true };
    } catch (error) {
      const message = friendlyError(error);
      setTeamDataError(message);
      return { ok: false, message };
    }
  }

  const saveStaffProfile = (profile: StaffProfile) => saveDocument('staffProfiles', profile, setStaffProfiles, sortStaff);
  const saveVanProfile = (van: Van) => saveDocument('vans', van, setVans, sortVans);
  const saveDailyVanAssignment = (assignment: DailyVanAssignment) => saveDocument('dailyVanAssignments', assignment, setDailyVanAssignments, sortAssignments);
  const saveStaffAbsence = (absence: StaffAbsence) => saveDocument('staffAbsences', absence, setStaffAbsences, sortAbsences);
  const saveVanMaintenanceLog = (log: VanMaintenanceLog) => saveDocument('vanMaintenanceLogs', log, setVanMaintenanceLogs, sortMaintenance);

  const removeStaffAbsence = async (id: string): Promise<OperationResult> => {
    if (currentUser?.authProvider !== 'firebase') {
      setStaffAbsences((previous) => previous.filter((item) => item.id !== id));
      return { ok: true };
    }
    try {
      await deleteFirestoreDocument('staffAbsences', id);
      setStaffAbsences((previous) => previous.filter((item) => item.id !== id));
      setTeamDataError(null);
      return { ok: true };
    } catch (error) {
      const message = friendlyError(error);
      setTeamDataError(message);
      return { ok: false, message };
    }
  };

  const value = useMemo<TeamStateValue>(() => ({
    staffProfiles,
    vans,
    dailyVanAssignments,
    staffAbsences,
    vanMaintenanceLogs,
    teamLoading,
    teamDataError,
    refreshTeamData: () => refreshTeamData(true),
    saveStaffProfile,
    saveVanProfile,
    saveDailyVanAssignment,
    saveStaffAbsence,
    removeStaffAbsence,
    saveVanMaintenanceLog,
  }), [staffProfiles, vans, dailyVanAssignments, staffAbsences, vanMaintenanceLogs, teamLoading, teamDataError, refreshTeamData]);

  return <TeamStateContext.Provider value={value}>{children}</TeamStateContext.Provider>;
}

export function useTeamState() {
  const context = useContext(TeamStateContext);
  if (!context) throw new Error('useTeamState debe utilizarse dentro de TeamStateProvider');
  return context;
}

// TeamScreen can use the same hook name while receiving core operational data plus team data.
export function useAppState() {
  const core = useCoreAppState();
  const team = useTeamState();
  return { ...core, ...team, dataError: team.teamDataError ?? core.dataError };
}
