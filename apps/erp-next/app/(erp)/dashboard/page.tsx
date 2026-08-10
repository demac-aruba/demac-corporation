const kpis = [
  { label: 'Monthly Revenue Goal', value: 'Afl. 76,500', sub: 'of Afl. 100,000 target', delta: '+8% ahead of pace', tone: 'good', progress: 76 },
  { label: 'Expense Budget', value: 'Afl. 42,000', sub: 'of Afl. 50,000 budget', delta: '17% ahead of budget pace', tone: 'warn', progress: 84 },
  { label: 'Cash Collected', value: 'Afl. 58,240', sub: 'Afl. 12,600 detected today', delta: '+14.2% vs last month', tone: 'good', progress: 68 },
  { label: 'Jobs Completed', value: '128', sub: 'of 160 monthly operating target', delta: '80% complete', tone: 'good', progress: 80 },
];

const jobs = [
  ['08:30', 'Noord Residence · Standard Service', 'Van 1 · 2 ACs', 'Working', 'green'],
  ['09:30', 'Palm Beach · Diagnostic', 'Van 2 · Cassette', 'En Route', 'blue'],
  ['10:30', 'Oranjestad Office · Deep Cleaning', 'Van 3 · 3 ACs', 'Confirmed', 'blue'],
  ['13:30', 'Santa Cruz · Installation', 'Van 4 · 18K BTU', 'Ready', 'green'],
  ['14:30', 'ABC Hotel · Commercial Repair', 'Van 2 · Priority', 'At Risk', 'amber'],
];

const alerts = [
  ['critical', 'Customer balance remains', 'ABC Company paid Afl. 13,000 against Afl. 14,000 outstanding. Afl. 1,000 remains.', '4m'],
  ['', 'Expense budget at risk', '84% of the monthly budget is already consumed while the month is materially less advanced.', '12m'],
  ['opportunity', 'Sales pace ahead', 'Equipment sales are currently tracking above the monthly target. Maintain collection pace.', '28m'],
  ['', 'Van 2 stock risk', 'Disconnect switches are projected to fall below par stock within three working days.', '41m'],
];

export default function DashboardPage() {
  return (
    <>
      <section className="page-head">
        <div>
          <div className="eyebrow">Executive Operations</div>
          <h1>Command Center</h1>
          <p>One live view of DEMAC operations, financial pace, field execution and the exceptions that need management attention.</p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button">View Alerts</button>
          <button className="btn primary" type="button">+ New Action</button>
        </div>
      </section>

      <section className="kpi-grid">
        {kpis.map((kpi) => (
          <article className="kpi-card" key={kpi.label}>
            <div className="kpi-top">
              <span className="kpi-label">{kpi.label}</span>
              <span className={`kpi-delta ${kpi.tone}`}>{kpi.delta}</span>
            </div>
            <div className="kpi-value">{kpi.value}</div>
            <div className="kpi-sub">{kpi.sub}</div>
            <div className={`progress-track ${kpi.tone === 'warn' ? 'warning' : 'success'}`}><span style={{ width: `${kpi.progress}%` }} /></div>
          </article>
        ))}
      </section>

      <section className="dashboard-grid">
        <div>
          <article className="panel">
            <header className="panel-head"><div><h2>Live Field Operation</h2><span>Four operational vans · today</span></div><span>Updated now</span></header>
            <div className="panel-body">
              <div className="operation-strip">
                {[['Van 1', '4 / 6', 'Noord'], ['Van 2', '5 / 6', 'Palm Beach'], ['Van 3', '3 / 6', 'Oranjestad'], ['Van 4', '4 / 6', 'Santa Cruz']].map(([van, load, sector]) => (
                  <div className="van-card" key={van}>
                    <div className="van-title"><span>{van}</span><span className="status-dot">Active</span></div>
                    <strong>{load}</strong>
                    <p>jobs allocated · {sector}</p>
                  </div>
                ))}
              </div>
            </div>
          </article>

          <article className="panel" style={{ marginTop: 16 }}>
            <header className="panel-head"><div><h2>Today&apos;s Operational Timeline</h2><span>Jobs, readiness and dispatch status</span></div><span>Open agenda →</span></header>
            <div className="panel-body timeline-list">
              {jobs.map(([time, title, detail, status, tone]) => (
                <div className="timeline-row" key={`${time}-${title}`}>
                  <span className="timeline-time">{time}</span>
                  <div className="timeline-main"><strong>{title}</strong><span>{detail}</span></div>
                  <span className={`badge ${tone}`}>{status}</span>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className="panel">
          <header className="panel-head"><div><h2>Management Attention</h2><span>AI + deterministic exception engine</span></div><span>4 open</span></header>
          <div className="panel-body alert-list">
            {alerts.map(([tone, title, message, time]) => (
              <div className={`alert-card ${tone}`} key={title}>
                <span className="alert-accent" />
                <div className="alert-copy"><strong>{title}</strong><p>{message}</p></div>
                <time>{time}</time>
              </div>
            ))}
          </div>
        </article>
      </section>
    </>
  );
}
