import Link from 'next/link';
import { EmployeePayrollWorkspace } from '../../../../components/employees/employee-payroll-workspace';

export default function EmployeePayrollPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div>
          <div className="eyebrow">Workforce Management · Payroll</div>
          <h1>Payroll & Timesheet Review</h1>
          <p>Restricted review of the 27–26 payroll period. Normal scheduled attendance is assumed automatically; explicit records are needed only for exceptions such as overtime, late arrivals, AO/sick leave, vacation and No Work No Pay.</p>
        </div>
        <div className="page-actions"><Link className="btn" href="/employees/attendance">Attendance</Link><Link className="btn" href="/employees">Back to Employees</Link></div>
      </section>
      <EmployeePayrollWorkspace />
    </div>
  );
}
