import { useCallback, useEffect, useMemo, useState } from 'react';
import { listFirestoreCollection, saveFirestoreDocument } from '../services/firebase';
import { StaffProfile, User } from '../types';
import {
  EmployeeTimesheetEntry,
  PayrollDayCalculation,
  PayrollDayStatus,
  PayrollEmployee,
  PayrollEmployeeSummary,
  PayrollEmployeeType,
  PayrollPeriod,
} from '../payroll/types';

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseIsoDate(value: string) {
  return new Date(`${value}T12:00:00Z`);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : 0));
}

function roundHours(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function employeeTypeFromStaff(profile: StaffProfile): PayrollEmployeeType {
  if (profile.employeeType) return profile.employeeType;
  if (['Técnico responsable', 'Técnico', 'Ayudante', 'Supervisor'].includes(profile.role)) return 'Técnico';
  if (profile.role === 'Secretaria') return 'Secretaria';
  if (['Administración', 'Contabilidad', 'Almacén'].includes(profile.role)) return 'Administración';
  return 'Otro';
}

function employeeFromStaff(profile: StaffProfile): PayrollEmployee {
  const employeeType = employeeTypeFromStaff(profile);
  const technical = employeeType === 'Técnico';
  const secretarial = employeeType === 'Secretaria';
  return {
    id: profile.id,
    sourceStaffId: profile.id,
    name: profile.name,
    role: profile.role,
    employeeType,
    active: profile.active,
    weekdayHours: 8,
    saturdayHours: technical ? 4 : 0,
    halfDayEffectiveFrom: technical ? '2026-08-01' : secretarial ? '2026-01-01' : undefined,
    halfDayWorkedHours: technical ? 5 : secretarial ? 4 : 8,
    halfDayPaidFreeHours: technical ? 3 : secretarial ? 4 : 0,
  };
}

function sortEmployees(items: PayrollEmployee[]) {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
}

export function payrollPeriodForReference(reference = new Date()): PayrollPeriod {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const endMonth = reference.getDate() <= 26 ? month : month + 1;
  const endDate = new Date(Date.UTC(year, endMonth, 26, 12));
  const startDate = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 1, 27, 12));
  return payrollPeriodFromEndDate(isoDate(endDate), isoDate(startDate));
}

export function payrollPeriodFromEndDate(endDateValue: string, providedStart?: string): PayrollPeriod {
  const endDate = parseIsoDate(endDateValue);
  const startDate = providedStart
    ? parseIsoDate(providedStart)
    : new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 1, 27, 12));
  const start = isoDate(startDate);
  const end = isoDate(endDate);
  const formatter: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return {
    id: `${start}_${end}`,
    startDate: start,
    endDate: end,
    label: `${startDate.toLocaleDateString('es-AW', formatter)} - ${endDate.toLocaleDateString('es-AW', formatter)}`,
  };
}

export function shiftPayrollPeriod(period: PayrollPeriod, months: number) {
  const end = parseIsoDate(period.endDate);
  const shifted = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + months, 26, 12));
  return payrollPeriodFromEndDate(isoDate(shifted));
}

export function payrollPeriodDates(period: PayrollPeriod) {
  const dates: string[] = [];
  const cursor = parseIsoDate(period.startDate);
  const end = parseIsoDate(period.endDate);
  while (cursor <= end) {
    dates.push(isoDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

export function employeeScheduleForDate(employee: PayrollEmployee, date: string) {
  const parsed = parseIsoDate(date);
  const weekday = parsed.getUTCDay();
  if (weekday === 0) return { scheduledWorkHours: 0, paidFreeHours: 0 };

  // El horario regular aplica de lunes a sábado. El medio día semanal se configura por separado.
  let scheduledWorkHours = Number(employee.weekdayHours ?? 8);
  let paidFreeHours = 0;
  const halfDayActive = employee.weeklyHalfDayWeekday !== undefined
    && employee.halfDayEffectiveFrom
    && date >= employee.halfDayEffectiveFrom
    && weekday === employee.weeklyHalfDayWeekday;

  if (halfDayActive) {
    scheduledWorkHours = Number(employee.halfDayWorkedHours ?? scheduledWorkHours);
    paidFreeHours = Number(employee.halfDayPaidFreeHours ?? 0);
  }

  return {
    scheduledWorkHours: roundHours(Math.max(0, scheduledWorkHours)),
    paidFreeHours: roundHours(Math.max(0, paidFreeHours)),
  };
}

function statusForDay(scheduledWorkHours: number, paidFreeHours: number, aoHours: number, noWorkNoPayHours: number): PayrollDayStatus {
  if (scheduledWorkHours <= 0 && paidFreeHours <= 0) return 'Sin jornada';
  if (scheduledWorkHours <= 0 && paidFreeHours > 0) return 'Día libre programado';
  if (aoHours >= scheduledWorkHours && scheduledWorkHours > 0) return 'AO completo';
  if (aoHours > 0) return 'AO parcial';
  if (noWorkNoPayHours >= scheduledWorkHours && scheduledWorkHours > 0) return 'No Work No Pay completo';
  if (noWorkNoPayHours > 0) return 'No Work No Pay parcial';
  return 'Regular';
}

export function calculatePayrollDay(employee: PayrollEmployee, date: string, entry?: EmployeeTimesheetEntry): PayrollDayCalculation {
  const schedule = employeeScheduleForDate(employee, date);
  const scheduled = entry?.scheduledWorkHours ?? schedule.scheduledWorkHours;
  const paidFree = entry?.paidFreeHours ?? schedule.paidFreeHours;
  const aoHours = clamp(entry?.aoHours ?? 0, 0, scheduled);
  const noWorkNoPayHours = clamp(entry?.noWorkNoPayHours ?? 0, 0, Math.max(0, scheduled - aoHours));
  const regularHours = roundHours(Math.max(0, scheduled - aoHours - noWorkNoPayHours));
  const overtimeHours = roundHours(Math.max(0, Number(entry?.overtimeHours ?? 0)));
  return {
    employeeId: employee.id,
    date,
    scheduledWorkHours: roundHours(scheduled),
    paidFreeHours: roundHours(paidFree),
    regularHours,
    overtimeHours,
    aoHours: roundHours(aoHours),
    noWorkNoPayHours: roundHours(noWorkNoPayHours),
    status: statusForDay(scheduled, paidFree, aoHours, noWorkNoPayHours),
    notes: entry?.notes ?? '',
    savedEntry: entry,
  };
}

export function summarizeEmployee(employee: PayrollEmployee, period: PayrollPeriod, entries: EmployeeTimesheetEntry[]): PayrollEmployeeSummary {
  const employeeEntries = new Map(entries.filter((entry) => entry.employeeId === employee.id).map((entry) => [entry.date, entry]));
  const days = payrollPeriodDates(period).map((date) => calculatePayrollDay(employee, date, employeeEntries.get(date)));
  const total = (key: keyof Pick<PayrollDayCalculation, 'regularHours' | 'overtimeHours' | 'aoHours' | 'noWorkNoPayHours' | 'paidFreeHours'>) => roundHours(days.reduce((sum, day) => sum + Number(day[key]), 0));
  const regularHours = total('regularHours');
  const overtimeHours = total('overtimeHours');
  const aoHours = total('aoHours');
  const noWorkNoPayHours = total('noWorkNoPayHours');
  const paidFreeHours = total('paidFreeHours');
  return {
    employee,
    regularHours,
    overtimeHours,
    aoHours,
    noWorkNoPayHours,
    paidFreeHours,
    payableHours: roundHours(regularHours + overtimeHours + aoHours + paidFreeHours),
    changedDays: employeeEntries.size,
  };
}

export function usePayrollModule(currentUser: User | null, staffProfiles: StaffProfile[]) {
  const firebase = currentUser?.authProvider === 'firebase';
  const [savedEmployees, setSavedEmployees] = useState<PayrollEmployee[]>([]);
  const [entries, setEntries] = useState<EmployeeTimesheetEntry[]>([]);
  const [loading, setLoading] = useState(firebase);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!firebase) return;
    setLoading(true);
    try {
      const [remoteEmployees, remoteEntries] = await Promise.all([
        listFirestoreCollection<PayrollEmployee>('employeePayrollSettings'),
        listFirestoreCollection<EmployeeTimesheetEntry>('employeeTimesheets'),
      ]);
      setSavedEmployees(sortEmployees(remoteEmployees));
      setEntries(remoteEntries);
      setError('');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.toLowerCase().includes('permission') || message.toLowerCase().includes('denied')
        ? 'Firebase rechazó el módulo de nómina. Publica las reglas nuevas de Firestore.'
        : `No se pudo cargar Timesheet: ${message}`);
    } finally {
      setLoading(false);
    }
  }, [firebase]);

  useEffect(() => { void refresh(); }, [refresh, currentUser?.id]);

  const employees = useMemo(() => {
    const merged = new Map<string, PayrollEmployee>();
    staffProfiles.map(employeeFromStaff).forEach((employee) => merged.set(employee.id, employee));
    savedEmployees.forEach((employee) => {
      const masterId = employee.sourceStaffId ?? employee.id;
      const master = merged.get(masterId);
      if (!master) return;
      merged.set(masterId, {
        ...master,
        ...employee,
        id: masterId,
        sourceStaffId: masterId,
        name: master.name,
        role: master.role,
        active: master.active,
      });
    });
    return sortEmployees([...merged.values()]);
  }, [savedEmployees, staffProfiles]);

  async function saveEmployee(employee: PayrollEmployee) {
    if (!staffProfiles.some((profile) => profile.id === (employee.sourceStaffId ?? employee.id))) {
      const message = 'Primero crea el perfil maestro del empleado en Empleados.';
      setError(message);
      return { ok: false, message };
    }
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const updated: PayrollEmployee = {
        ...employee,
        updatedAt: now,
        createdAt: employee.createdAt ?? now,
        createdByUserId: employee.createdByUserId ?? currentUser?.id,
        createdByName: employee.createdByName ?? currentUser?.name,
      };
      if (firebase) await saveFirestoreDocument('employeePayrollSettings', updated);
      setSavedEmployees((previous) => sortEmployees([updated, ...previous.filter((candidate) => candidate.id !== updated.id)]));
      setError('');
      return { ok: true };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }

  async function saveEntry(entry: EmployeeTimesheetEntry) {
    setBusy(true);
    try {
      if (firebase) await saveFirestoreDocument('employeeTimesheets', entry);
      setEntries((previous) => [entry, ...previous.filter((candidate) => candidate.id !== entry.id)]);
      setError('');
      return { ok: true };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      return { ok: false, message };
    } finally {
      setBusy(false);
    }
  }

  const entryByEmployeeDate = useMemo(() => new Map(entries.map((entry) => [`${entry.employeeId}_${entry.date}`, entry])), [entries]);

  return {
    employees,
    entries,
    entryByEmployeeDate,
    loading,
    busy,
    error,
    refresh,
    saveEmployee,
    saveEntry,
  };
}
