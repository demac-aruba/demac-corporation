export type PayrollAdjustmentType = 'bonus' | 'deduction';
export type PayrollAdjustmentStatus = 'active' | 'voided';

export interface PayrollAdjustment {
  id: string;
  payrollPeriodId: string;
  employeeId: string;
  employeeName: string;
  type: PayrollAdjustmentType;
  amountAfl: number;
  date: string;
  concept: string;
  status: PayrollAdjustmentStatus;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: string;
  createdByName?: string;
  voidedAt?: string;
  voidedByUserId?: string;
  voidedByName?: string;
  voidReason?: string;
}

export type PayrollAdjustmentTotals = {
  bonusesAfl: number;
  deductionsAfl: number;
};

export function activePayrollAdjustments(adjustments: PayrollAdjustment[]) {
  return adjustments.filter((adjustment) => adjustment.status === 'active');
}

export function payrollAdjustmentTotals(
  adjustments: PayrollAdjustment[],
  employeeId?: string,
): PayrollAdjustmentTotals {
  return activePayrollAdjustments(adjustments)
    .filter((adjustment) => !employeeId || adjustment.employeeId === employeeId)
    .reduce((totals, adjustment) => {
      const amount = Math.max(0, Number(adjustment.amountAfl || 0));
      if (adjustment.type === 'bonus') totals.bonusesAfl += amount;
      else totals.deductionsAfl += amount;
      return totals;
    }, { bonusesAfl: 0, deductionsAfl: 0 });
}
