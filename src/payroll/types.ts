export type PayrollEmployeeType = 'Técnico' | 'Secretaria' | 'Administración' | 'Otro';

export type PayrollDayStatus =
  | 'Regular'
  | 'AO parcial'
  | 'AO completo'
  | 'No Work No Pay parcial'
  | 'No Work No Pay completo'
  | 'Día libre programado'
  | 'Sin jornada';

export interface PayrollEmployee {
  id: string;
  name: string;
  role: string;
  employeeType: PayrollEmployeeType;
  active: boolean;
  sourceStaffId?: string;
  weekdayHours: number;
  saturdayHours: number;
  weeklyHalfDayWeekday?: number;
  halfDayEffectiveFrom?: string;
  halfDayWorkedHours: number;
  halfDayPaidFreeHours: number;
  createdAt?: string;
  updatedAt?: string;
  createdByUserId?: string;
  createdByName?: string;
}

export interface EmployeeTimesheetEntry {
  id: string;
  payrollPeriodId: string;
  employeeId: string;
  employeeName: string;
  date: string;
  scheduledWorkHours: number;
  paidFreeHours: number;
  regularHours: number;
  overtimeHours: number;
  aoHours: number;
  noWorkNoPayHours: number;
  status: PayrollDayStatus;
  notes?: string;
  createdAt?: string;
  updatedAt: string;
  updatedByUserId?: string;
  updatedByName?: string;
}

export interface PayrollPeriod {
  id: string;
  startDate: string;
  endDate: string;
  label: string;
}

export interface PayrollDayCalculation {
  employeeId: string;
  date: string;
  scheduledWorkHours: number;
  paidFreeHours: number;
  regularHours: number;
  overtimeHours: number;
  aoHours: number;
  noWorkNoPayHours: number;
  status: PayrollDayStatus;
  notes: string;
  savedEntry?: EmployeeTimesheetEntry;
}

export interface PayrollEmployeeSummary {
  employee: PayrollEmployee;
  regularHours: number;
  overtimeHours: number;
  aoHours: number;
  noWorkNoPayHours: number;
  paidFreeHours: number;
  payableHours: number;
  changedDays: number;
}
