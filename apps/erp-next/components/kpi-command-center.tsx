'use client';

import { useMemo, useState } from 'react';
import { kpiMetrics, managementAlerts, monthProgress, type KpiMetric } from '@/lib/management-intelligence';

const categories = ['Company', 'Finance', 'Operations', 'Sales & CRM', 'Inventory', 'Communications'] as const;

function MetricCard({ metric }: { metric: KpiMetric }) {
  const paceGap = metric.progress - metric.pace;
  const paceWidth = Math.max(0, Math.min(100, metric.pace));
  const progressWidth = Math.max(0, Math.min(100, metric.progress));

  return (
    <article className="mi-kpi-card">
      <div className="mi-card-top">
        <div>
          <span className="mi-kpi-category">{metric.category}</span>
          <h3>{metric.label}</h3>
        </div>
        <span className={`mi-tone mi-tone-${metric.tone}`}>{metric.tone === 'good' ? 'Healthy' : metric.tone === 'danger' ? 'Critical' : metric.tone === 'warning' ? 'Watch' : 'Stable'}</span>
      </div>
      <div className="mi-kpi-value">{metric.value}</div>
      <div className="mi-kpi-target">{metric.target}</div>
      <div className="mi-dual-track" aria-label={`${metric.progress}% achieved, ${metric.pace}% elapsed pace`}>
        <span className="mi-pace-marker" style={{ left: `${paceWidth}%` }} />
        <span className={`mi-progress-fill mi-fill-${metric.tone}`} style={{ width: `${progressWidth}%` }} />
      </div>
      <div className="mi-kpi-foot">
        <span className={paceGap >= 0 && metric.tone !== 'danger' ? 'mi-positive' : metric.tone === 'danger' ? 'mi-negative' : ''}>{metric.paceLabel}</span>
        <span>{metric.forecast}</span>
      </div>
      <div className="mi-source-row"><span>{metric.source}</span><time>{metric.freshness}</time></div>
    </article>
  );
}

export function KpiCommandCenter() {
  const [category, setCategory] = useState<(typeof categories)[number]>('Company');
  const [showAll, setShowAll] = useState(true);
  const visibleMetrics = useMemo(() => showAll ? kpiMetrics : kpiMetrics.filter((metric) => metric.category === category), [category, showAll]);

  return (
    <div className="mi-stack">
      <section className="page-head mi-head">
        <div>
          <div className="eyebrow">Management Intelligence</div>
          <h1>KPI Command Center</h1>
          <p>Targets are compared against elapsed time, not just historical totals. Every metric exposes forecast, source and freshness so management can distinguish real operating truth from stale reporting.</p>
        </div>
        <div className="mi-month-chip"><strong>{monthProgress}%</strong><span>month elapsed</span></div>
      </section>

      <section className="mi-filterbar" aria-label="KPI categories">
        <button className={showAll ? 'active' : ''} type="button" onClick={() => setShowAll(true)}>All KPIs</button>
        {categories.map((item) => <button className={!showAll && category === item ? 'active' : ''} type="button" onClick={() => { setShowAll(false); setCategory(item); }} key={item}>{item}</button>)}
      </section>

      <section className="mi-kpi-grid">
        {visibleMetrics.map((metric) => <MetricCard metric={metric} key={metric.id} />)}
      </section>

      <section className="mi-two-col">
        <article className="panel mi-forecast-panel">
          <header className="panel-head"><div><h2>Forward View</h2><span>Projected month-end position from current run-rate</span></div><span>Base case</span></header>
          <div className="mi-forecast-grid">
            <div><span>Sales</span><strong>Afl. 126K</strong><small className="mi-positive">~10% above target</small></div>
            <div><span>Collections</span><strong>Afl. 104K</strong><small className="mi-positive">Strong cash conversion</small></div>
            <div><span>Expenses</span><strong>Afl. 61K</strong><small className="mi-negative">~22% over budget</small></div>
            <div><span>Gross Margin</span><strong>42.1%</strong><small className="mi-positive">Above 40% minimum</small></div>
          </div>
          <div className="mi-forecast-note"><strong>Management interpretation</strong><p>Revenue is ahead, but the expense run-rate is consuming the benefit. The best intervention is cost discipline rather than chasing additional low-margin volume.</p></div>
        </article>

        <article className="panel">
          <header className="panel-head"><div><h2>Attention Queue</h2><span>Prioritized exceptions with an owner and next action</span></div><span>{managementAlerts.length} open</span></header>
          <div className="mi-alert-list">
            {managementAlerts.map((alert) => (
              <div className="mi-alert-row" key={alert.id}>
                <span className={`mi-alert-severity severity-${alert.severity.toLowerCase()}`}>{alert.severity}</span>
                <div className="mi-alert-copy"><strong>{alert.title}</strong><p>{alert.detail}</p><div><span>{alert.owner}</span><span>Next: {alert.nextAction}</span></div></div>
                <time>{alert.due}</time>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
