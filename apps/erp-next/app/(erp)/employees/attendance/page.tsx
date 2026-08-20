import Link from 'next/link';
import { EmployeeAttendanceCommandCenter } from '../../../../components/employees/employee-attendance-command-center';

export default function EmployeeAttendancePage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div>
          <div className="eyebrow">Workforce Management · Payroll Inputs</div>
          <h1>Attendance & Payroll Inputs</h1>
          <p>Period-based workforce control for worked hours, overtime, AO, vacation, No Work No Pay, paid-free half-days and salary advances. Payroll input periods close on the 26th; final statutory payroll remains with accounting.</p>
        </div>
        <div className="page-actions"><Link className="btn" href="/employees">Back to Employees</Link></div>
      </section>
      <EmployeeAttendanceCommandCenter />
    </div>
  );
}
