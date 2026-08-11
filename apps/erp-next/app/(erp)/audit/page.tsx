import { auditEvents } from '@/lib/system-governance';

export default function AuditPage() {
  return (
    <div className="sg-stack">
      <section className="page-head"><div><div className="eyebrow">Governance & Traceability</div><h1>Audit Log</h1><p>Significant business and security events remain attributable to an actor, timestamp, area, object and outcome instead of being silently overwritten.</p></div><div className="page-actions"><button className="btn" type="button">Export</button><button className="btn primary" type="button">Advanced Search</button></div></section>
      <section className="sg-audit-summary"><article><span>Events Today</span><strong>42</strong><small>Preview event stream</small></article><article><span>Security Controls</span><strong>8</strong><small>Protected actions</small></article><article><span>Failed Actions</span><strong>0</strong><small className="sg-good">No critical failures</small></article><article><span>Retention</span><strong>Governed</strong><small>Immutable-event design</small></article></section>
      <section className="panel sg-audit-panel">
        <header className="panel-head"><div><h2>Recent System Events</h2><span>Actor · action · object · result</span></div><span>Latest first</span></header>
        <div className="sg-audit-table">
          <div className="sg-audit-row sg-audit-head"><span>Time</span><span>Actor</span><span>Area</span><span>Action</span><span>Object</span><span>Result</span></div>
          {auditEvents.map((event) => <div className="sg-audit-row" key={`${event.time}-${event.action}`}><time>{event.time}</time><strong>{event.actor}</strong><span>{event.area}</span><span>{event.action}</span><span>{event.object}</span><b className={event.severity === 'Control' ? 'control' : ''}>{event.result}</b></div>)}
        </div>
      </section>
      <section className="sg-audit-principles"><article><strong>Who</strong><span>Authenticated actor or governed system process.</span></article><article><strong>What</strong><span>Business event, sensitive change or integration outcome.</span></article><article><strong>Before / After</strong><span>Critical record changes retain enough context for investigation.</span></article><article><strong>Why</strong><span>Approval reason / source transaction where required.</span></article></section>
    </div>
  );
}
