import Link from 'next/link';
import { EmployeePayrollWorkspace } from '../../../../components/employees/employee-payroll-workspace';

export default function EmployeePayrollPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div>
          <div className="eyebrow">Workforce Management · Payroll</div>
          <h1>Payroll & Timesheet Review</h1>
          <p>Restricted review of the 27–26 payroll period, scheduled base hours, overtime, AO/sick leave, vacation, No Work No Pay and paid-free time.</p>
        </div>
        <div className="page-actions"><Link className="btn" href="/employees/attendance">Attendance</Link><Link className="btn" href="/employees">Back to Employees</Link></div>
      </section>
      <EmployeePayrollWorkspace />
    </div>
  );
}
