import Link from 'next/link';
import { EmployeePayrollWorkspace } from '../../../../components/employees/employee-payroll-workspace';

export default function FinancePayrollPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div>
          <div className="eyebrow">Finance · Payroll Review</div>
          <h1>Payroll & Timesheet Review</h1>
          <p>Restricted 27–26 payroll review. Employee schedules provide the regular baseline; only payroll-relevant exceptions require explicit attendance records.</p>
        </div>
        <div className="page-actions"><Link className="btn" href="/employees">Employees</Link><Link className="btn" href="/finance">Finance Center</Link></div>
      </section>
      <EmployeePayrollWorkspace />
    </div>
  );
}
