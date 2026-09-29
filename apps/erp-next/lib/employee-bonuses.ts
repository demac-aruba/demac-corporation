import type { CanonicalStaffProfile } from './canonical-operations';
import { payrollPeriodBounds, payrollSettingsForEmployee, type EmployeePayrollSettings, type PayrollPeriodBounds } from './employee-attendance';
import { mutateFirestoreDocument } from './firebase/firestore-rest';
import type { AuthPrincipal } from './security';

// Existing Legacy contract: employeePayrollSettings/{owner}.payrollAdjustments.
// Deductions stay in the same array and are never changed by the bonus editor.
export type PayrollAdjustment = {
  id: string; payrollPeriodId: string; employeeId: string; employeeName: string;
  type: 'bonus' | 'deduction'; amountAfl: number; date: string; concept: string;
  status: 'active' | 'voided'; createdAt: string; updatedAt: string;
  createdByUserId?: string; createdByName?: string;
  category?: BonusCategory;
  voidedAt?: string; voidedByUserId?: string; voidedByName?: string; voidReason?: string;
};

export const BONUS_CATEGORIES = {
  perfect_attendance: 'Perfect Attendance', achievement: 'Achievement / Performance',
  service_sales: 'Service Sales', equipment_sales: 'Air Conditioner Sales', other: 'Other Bonus',
} as const;
export type BonusCategory = keyof typeof BONUS_CATEGORIES;
export type PayrollBonus = PayrollAdjustment & { settingsId: string; canonicalEmployeeId: string };
export type BonusDraft = { id: string; employeeId: string; date: string; amount: string; category: BonusCategory; concept: string };

const normalizedName = (name?: string) => String(name ?? '').trim().toLocaleLowerCase('es').replace(/\s+/g, ' ');
function ownerFor(settings: EmployeePayrollSettings, employees: CanonicalStaffProfile[]) {
  if (settings.sourceStaffId) return employees.find((employee) => employee.id === settings.sourceStaffId);
  const exact = employees.find((employee) => employee.id === settings.id);
  if (exact) return exact;
  const matches = employees.filter((employee) => normalizedName(settings.name) && normalizedName(employee.name) === normalizedName(settings.name));
  return matches.length === 1 ? matches[0] : undefined;
}

export function canManageBonuses(principal: AuthPrincipal) {
  return principal.active && (principal.role === 'super_admin' || principal.role === 'finance' || principal.capabilities.has('payroll_sensitive.view'));
}

export function payrollBonusReport(settings: EmployeePayrollSettings[], employees: CanonicalStaffProfile[], period: PayrollPeriodBounds) {
  const bonuses: PayrollBonus[] = [], issues: string[] = [];
  const seen = new Set<string>();
  for (const document of settings) {
    if (document.payrollAdjustments !== undefined && !Array.isArray(document.payrollAdjustments)) { issues.push(`Invalid bonus history in payroll record ${document.id}.`); continue; }
    const owner = ownerFor(document, employees);
    for (const adjustment of document.payrollAdjustments ?? []) {
      if (!adjustment || typeof adjustment !== 'object') { issues.push(`Invalid bonus entry in payroll record ${document.id}.`); continue; }
      if (adjustment.type !== 'bonus' || adjustment.payrollPeriodId !== period.id) continue;
      if (!owner || ![document.id, owner.id].includes(adjustment.employeeId)) {
        issues.push(`Review employee linkage for bonus ${adjustment.id}; it cannot be assigned safely.`); continue;
      }
      if (seen.has(adjustment.id)) { issues.push(`Duplicate bonus identifier ${adjustment.id}; review before exporting.`); continue; }
      seen.add(adjustment.id);
      if (!adjustment.id || typeof adjustment.date !== 'string' || typeof adjustment.concept !== 'string'
        || !Number.isFinite(adjustment.amountAfl) || adjustment.amountAfl <= 0 || !['active', 'voided'].includes(adjustment.status)) {
        issues.push(`Review details/amount/status for bonus ${adjustment.id}.`); continue;
      }
      bonuses.push({ ...adjustment, settingsId: document.id, canonicalEmployeeId: owner.id, employeeName: owner.name ?? adjustment.employeeName });
    }
  }
  bonuses.sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')));
  const byEmployee: Record<string, number> = Object.create(null);
  const detailsByEmployee: Record<string, string> = Object.create(null);
  for (const bonus of bonuses.filter((item) => item.status === 'active')) {
    const id = bonus.canonicalEmployeeId;
    byEmployee[id] = Math.round(((byEmployee[id] ?? 0) + bonus.amountAfl) * 100) / 100;
    const detail = `${bonus.date} · ${bonus.category ? BONUS_CATEGORIES[bonus.category] ?? 'Bonus' : 'Bonus'} · ${bonus.concept} · Afl. ${bonus.amountAfl.toFixed(2)}`;
    detailsByEmployee[id] = [detailsByEmployee[id], detail].filter(Boolean).join(' | ');
  }
  return { bonuses, issues, byEmployee, detailsByEmployee, total: Math.round(Object.values(byEmployee).reduce((sum, amount) => sum + amount, 0) * 100) / 100 };
}

export function payrollBonusCsv(bonuses: PayrollBonus[]) {
  const rows = [['Employee', 'Date', 'Category', 'Concept / Reason', 'Amount Afl.', 'Status', 'Payroll Period', 'Recorded By', 'Void Reason'],
    ...bonuses.map((item) => [item.employeeName, item.date, item.category ? BONUS_CATEGORIES[item.category] ?? 'Bonus' : 'Bonus', item.concept, item.amountAfl.toFixed(2), item.status, item.payrollPeriodId, item.createdByName ?? '', item.voidReason ?? ''])];
  return '\uFEFF' + rows.map((row) => row.map((cell) => `"${String(cell).replace(/^\s*[=+@-]/, "'$&").replaceAll('"', '""')}"`).join(',')).join('\n');
}

function assertPermission(principal: AuthPrincipal) {
  if (!canManageBonuses(principal)) throw new Error('Bonuses are restricted to authorized payroll users.');
}
function validateOwner(current: EmployeePayrollSettings | null, employee: CanonicalStaffProfile, settingsId: string) {
  if (!current) {
    if (settingsId !== employee.id) throw new Error('The linked payroll settings record no longer exists. Refresh before saving.');
    return;
  }
  if ('recordType' in current || ownerFor(current, [employee])?.id !== employee.id) throw new Error('Payroll employee linkage changed. Refresh before saving.');
  if (current.payrollAdjustments !== undefined && !Array.isArray(current.payrollAdjustments)) throw new Error('Invalid payroll adjustment history. Review before saving.');
}

export async function saveEmployeeBonus(input: {
  employee: CanonicalStaffProfile; employees: CanonicalStaffProfile[]; settings: EmployeePayrollSettings[];
  period: PayrollPeriodBounds; draft: BonusDraft; principal: AuthPrincipal;
}) {
  assertPermission(input.principal);
  const { employee, draft, period, principal } = input;
  if (!employee.id || draft.employeeId !== employee.id || !draft.id || !/^[a-zA-Z0-9_-]+$/.test(draft.id)) throw new Error('Choose a valid employee and bonus request.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || new Date(`${draft.date}T12:00:00Z`).toISOString().slice(0, 10) !== draft.date
    || draft.date < period.start || draft.date > period.end || payrollPeriodBounds(draft.date).id !== period.id) throw new Error('Bonus date must be inside the selected payroll period.');
  const amountText = draft.amount.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(amountText) || !Number.isFinite(Number(amountText)) || Number(amountText) <= 0 || !Number.isSafeInteger(Math.round(Number(amountText) * 100))) throw new Error('Enter a positive Afl. amount with at most two decimals.');
  if (!Object.hasOwn(BONUS_CATEGORIES, draft.category)) throw new Error('Select a bonus category.');
  const concept = draft.concept.trim();
  if (!concept || concept.length > 500) throw new Error('Enter a concept/reason of 1 to 500 characters.');
  const linked = payrollSettingsForEmployee(input.settings, employee);
  if (!linked && input.settings.some((item) => normalizedName(item.name) === normalizedName(employee.name))) throw new Error('Ambiguous payroll employee linkage. Review before saving a bonus.');
  if (linked && ownerFor(linked, input.employees)?.id !== employee.id) throw new Error('Ambiguous payroll employee linkage. Review before saving a bonus.');
  const settingsId = linked?.id ?? employee.id;
  const amountAfl = Math.round(Number(amountText) * 100) / 100;
  return mutateFirestoreDocument<EmployeePayrollSettings>('employeePayrollSettings', settingsId, (current) => {
    validateOwner(current, employee, settingsId);
    const entries = current?.payrollAdjustments ?? [];
    const existing = entries.find((entry) => entry.id === draft.id);
    if (existing) {
      if (existing.type !== 'bonus' || existing.status !== 'active' || existing.employeeId !== employee.id || existing.payrollPeriodId !== period.id
        || existing.date !== draft.date || existing.amountAfl !== amountAfl || existing.concept !== concept || existing.category !== draft.category || existing.createdByUserId !== principal.userId) {
        throw new Error('This bonus request already exists with different details. Refresh and review its history.');
      }
      return null;
    }
    const now = new Date().toISOString();
    const bonus: PayrollAdjustment = { id: draft.id, employeeId: employee.id, employeeName: employee.name ?? '', type: 'bonus',
      payrollPeriodId: period.id, date: draft.date, category: draft.category, concept, amountAfl, status: 'active',
      createdAt: now, updatedAt: now, createdByUserId: principal.userId, createdByName: principal.displayName };
    return { payrollAdjustments: [...entries, bonus], ...(!current ? { sourceStaffId: employee.id, name: employee.name ?? '' } : {}) };
  });
}

export async function voidEmployeeBonus(input: { bonus: PayrollBonus; employee: CanonicalStaffProfile; reason: string; principal: AuthPrincipal }) {
  assertPermission(input.principal);
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) throw new Error('Enter a cancellation reason of 1 to 500 characters.');
  return mutateFirestoreDocument<EmployeePayrollSettings>('employeePayrollSettings', input.bonus.settingsId, (current) => {
    validateOwner(current, input.employee, input.bonus.settingsId);
    const entries = current?.payrollAdjustments ?? [];
    const existing = entries.find((entry) => entry.id === input.bonus.id);
    if (!existing || existing.type !== 'bonus' || ![input.bonus.settingsId, input.employee.id].includes(existing.employeeId)) throw new Error('Bonus no longer matches this employee. Refresh and review.');
    if (existing.amountAfl !== input.bonus.amountAfl || existing.concept !== input.bonus.concept || existing.date !== input.bonus.date || existing.payrollPeriodId !== input.bonus.payrollPeriodId) throw new Error('Bonus details changed. Refresh and review before cancelling.');
    if (existing.status === 'voided') return null;
    const now = new Date().toISOString();
    return { payrollAdjustments: entries.map((entry) => entry.id !== existing.id ? entry : { ...entry, status: 'voided', updatedAt: now,
      voidedAt: now, voidReason: reason, voidedByUserId: input.principal.userId, voidedByName: input.principal.displayName }) };
  });
}
