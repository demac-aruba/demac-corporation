import { callOfficeBookingAuthority } from './office-booking-authority';
export type VanRosterRow = {
  id: string; vanId: string; name: string; status: string;
  responsibleStaffId: string; regularHelperId: string; additionalHelperId: string;
  schedule: { id: string; weekday: number | null; active: boolean; workdayStart: string; workdayEnd: string } | null;
};
export type VanRoster = {
  success: true; token: string; effectiveDate: string; rows: VanRosterRow[];
  staff: { id: string; name: string; canDriveVan: boolean }[];
};
export type VanRosterRequest = { expectedToken: string; effectiveDate: string; requestId: string; rows: VanRosterRow[] };
export type VanRosterResult = { success: true; effectiveDate: string; changedVans: number; updatedWorkOrders: number; updatedAppointments: number; updatedProjects: number; replayed?: boolean };
export const loadVanRoster = () => callOfficeBookingAuthority<VanRoster>('get_van_roster', {}, 30000);
export const saveVanRoster = (request: VanRosterRequest) => callOfficeBookingAuthority<VanRosterResult>('save_van_roster', request, 55000);
export function rosterCrewChanged(rows: VanRosterRow[], baseline: VanRosterRow[]) {
  return rows.some(row => {
    const before = baseline.find(item => item.id === row.id);
    return !before || row.responsibleStaffId !== before.responsibleStaffId || row.regularHelperId !== before.regularHelperId || row.additionalHelperId !== before.additionalHelperId;
  });
}
