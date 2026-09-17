'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getPerformanceDashboard,
  type PerformanceDashboard,
  type PerformanceDashboardMetric,
} from '@/lib/performance-telemetry';
import styles from './performance-health-center.module.css';

type Tab = 'overview' | 'live' | 'schedule' | 'infrastructure' | 'alerts' | 'recovery';
type RangeMinutes = 60 | 360 | 1440 | 10080 | 43200;

type CombinedMetric = {
  count: number;
  average: number;
  errors: number;
  errorRate: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  unit: PerformanceDashboardMetric['unit'];
};

const tabs: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'live', label: 'Live Monitoring' },
  { id: 'schedule', label: 'Schedule Diagnostics' },
  { id: 'infrastructure', label: 'Query & Infrastructure' },
  { id: 'alerts', label: 'Alerts & Incidents' },
  { id: 'recovery', label: 'Backup & Rollback' },
];

const ranges: Array<{ value: RangeMinutes; label: string }> = [
  { value: 60, label: 'Last hour' },
  { value: 360, label: 'Last 6 hours' },
  { value: 1440, label: 'Last 24 hours' },
  { value: 10080, label: 'Last 7 days' },
  { value: 43200, label: 'Last 30 days' },
];

function combine(metrics: PerformanceDashboardMetric[], name: string, module?: string): CombinedMetric | null {
  const matches = metrics.filter((metric) => metric.name === name && (!module || metric.module === module));
  if (!matches.length) return null;
  const count = matches.reduce((sum, metric) => sum + metric.count, 0);
  const errors = matches.reduce((sum, metric) => sum + metric.errors, 0);
  const sum = matches.reduce((total, metric) => total + metric.average * metric.count, 0);
  const p50 = Math.max(...matches.map((metric) => metric.p50 ?? 0));
  const p95 = Math.max(...matches.map((metric) => metric.p95 ?? 0));
  const p99 = Math.max(...matches.map((metric) => metric.p99 ?? 0));
  return {
    count,
    average: count ? sum / count : 0,
    errors,
    errorRate: count ? (errors / count) * 100 : 0,
    p50: p50 || null,
    p95: p95 || null,
    p99: p99 || null,
    unit: matches[0].unit,
  };
}

function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'Collecting…';
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 2)} s`;
  return `${Math.round(value)} ms`;
}

function formatCount(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value));
}

function titleCase(value: string) {
  return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function healthFrom(data: PerformanceDashboard | null) {
  if (!data || data.metrics.length === 0) return { label: 'Collecting baseline', tone: 'info' as const };
  const browserErrors = combine(data.metrics, 'browser_error');
  const scheduleErrors = combine(data.metrics, 'schedule_load_error', 'scheduling');
  const support = combine(data.metrics, 'support_slot_validation', 'scheduling');
  if ((browserErrors?.count ?? 0) > 0 || (scheduleErrors?.count ?? 0) > 0) return { label: 'Needs attention', tone: 'danger' as const };
  if ((support?.p95 ?? 0) > 1500) return { label: 'Degraded', tone: 'warning' as const };
  return { label: 'Healthy', tone: 'healthy' as const };
}

function statusClass(tone: 'healthy' | 'warning' | 'danger' | 'info') {
  return `${styles.statusDot} ${styles[tone]}`;
}

function MetricCard({ label, value, detail, tone = 'info' }: { label: string; value: string; detail?: string; tone?: 'healthy' | 'warning' | 'danger' | 'info' }) {
  return (
    <article className={styles.metricCard}>
      <div className={styles.metricLabel}><span className={statusClass(tone)} />{label}</div>
      <strong>{value}</strong>
      <span>{detail || 'Real production telemetry'}</span>
    </article>
  );
}

function TrendChart({ data }: { data: PerformanceDashboard | null }) {
  const points = useMemo(() => {
    const timeline = data?.timeline ?? [];
    if (!timeline.length) return '';
    const values = timeline.map((item) => item.averageLatencyMs ?? 0);
    const max = Math.max(1, ...values);
    return values.map((value, index) => {
      const x = timeline.length <= 1 ? 0 : (index / (timeline.length - 1)) * 100;
      const y = 90 - (value / max) * 72;
      return `${x},${y}`;
    }).join(' ');
  }, [data]);

  if (!points) return <div className={styles.emptyChart}>Collecting real response-time telemetry…</div>;
  return (
    <div className={styles.trendChart}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Average response time trend">
        <line x1="0" x2="100" y1="90" y2="90" className={styles.gridLine} />
        <line x1="0" x2="100" y1="55" y2="55" className={styles.gridLine} />
        <line x1="0" x2="100" y1="20" y2="20" className={styles.gridLine} />
        <polyline points={points} className={styles.chartLine} vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  );
}

function moduleRows(data: PerformanceDashboard | null) {
  if (!data) return [];
  const modules = [...new Set(data.metrics.map((metric) => metric.module))].sort();
  return modules.map((module) => {
    const latencyMetrics = data.metrics.filter((metric) => metric.module === module && metric.unit === 'ms');
    const p95 = latencyMetrics.length ? Math.max(...latencyMetrics.map((metric) => metric.p95 ?? 0)) : 0;
    const errors = data.metrics.filter((metric) => metric.module === module).reduce((sum, metric) => sum + metric.errors, 0);
    return { module, p95, errors, tone: errors > 0 ? 'warning' : p95 > 2500 ? 'warning' : 'healthy' } as const;
  });
}

function derivedAlerts(data: PerformanceDashboard | null) {
  if (!data) return [];
  const alerts: Array<{ severity: 'critical' | 'warning' | 'info'; title: string; detail: string }> = [];
  const scheduleError = combine(data.metrics, 'schedule_load_error', 'scheduling');
  const fallback = combine(data.metrics, 'schedule_work_order_fallback', 'scheduling');
  const support = combine(data.metrics, 'support_slot_validation', 'scheduling');
  const confirm = combine(data.metrics, 'confirm_appointment', 'scheduling');
  const browser = combine(data.metrics, 'browser_error');
  if ((scheduleError?.count ?? 0) > 0) alerts.push({ severity: 'critical', title: 'Scheduling load failures detected', detail: `${scheduleError?.count ?? 0} failed schedule load samples in this window.` });
  if ((fallback?.count ?? 0) > 0) alerts.push({ severity: 'warning', title: 'Schedule fallback query used', detail: `${fallback?.count ?? 0} range queries fell back to a broader Work Order read.` });
  if ((support?.p95 ?? 0) > 1000) alerts.push({ severity: 'warning', title: 'Support-slot validation is slow', detail: `p95 ${formatMs(support?.p95)}. Target after optimization: under 800 ms.` });
  if ((confirm?.p95 ?? 0) > 2000) alerts.push({ severity: 'warning', title: 'Appointment confirmation is slow', detail: `p95 ${formatMs(confirm?.p95)}.` });
  if ((browser?.count ?? 0) > 0) alerts.push({ severity: 'warning', title: 'Browser errors detected', detail: `${browser?.count ?? 0} browser error events recorded.` });
  if (data.latestBucketAt && Date.now() - Date.parse(data.latestBucketAt) > 20 * 60_000) alerts.push({ severity: 'info', title: 'Telemetry is stale', detail: 'No fresh telemetry bucket has arrived in the last 20 minutes.' });
  return alerts;
}

export default function PerformanceHealthCenterPage() {
  const [tab, setTab] = useState<Tab>('overview');
  const [rangeMinutes, setRangeMinutes] = useState<RangeMinutes>(1440);
  const [data, setData] = useState<PerformanceDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await getPerformanceDashboard(rangeMinutes);
      setData(next);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Performance telemetry could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [rangeMinutes]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => { void load(); }, 30_000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, load]);

  const health = healthFrom(data);
  const scheduleReady = combine(data?.metrics ?? [], 'schedule_data_ready', 'scheduling');
  const supportValidation = combine(data?.metrics ?? [], 'support_slot_validation', 'scheduling');
  const confirmAppointment = combine(data?.metrics ?? [], 'confirm_appointment', 'scheduling');
  const workOrders = combine(data?.metrics ?? [], 'schedule_work_orders', 'scheduling');
  const firestore = combine(data?.metrics ?? [], 'firestore_rest');
  const pageLoad = combine(data?.metrics ?? [], 'page_load');
  const browserErrors = combine(data?.metrics ?? [], 'browser_error');
  const fallback = combine(data?.metrics ?? [], 'schedule_work_order_fallback', 'scheduling');
  const moduleHealth = moduleRows(data);
  const alerts = derivedAlerts(data);
  const releases = [...new Set((data?.metrics ?? []).map((metric) => metric.release).filter((value) => value && value !== 'unknown'))];

  const header = (
    <>
      <div className={styles.breadcrumb}>Settings <span>›</span> System <span>›</span> Performance &amp; Health Center</div>
      <header className={styles.hero}>
        <div className={styles.heroIcon}>⌁</div>
        <div className={styles.heroCopy}>
          <h1>Performance &amp; Health Center</h1>
          <p>Live health, speed, reliability and recovery visibility from the real DEMAC ERP.</p>
        </div>
        <div className={styles.heroActions}>
          <label className={styles.selectControl}>Range
            <select value={rangeMinutes} onChange={(event) => setRangeMinutes(Number(event.target.value) as RangeMinutes)}>
              {ranges.map((range) => <option key={range.value} value={range.value}>{range.label}</option>)}
            </select>
          </label>
          <button className={styles.liveButton} type="button" onClick={() => setAutoRefresh((current) => !current)}><span />{autoRefresh ? 'Live · 30s' : 'Paused'}</button>
          <button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={loading}>{loading ? 'Refreshing…' : 'Refresh now'}</button>
        </div>
      </header>
      <nav className={styles.tabs} aria-label="Performance center sections">
        {tabs.map((item) => <button key={item.id} type="button" className={tab === item.id ? styles.activeTab : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
      </nav>
      {error ? <div className={styles.errorBanner}><strong>Telemetry unavailable</strong><span>{error}</span></div> : null}
      {data?.truncated ? <div className={styles.warningBanner}><strong>Large data window</strong><span>The dashboard reached its safe telemetry read limit. Use a shorter range for exact diagnostics.</span></div> : null}
    </>
  );

  return (
    <section className={styles.page}>
      {header}

      {tab === 'overview' ? <>
        <div className={styles.metricGrid}>
          <MetricCard label="System Health" value={health.label} tone={health.tone} detail={data?.latestBucketAt ? `Latest sample ${new Date(data.latestBucketAt).toLocaleTimeString()}` : 'Waiting for first production samples'} />
          <MetricCard label="Active Sessions" value={formatCount(data?.activeSessions ?? null)} tone="healthy" detail="Anonymous authenticated sessions · last 10 min" />
          <MetricCard label="Schedule Data Ready (p95)" value={formatMs(scheduleReady?.p95)} tone={(scheduleReady?.p95 ?? 0) > 2500 ? 'warning' : 'info'} detail={`p50 ${formatMs(scheduleReady?.p50)} · ${scheduleReady?.count ?? 0} samples`} />
          <MetricCard label="Support Validation (p95)" value={formatMs(supportValidation?.p95)} tone={(supportValidation?.p95 ?? 0) > 1000 ? 'warning' : 'info'} detail={`${supportValidation?.count ?? 0} validated support selections`} />
          <MetricCard label="Error Events" value={formatCount((browserErrors?.count ?? 0) + (scheduleReady?.errors ?? 0))} tone={(browserErrors?.count ?? 0) > 0 ? 'danger' : 'healthy'} detail="Browser and scheduling load errors" />
          <MetricCard label="Firestore REST (p95)" value={formatMs(firestore?.p95)} detail={`${firestore?.count ?? 0} measured requests`} />
        </div>
        <div className={styles.twoColumn}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>Platform response trend</h2><p>Real browser and API timing samples collected from authenticated ERP sessions.</p></div><span className={styles.livePill}>● Live</span></div>
            <TrendChart data={data} />
            <div className={styles.chartFooter}><span>Average measured response per telemetry bucket</span><strong>{data?.bucketCount ?? 0} buckets</strong></div>
          </article>
          <article className={styles.panel}>
            <div className={styles.panelHeader}><div><h2>Current system status</h2><p>Derived from real module telemetry.</p></div></div>
            <div className={styles.statusTable}>
              <div className={styles.tableHead}><span>Module</span><span>Status</span><span>p95</span><span>Errors</span></div>
              {moduleHealth.length ? moduleHealth.slice(0, 8).map((row) => <div className={styles.tableRow} key={row.module}><strong>{titleCase(row.module)}</strong><span><i className={statusClass(row.tone)} />{row.tone === 'healthy' ? 'Healthy' : 'Watch'}</span><span>{formatMs(row.p95 || null)}</span><span>{row.errors}</span></div>) : <div className={styles.emptyState}>No module telemetry yet.</div>}
            </div>
          </article>
        </div>
        <div className={styles.threeColumn}>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Top alerts</h2><p>Automatic, evidence-based warnings.</p></div></div>{alerts.length ? <div className={styles.alertList}>{alerts.slice(0, 4).map((alert, index) => <div className={styles.alertRow} key={`${alert.title}-${index}`}><span className={styles[alert.severity]}>{alert.severity}</span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></div>)}</div> : <div className={styles.goodEmpty}>No active performance alerts in this window.</div>}</article>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Critical workflows</h2><p>Baseline before optimization.</p></div></div><div className={styles.compactRows}><div><span>Schedule data ready</span><strong>{formatMs(scheduleReady?.p95)}</strong></div><div><span>Support slot validation</span><strong>{formatMs(supportValidation?.p95)}</strong></div><div><span>Confirm appointment</span><strong>{formatMs(confirmAppointment?.p95)}</strong></div><div><span>Work Order fetch</span><strong>{formatMs(workOrders?.p95)}</strong></div><div><span>Page load</span><strong>{formatMs(pageLoad?.p95)}</strong></div></div></article>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Version &amp; baseline</h2><p>Release-aware telemetry.</p></div></div><div className={styles.compactRows}><div><span>Observed releases</span><strong>{releases.length || '—'}</strong></div><div><span>Telemetry API</span><strong>v{data?.version ?? 1}</strong></div><div><span>Samples available</span><strong>{formatCount((data?.metrics ?? []).reduce((sum, metric) => sum + metric.count, 0))}</strong></div><div><span>Window</span><strong>{ranges.find((range) => range.value === rangeMinutes)?.label}</strong></div></div></article>
        </div>
      </> : null}

      {tab === 'live' ? <>
        <div className={styles.metricGrid}>
          <MetricCard label="Active Sessions" value={formatCount(data?.activeSessions ?? null)} tone="healthy" />
          <MetricCard label="Page Load (p95)" value={formatMs(pageLoad?.p95)} />
          <MetricCard label="Firestore (p95)" value={formatMs(firestore?.p95)} />
          <MetricCard label="Browser Errors" value={formatCount(browserErrors?.count ?? 0)} tone={(browserErrors?.count ?? 0) > 0 ? 'danger' : 'healthy'} />
          <MetricCard label="Schedule (p95)" value={formatMs(scheduleReady?.p95)} />
          <MetricCard label="Support Validation" value={formatMs(supportValidation?.p95)} />
        </div>
        <div className={styles.twoColumn}>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Real-time system response</h2><p>Auto-refreshes every 30 seconds while Live is enabled.</p></div></div><TrendChart data={data} /></article>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Active modules now</h2><p>No employee names are collected.</p></div></div><div className={styles.compactRows}>{Object.entries(data?.activeModules ?? {}).sort((a, b) => b[1] - a[1]).map(([module, count]) => <div key={module}><span>{titleCase(module)}</span><strong>{count} session{count === 1 ? '' : 's'}</strong></div>)}{!Object.keys(data?.activeModules ?? {}).length ? <div className={styles.emptyState}>No active heartbeat data yet.</div> : null}</div></article>
        </div>
      </> : null}

      {tab === 'schedule' ? <>
        <div className={styles.metricGrid}>
          <MetricCard label="Schedule Data Ready (p95)" value={formatMs(scheduleReady?.p95)} />
          <MetricCard label="Schedule Load Errors" value={formatCount(combine(data?.metrics ?? [], 'schedule_load_error', 'scheduling')?.count ?? 0)} tone={(combine(data?.metrics ?? [], 'schedule_load_error', 'scheduling')?.count ?? 0) > 0 ? 'danger' : 'healthy'} />
          <MetricCard label="Support Slot Validation" value={formatMs(supportValidation?.p95)} />
          <MetricCard label="Confirm Appointment" value={formatMs(confirmAppointment?.p95)} />
          <MetricCard label="Work Order Fetch" value={formatMs(workOrders?.p95)} />
          <MetricCard label="Fallback Queries" value={formatCount(fallback?.count ?? 0)} tone={(fallback?.count ?? 0) > 0 ? 'warning' : 'healthy'} />
        </div>
        <div className={styles.twoColumn}>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Schedule workflow — measured baseline</h2><p>Production timings captured before any performance optimization.</p></div></div><div className={styles.waterfall}><div><span>Reference data</span><i style={{ width: `${Math.min(100, ((combine(data?.metrics ?? [], 'schedule_reference_data', 'scheduling')?.p95 ?? 0) / 30))}%` }} /><strong>{formatMs(combine(data?.metrics ?? [], 'schedule_reference_data', 'scheduling')?.p95)}</strong></div><div><span>Work Order query</span><i style={{ width: `${Math.min(100, ((workOrders?.p95 ?? 0) / 30))}%` }} /><strong>{formatMs(workOrders?.p95)}</strong></div><div><span>Complete data ready</span><i style={{ width: `${Math.min(100, ((scheduleReady?.p95 ?? 0) / 30))}%` }} /><strong>{formatMs(scheduleReady?.p95)}</strong></div></div></article>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Booking &amp; support workflow</h2><p>Current end-to-end Booking Authority timing.</p></div></div><div className={styles.waterfall}><div><span>Support slot validation</span><i style={{ width: `${Math.min(100, ((supportValidation?.p95 ?? 0) / 30))}%` }} /><strong>{formatMs(supportValidation?.p95)}</strong></div><div><span>Confirm appointment</span><i style={{ width: `${Math.min(100, ((confirmAppointment?.p95 ?? 0) / 30))}%` }} /><strong>{formatMs(confirmAppointment?.p95)}</strong></div></div></article>
        </div>
        <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Known bottlenecks to watch</h2><p>These are observations only. This branch does not optimize or change scheduling behavior.</p></div></div><div className={styles.diagnosticTable}><div><strong>Area</strong><strong>Measured p95</strong><strong>Current signal</strong><strong>Next optimization target</strong></div><div><span>Schedule data query</span><span>{formatMs(scheduleReady?.p95)}</span><span>{(fallback?.count ?? 0) > 0 ? 'Fallback observed' : 'Measuring'}</span><span>Indexed, bounded reads</span></div><div><span>Support selection</span><span>{formatMs(supportValidation?.p95)}</span><span>{(supportValidation?.p95 ?? 0) > 1000 ? 'Slow' : 'Measuring'}</span><span>Optimistic UI + light validation</span></div><div><span>Confirm appointment</span><span>{formatMs(confirmAppointment?.p95)}</span><span>Transactional safety retained</span><span>Optimize pre-commit reads only</span></div></div></article>
      </> : null}

      {tab === 'infrastructure' ? <>
        <div className={styles.metricGrid}>
          <MetricCard label="Firestore Requests" value={formatCount(firestore?.count ?? 0)} />
          <MetricCard label="Firestore p95" value={formatMs(firestore?.p95)} />
          <MetricCard label="Page Load p95" value={formatMs(pageLoad?.p95)} />
          <MetricCard label="Long Tasks" value={formatCount(combine(data?.metrics ?? [], 'long_task')?.count ?? 0)} />
          <MetricCard label="Function Errors" value={formatCount((data?.metrics ?? []).filter((metric) => metric.name.includes('authority') || metric.name.includes('function')).reduce((sum, metric) => sum + metric.errors, 0))} />
          <MetricCard label="Telemetry Buckets" value={formatCount(data?.bucketCount ?? 0)} />
        </div>
        <div className={styles.twoColumn}>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Most expensive measured operations</h2><p>Sorted by p95 from the selected real-data window.</p></div></div><div className={styles.statusTable}><div className={styles.tableHead}><span>Module</span><span>Operation</span><span>p95</span><span>Samples</span></div>{(data?.metrics ?? []).filter((metric) => metric.unit === 'ms').sort((a, b) => (b.p95 ?? 0) - (a.p95 ?? 0)).slice(0, 10).map((metric) => <div className={styles.tableRow} key={`${metric.module}-${metric.name}-${metric.release}`}><strong>{titleCase(metric.module)}</strong><span>{titleCase(metric.name)}</span><span>{formatMs(metric.p95)}</span><span>{metric.count}</span></div>)}</div></article>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Infrastructure health</h2><p>Browser-observed network endpoints.</p></div></div><div className={styles.compactRows}><div><span>Firestore REST</span><strong>{formatMs(firestore?.p95)}</strong></div><div><span>Firebase Auth</span><strong>{formatMs(combine(data?.metrics ?? [], 'firebase_auth')?.p95)}</strong></div><div><span>Browser page load</span><strong>{formatMs(pageLoad?.p95)}</strong></div><div><span>Unhandled rejections</span><strong>{formatCount(combine(data?.metrics ?? [], 'unhandled_rejection')?.count ?? 0)}</strong></div></div></article>
        </div>
      </> : null}

      {tab === 'alerts' ? <>
        <div className={styles.alertMetrics}><MetricCard label="Open Alerts" value={String(alerts.length)} tone={alerts.some((item) => item.severity === 'critical') ? 'danger' : alerts.length ? 'warning' : 'healthy'} /><MetricCard label="Critical" value={String(alerts.filter((item) => item.severity === 'critical').length)} tone="danger" /><MetricCard label="Warnings" value={String(alerts.filter((item) => item.severity === 'warning').length)} tone="warning" /><MetricCard label="Info" value={String(alerts.filter((item) => item.severity === 'info').length)} /></div>
        <div className={styles.alertWorkspace}><article className={styles.panel}><div className={styles.panelHeader}><div><h2>Current alerts</h2><p>Derived automatically from live telemetry, not manually entered.</p></div></div>{alerts.length ? <div className={styles.alertList}>{alerts.map((alert, index) => <div className={styles.alertRow} key={`${alert.title}-${index}`}><span className={styles[alert.severity]}>{alert.severity}</span><div><strong>{alert.title}</strong><p>{alert.detail}</p></div></div>)}</div> : <div className={styles.goodEmpty}>No current alerts for this range.</div>}</article><article className={styles.panel}><div className={styles.panelHeader}><div><h2>Incident policy</h2><p>Initial rules for baseline collection.</p></div></div><div className={styles.compactRows}><div><span>Schedule load failure</span><strong>Critical</strong></div><div><span>Support validation p95 &gt; 1s</span><strong>Warning</strong></div><div><span>Confirm p95 &gt; 2s</span><strong>Warning</strong></div><div><span>Telemetry stale &gt; 20 min</span><strong>Info</strong></div></div></article></div>
      </> : null}

      {tab === 'recovery' ? <>
        <div className={styles.metricGrid}>
          <MetricCard label="Data Backup Status" value="Not yet verified" tone="warning" detail="No backup authority is connected to this dashboard yet." />
          <MetricCard label="Rollback Readiness" value={releases.length ? 'Code baseline visible' : 'Collecting release data'} tone="info" detail="Git rollback remains independent from data restore." />
          <MetricCard label="Observed Releases" value={String(releases.length)} detail={releases.slice(0, 2).join(', ') || 'Awaiting build SHA telemetry'} />
          <MetricCard label="Telemetry Storage" value="Aggregated" tone="healthy" detail="No customer names, addresses or appointment content stored." />
          <MetricCard label="Protected Operations" value="Read-only telemetry" tone="healthy" detail="Instrumentation does not mutate appointments or CRM records." />
          <MetricCard label="Restore Test" value="Required before optimization" tone="warning" detail="Backup restore validation remains a pre-deployment gate." />
        </div>
        <div className={styles.twoColumn}>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Rollback plan</h2><p>Safety sequence for the later performance optimization release.</p></div></div><ol className={styles.rollbackSteps}><li><span>1</span><div><strong>Disable new performance feature flags</strong><p>Return operators to the known-good read path without touching customer data.</p></div></li><li><span>2</span><div><strong>Revert web / function deployment</strong><p>Restore the last known-good application revision.</p></div></li><li><span>3</span><div><strong>Verify appointments and capacity</strong><p>Reconcile current Appointment → Work Order → Capacity Lock state.</p></div></li><li><span>4</span><div><strong>Restore affected records only if required</strong><p>Data restore is separate from code rollback and must target only proven corruption.</p></div></li></ol></article>
          <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Pre-optimization safety checklist</h2><p>Must be green before the optimization project is merged.</p></div></div><div className={styles.checklist}><div className={styles.pendingCheck}>○ Verified Firestore backup snapshot</div><div className={styles.pendingCheck}>○ Restore rehearsal in staging</div><div className={styles.readyCheck}>✓ Known-good Git revision retained</div><div className={styles.readyCheck}>✓ Performance baseline collection enabled</div><div className={styles.readyCheck}>✓ Booking Authority remains transactional</div></div></article>
        </div>
      </> : null}
    </section>
  );
}
