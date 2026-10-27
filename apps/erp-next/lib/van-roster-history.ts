// Same effective-date projection as functions/vanRosterHistory.js; exercised by payroll tests.
export type CrewHistoryEntry = {
  effectiveFrom: string; at: string; actorId: string;
  value: { responsibleStaffId?: string; regularHelperId?: string; additionalHelperId?: string; technicianIds?: string[] };
};
export function crewForDate<T extends { crewHistory?: CrewHistoryEntry[] }>(van: T, date: string): T {
  const versions = van.crewHistory;
  if (!versions?.length) return van;
  const version = versions.filter(item => item.effectiveFrom <= date).reduce<CrewHistoryEntry | null>((latest, item) =>
    !latest || item.effectiveFrom > latest.effectiveFrom || (item.effectiveFrom === latest.effectiveFrom && String(item.at) >= String(latest.at)) ? item : latest, null);
  return version ? { ...van, ...version.value } : van;
}
