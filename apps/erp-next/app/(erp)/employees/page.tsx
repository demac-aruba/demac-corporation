import Link from 'next/link';
import { EmployeeProfileWorkspace } from '../../../components/employees/employee-profile-workspace';

export default function EmployeesPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div><div className="eyebrow">Workforce Management</div><h1>Employees & Capacity</h1><p>One canonical employee registry for active staff, former employees, scheduling, crew assignment, attendance, payroll review and secure system access.</p></div>
        <div className="page-actions"><Link className="btn" href="/employees/attendance">Attendance</Link><Link className="btn" href="/employees/payroll">Payroll</Link></div>
      </section>

      <EmployeeProfileWorkspace />

      <section className="mo-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Workforce Rules</h2><span>Operational policy foundation</span></div></header><div className="mo-rule-list"><div><strong>Weekday shift</strong><span>08:00–17:00 · lunch 12:00–13:00</span></div><div><strong>Saturday shift</strong><span>09:00–13:00</span></div><div><strong>Payroll cycle</strong><span>27th through 26th · restricted review</span></div><div><strong>Offboarding</strong><span>Archive employees; never delete historical work, attendance or payroll identity</span></div><div><strong>Payroll privacy</strong><span>Owner/authorized finance sees full payroll; employee sees no company-wide payroll view</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Crew Readiness Intelligence</h2><span>How workforce data affects dispatch</span></div></header><div className="mo-callouts"><div className="warning"><strong>Canonical crew first</strong><p>Technician and helper identity comes from Firestore staffProfiles, vans and dailyVanAssignments—the same operational records Booking Authority uses.</p></div><div><strong>Identity is separate from the email address</strong><p>A fixed DEMAC office email may be reassigned after offboarding, but every employee receives a distinct Firebase user identity and a new password setup.</p></div><div><strong>Access is separate from job title</strong><p>An employee can be a Secretaria operationally while receiving the Office / Scheduling access role. Job labels never silently grant system permissions.</p></div><div><strong>Skills still require evidence</strong><p>The ERP should not infer a technician capability from van assignment alone. Skill verification remains a separate readiness control before a job can be treated as fully READY.</p></div></div></article>
      </section>
    </div>
  );
}
