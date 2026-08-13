import { BrowserReportDelivery } from '../../../components/communications/browser-report-delivery';
import { reportCatalog } from '@/lib/management-operations';

export default function ReportsPage() {
  return (
    <div className="mo-stack">
      <section className="page-head">
        <div><div className="eyebrow">Reporting & Traceability</div><h1>Reports & Intelligence</h1><p>Role-specific reports that reconcile to source transactions, expose exceptions and support drill-down instead of disconnected spreadsheets.</p></div>
        <div className="page-actions"><button className="btn" type="button">Scheduled Reports</button><button className="btn primary" type="button">+ Build Report</button></div>
      </section>

      <BrowserReportDelivery />

      <section className="mo-metric-grid">
        <article><span>Standard Reports</span><strong>18</strong><small>Across all modules</small></article>
        <article><span>Scheduled Deliveries</span><strong>7</strong><small>Daily / weekly / monthly</small></article>
        <article><span>Open Exceptions</span><strong>11</strong><small className="mo-warn">Require source review</small></article>
        <article><span>Data Freshness</span><strong>Live</strong><small className="mo-good">Transactional views</small></article>
      </section>

      <section className="mo-report-grid">
        {reportCatalog.map((report) => (
          <article className="panel mo-report-card" key={report.name}>
            <div className="mo-report-icon">{report.group.slice(0,2).toUpperCase()}</div>
            <div><span>{report.group}</span><h2>{report.name}</h2><p>{report.description}</p></div>
            <div className="mo-report-meta"><div><span>Cadence</span><strong>{report.cadence}</strong></div><div><span>Owner</span><strong>{report.owner}</strong></div></div>
            <button type="button">Open report →</button>
          </article>
        ))}
      </section>

      <section className="mo-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Exception Reporting</h2><span>Problems surfaced automatically</span></div><span>11 open</span></header><div className="mo-exception-list"><div><b className="red">Finance</b><strong>6 payments awaiting allocation</strong><span>Bank transactions detected but not fully reconciled to invoices.</span></div><div><b className="amber">Inventory</b><strong>2 jobs at material risk</strong><span>Projected available stock is below reserved demand.</span></div><div><b className="amber">Projects</b><strong>1 forecast over budget</strong><span>Project forecast-at-completion exceeds approved working budget.</span></div><div><b className="blue">Operations</b><strong>2 callback / quality reviews</strong><span>Recent work orders require office follow-up before closure.</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Reporting Principles</h2><span>Foundation rules</span></div></header><div className="mo-rule-list"><div><strong>Traceable</strong><span>Every number can drill into its source records.</span></div><div><strong>Role-based</strong><span>Owner, operations, finance, warehouse and projects see the right level of detail.</span></div><div><strong>Exception-first</strong><span>The system surfaces problems; users should not hunt for them manually.</span></div><div><strong>Exportable</strong><span>PDF/Excel export will use the same governed calculations shown on screen.</span></div></div></article>
      </section>
    </div>
  );
}
