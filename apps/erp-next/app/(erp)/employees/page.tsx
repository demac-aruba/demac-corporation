import { employees } from '@/lib/management-operations';

export default function EmployeesPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div><div className="eyebrow">Workforce Management</div><h1>Employees & Capacity</h1><p>Operational people data for scheduling, skills, attendance and performance. Sensitive payroll remains restricted to authorized views.</p></div>
        <div className="page-actions"><button className="btn" type="button">Attendance</button><button className="btn primary" type="button">+ Employee</button></div>
      </section>

      <section className="mo-metric-grid">
        <article><span>Active Field Staff</span><strong>7</strong><small>Across 4 vans</small></article>
        <article><span>Average Utilization</span><strong>77%</strong><small className="mo-good">Healthy operating range</small></article>
        <article><span>Overtime Today</span><strong>5h 05m</strong><small>After 17:00 policy applies</small></article>
        <article><span>Skill Gaps</span><strong>2</strong><small className="mo-warn">Commercial / VRF coverage</small></article>
      </section>

      <section className="panel mo-table-panel">
        <header className="panel-head"><div><h2>Field Workforce</h2><span>Skills, current assignment and operational utilization</span></div><span>Live preview</span></header>
        <div className="mo-table mo-employee-table">
          <div className="mo-tr mo-th"><span>Employee</span><span>Team</span><span>Skills</span><span>Utilization</span><span>Overtime</span><span>Next</span></div>
          {employees.map((employee) => (
            <div className="mo-tr" key={employee.name}>
              <div><strong>{employee.name}</strong><small>{employee.role} · {employee.status}</small></div>
              <span>{employee.team}</span>
              <div className="mo-skill-list">{employee.skills.map((skill) => <b key={skill}>{skill}</b>)}</div>
              <div><strong>{employee.utilization}%</strong><div className="mo-bar"><i style={{ width: `${employee.utilization}%` }} /></div></div>
              <span>{employee.overtime}</span>
              <span>{employee.next}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="mo-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Workforce Rules</h2><span>Operational policy foundation</span></div></header><div className="mo-rule-list"><div><strong>Weekday shift</strong><span>08:00–17:00 · lunch 12:00–13:00</span></div><div><strong>Saturday shift</strong><span>09:00–13:00</span></div><div><strong>Overtime</strong><span>Tracked after 17:00 for accounting review</span></div><div><strong>Payroll privacy</strong><span>Owner/authorized finance sees full payroll; employee sees own information only</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Capacity Intelligence</h2><span>What management should act on</span></div></header><div className="mo-callouts"><div className="warning"><strong>Commercial skill concentration</strong><p>Current commercial capability is concentrated in Van 4. Cross-training reduces dispatch risk.</p></div><div><strong>Support team behavior</strong><p>Van 3 is assisting a large work order without creating duplicate customer communication.</p></div></div></article>
      </section>
    </div>
  );
}
