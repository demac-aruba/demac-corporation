import { BrowserWorkforceRegistry } from '../../../components/employees/browser-workforce-registry';

export default function EmployeesPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div><div className="eyebrow">Workforce Management</div><h1>Employees & Capacity</h1><p>Operational people data for scheduling, crew assignment, skills and readiness. Sensitive payroll remains restricted to authorized views.</p></div>
        <div className="page-actions"><button className="btn" type="button">Attendance</button></div>
      </section>

      <BrowserWorkforceRegistry />

      <section className="mo-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Workforce Rules</h2><span>Operational policy foundation</span></div></header><div className="mo-rule-list"><div><strong>Weekday shift</strong><span>08:00–17:00 · lunch 12:00–13:00</span></div><div><strong>Saturday shift</strong><span>09:00–13:00</span></div><div><strong>Overtime</strong><span>Tracked after 17:00 for accounting review</span></div><div><strong>Payroll privacy</strong><span>Owner/authorized finance sees full payroll; employee sees own information only</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Crew Readiness Intelligence</h2><span>How workforce data affects dispatch</span></div></header><div className="mo-callouts"><div className="warning"><strong>Unverified skills stay AT RISK</strong><p>The ERP does not assume a technician capability from van assignment alone. Verify the skill profile before it can produce READY evidence.</p></div><div><strong>Skill changes affect future start authority</strong><p>Work Orders recalculate Crew & Required Skill from the active roster. A previously issued AT RISK release remains governed by its stored risk snapshot.</p></div></div></article>
      </section>
    </div>
  );
}
