import Link from 'next/link';
import { EmployeeAttendanceWorkspace } from '../../../../components/employees/employee-attendance-workspace';

export default function EmployeeAttendancePage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div>
          <div className="eyebrow">Workforce Management · Attendance</div>
          <h1>Attendance & Timekeeping</h1>
          <p>Calendar-based attendance for regular hours, late arrivals, sickness/AO, vacation, days off, No Work No Pay and overtime. Operational absences remain synchronized with dispatch availability.</p>
        </div>
        <div className="page-actions"><Link className="btn" href="/employees">Back to Employees</Link></div>
      </section>
      <EmployeeAttendanceWorkspace />
    </div>
  );
}
