import Link from 'next/link';
import { EmployeeManagementWorkspace } from '../../../components/employees/employee-management-workspace';

export default function EmployeesPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div><div className="eyebrow">Workforce Management</div><h1>Employees & Capacity</h1><p>One canonical employee registry for scheduling, crew assignment, availability, attendance and secure system access. Sensitive payroll remains restricted to authorized views.</p></div>
        <div className="page-actions"><Link className="btn" href="/employees/attendance">Attendance</Link></div>
      </section>

      <EmployeeManagementWorkspace />

      <section className="mo-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Workforce Rules</h2><span>Operational policy foundation</span></div></header><div className="mo-rule-list"><div><strong>Weekday shift</strong><span>08:00–17:00 · lunch 12:00–13:00</span></div><div><strong>Saturday shift</strong><span>09:00–13:00</span></div><div><strong>Overtime</strong><span>Tracked after 17:00 for accounting review</span></div><div><strong>Payroll privacy</strong><span>Owner/authorized finance sees full payroll; employee sees own information only</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Crew Readiness Intelligence</h2><span>How workforce data affects dispatch</span></div></header><div className="mo-callouts"><div className="warning"><strong>Canonical crew first</strong><p>Technician and helper identity comes from Firestore staffProfiles, vans and dailyVanAssignments—the same operational records Booking Authority uses.</p></div><div><strong>Access is separate from job title</strong><p>An employee can be a Secretaria operationally while receiving the Office / Scheduling access role. This prevents job labels from silently granting system permissions.</p></div><div><strong>Skills still require evidence</strong><p>The ERP should not infer a technician capability from van assignment alone. Skill verification remains a separate readiness control before a job can be treated as fully READY.</p></div></div></article>
      </section>
    </div>
  );
}
