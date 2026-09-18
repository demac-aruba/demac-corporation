/** Budget forecasts are advisory. They never grant or deny real Van capacity. */
export type ProjectLaborBudgetSnapshot = {
  budgetHours: number;
  recordedActualHours: number;
  scheduledHoursBefore: number;
  requestedHours: number;
  committedHoursBefore: number;
  committedHoursAfter: number;
  remainingHoursBefore: number;
  remainingHoursAfter: number;
  overBudgetHoursBefore: number;
  overBudgetHoursAfter: number;
  additionalOverBudgetHours: number;
  actualOverBudgetHours: number;
};

type BudgetSource = {
  estimatedLaborHours: number;
  actualLaborHours: number;
  scheduledFutureHours: number;
};

function hours(value: number, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number.`);
  }
  // Keep sub-minute precision without false overruns caused by floating-point sums.
  return Number(value.toFixed(6));
}

export function calculateProjectLaborBudget(source: BudgetSource, requestedHours = 0): ProjectLaborBudgetSnapshot {
  const budgetHours = hours(source.estimatedLaborHours, 'Project labor budget');
  const recordedActualHours = hours(source.actualLaborHours, 'Recorded actual hours');
  const scheduledHoursBefore = hours(source.scheduledFutureHours, 'Scheduled project hours');
  const requested = hours(requestedHours, 'Requested project hours');
  const committedHoursBefore = hours(recordedActualHours + scheduledHoursBefore, 'Committed project hours');
  const committedHoursAfter = hours(committedHoursBefore + requested, 'Projected committed hours');
  const overBudgetHoursBefore = hours(Math.max(0, committedHoursBefore - budgetHours), 'Prior overrun');
  const overBudgetHoursAfter = hours(Math.max(0, committedHoursAfter - budgetHours), 'Projected overrun');
  return {
    budgetHours,
    recordedActualHours,
    scheduledHoursBefore,
    requestedHours: requested,
    committedHoursBefore,
    committedHoursAfter,
    remainingHoursBefore: hours(Math.max(0, budgetHours - committedHoursBefore), 'Budget remaining'),
    remainingHoursAfter: hours(Math.max(0, budgetHours - committedHoursAfter), 'Projected budget remaining'),
    overBudgetHoursBefore,
    overBudgetHoursAfter,
    additionalOverBudgetHours: hours(Math.max(0, overBudgetHoursAfter - overBudgetHoursBefore), 'Additional overrun'),
    actualOverBudgetHours: hours(Math.max(0, recordedActualHours - budgetHours), 'Recorded actual overrun'),
  };
}
