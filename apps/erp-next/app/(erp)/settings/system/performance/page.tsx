'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPerformanceDashboard, setPerformanceCollection, type PerformanceDashboard, type PerformanceDashboardMetric } from '@/lib/performance-telemetry';
import { alertsFor, displayHealth, latencyLabel, metric } from '@/lib/performance-view-model';
import styles from './performance-health-center.module.css';

type Tab = 'overview'|'live'|'schedule'|'infrastructure'|'alerts'|'recovery';
const tabs: Array<[Tab,string]> = [['overview','Overview'],['live','Live Monitoring'],['schedule','Schedule Diagnostics'],['infrastructure','Query & Infrastructure'],['alerts','Alerts & Incidents'],['recovery','Backup & Rollback']];
const ranges = [[60,'Last hour'],[360,'Last 6 hours'],[1440,'Last 24 hours'],[10080,'Last 7 days'],[43200,'Last 30 days']] as const;
const workflows = ['schedule_data_ready','support_slot_validation','confirm_appointment'];
const label = (text: string) => text.replaceAll('_',' ').replace(/\b\w/g,(letter) => letter.toUpperCase());
const when = (ms?: number|null) => ms ? new Date(ms).toLocaleString('en-US',{timeZone:'America/Aruba',dateStyle:'short',timeStyle:'short'}) : 'Not available';
const count = (value?: number|null) => value === undefined || value === null ? 'Not measured' : value.toLocaleString('en-US');
function Card({title,value,detail,tone='info'}:{title:string;value:string;detail?:string;tone?:'info'|'healthy'|'warning'|'danger'}) {
  return <article className={styles.metricCard}><div className={styles.metricLabel}><i className={`${styles.statusDot} ${styles[tone]}`} />{title}</div><strong>{value}</strong><span>{detail || 'Observed data only'}</span></article>;
}
function LatencyCard({title,item}:{title:string;item:PerformanceDashboardMetric|null}) {
  return <Card title={title} value={latencyLabel(item?.p95)} detail={item ? `${item.count} samples · ${item.count < 20 ? 'low sample confidence' : 'histogram upper bound'}` : 'Waiting for this workflow to be measured'} />;
}
function Chart({data}:{data:PerformanceDashboard|null}) {
  const entries = data?.timeline || [];
  if (!entries.length) return <div className={styles.emptyChart}>No measurements for the selected workflow and release.</div>;
  const max = Math.max(50,...entries.map((entry) => entry.p95 || 0));
  const start = data?.windowStartMs || entries[0].atMs;
  const end = data?.windowEndMs || entries[entries.length-1].atMs;
  const point = (entry:typeof entries[number]) => `${8+((entry.atMs-start)/Math.max(1,end-start))*88},${88-(entry.p95 || 0)/max*70}`;
  return <><div className={styles.trendChart}><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Workflow p95 upper bounds over the selected time window"><line x1="8" x2="96" y1="88" y2="88" className={styles.gridLine}/><line x1="8" x2="96" y1="53" y2="53" className={styles.gridLine}/><line x1="8" x2="96" y1="18" y2="18" className={styles.gridLine}/>{entries.map((entry,index) => {
    const previous = entries[index-1];
    return <g key={entry.atMs}>{previous && entry.atMs-previous.atMs <= (data?.bucketSizeMs || 900000)*1.1 ? <polyline points={`${point(previous)} ${point(entry)}`} className={styles.chartLine} vectorEffect="non-scaling-stroke"/> : null}<circle cx={Number(point(entry).split(',')[0])} cy={Number(point(entry).split(',')[1])} r=".6" fill="currentColor"><title>{when(entry.atMs)} · {latencyLabel(entry.p95)} · {entry.count} samples</title></circle></g>;
  })}</svg></div><div className={styles.chartFooter}><span>{when(start)}</span><span>Scale: 0–{max} ms · gaps = no samples</span><span>{when(end)}</span></div></>;
}
function MetricTable({items}:{items:PerformanceDashboardMetric[]}) {
  return <div className={styles.statusTable}><table className={styles.nativeTable}><thead><tr><th>Module / workflow</th><th>p50 ≤</th><th>p95 ≤</th><th>p99 ≤</th><th>Samples</th><th>Failures</th></tr></thead><tbody>{items.map((item) => <tr key={`${item.module}-${item.name}-${item.release}`}><td><strong>{label(item.module)}</strong><br/>{label(item.name)}</td><td>{latencyLabel(item.p50)}</td><td>{latencyLabel(item.p95)}</td><td>{latencyLabel(item.p99)}{item.count < 100 ? ' *' : ''}</td><td>{item.count}{item.lowSample ? ' *' : ''}</td><td>{item.errors} / {item.count}</td></tr>)}</tbody></table>{!items.length ? <div className={styles.emptyState}>No measured workflows. Unknown is not the same as healthy.</div> : null}<p className={styles.note}>* Small sample. Percentiles are upper-bound estimates from fixed latency buckets. Never pooled across different workflows.</p></div>;
}
export default function PerformanceHealthCenterPage() {
  const [tab,setTab] = useState<Tab>('overview');
  const [range,setRange] = useState(60); const [release,setRelease] = useState('all');
  const [trend,setTrend] = useState('schedule_data_ready');
  const [data,setData] = useState<PerformanceDashboard|null>(null);
  const [error,setError] = useState(''); const [busy,setBusy] = useState(false); const [auto,setAuto] = useState(true);
  const [clock,setClock] = useState(Date.now); const [controlBusy,setControlBusy] = useState(false);
  const [before,setBefore] = useState(''); const [after,setAfter] = useState('');
  const sequence = useRef(0); const request = useRef<AbortController|null>(null);
  const refreshMs = range <= 360 ? 60000 : range <= 1440 ? 300000 : 900000;
  const load = useCallback(async () => {
    const current = ++sequence.current;
    request.current?.abort(); const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const result = await getPerformanceDashboard(range,release,trend,controller.signal);
      if (sequence.current !== current || controller.signal.aborted) return;
      setData(result); setError(''); setClock(Date.now());
    } catch (cause) {
      if (sequence.current === current && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Telemetry is unavailable.');
    } finally { if (sequence.current === current) { setBusy(false); request.current = null; } }
  }, [range,release,trend]);
  useEffect(() => { setData(null); void load(); return () => { sequence.current += 1; request.current?.abort(); }; }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()),30000);
    const refresh = window.setInterval(() => { if (auto && document.visibilityState === 'visible' && !request.current) void load(); },refreshMs);
    return () => { window.clearInterval(timer); window.clearInterval(refresh); };
  }, [auto,load,refreshMs]);
  const health = displayHealth(data,error,clock);
  const tone = health.status === 'healthy' ? 'healthy' : health.status === 'warning' ? 'warning' : health.status === 'unavailable' ? 'danger' : 'info';
  const alerts = alertsFor(data,error,clock);
  const measured = (data?.metrics || []).filter((item) => item.unit === 'ms' && item.module !== 'performance');
  const onToggle = async () => {
    if (!data) return;
    const next = !data.policy.enabled;
    if (!window.confirm(next ? 'Resume performance measurement only? No business records will be modified.' : 'Pause all performance collection? ERP appointments and authentication remain unchanged.')) return;
    setControlBusy(true);
    try { await setPerformanceCollection(next,data.policy.version); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'The collection setting could not be verified.'); }
    finally { setControlBusy(false); }
  };
  const exportData = () => {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const anchor = document.createElement('a'); anchor.href=url; anchor.download=`demac-performance-${new Date(data.generatedAtMs).toISOString().slice(0,10)}.json`; anchor.click(); URL.revokeObjectURL(url);
  };
  return <section className={styles.page}>
    <div className={styles.breadcrumb}>Settings <span>›</span> System <span>›</span> Performance &amp; Health Center</div>
    <header className={styles.hero}><div className={styles.heroIcon}>⌁</div><div className={styles.heroCopy}><h1>Performance &amp; Health Center</h1><p>Observe the real ERP. Establish a baseline before changing operational workflows.</p></div><div className={styles.heroActions}><label className={styles.selectControl}>Window<select aria-label="Measurement window" value={range} onChange={(event) => setRange(Number(event.target.value))}>{ranges.map(([value,title]) => <option key={value} value={value}>{title}</option>)}</select></label><button className={styles.secondaryButton} type="button" onClick={() => setAuto(!auto)}>{auto ? `Auto · ${refreshMs/60000} min` : 'Auto paused'}</button><button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={busy}>{busy ? 'Refreshing…' : 'Refresh'}</button><button className={styles.secondaryButton} type="button" disabled={!data} onClick={exportData}>Export</button></div></header>
    <nav className={styles.tabs} aria-label="Performance sections">{tabs.map(([key,title]) => <button key={key} type="button" aria-current={tab === key ? 'page' : undefined} className={tab === key ? styles.activeTab : ''} onClick={() => setTab(key)}>{title}</button>)}</nav>
    <div className={styles.filterBar}><label>Release <select aria-label="Release filter" value={release} onChange={(event) => setRelease(event.target.value)}><option value="all">All observed releases</option>{(data?.releases || (release === 'all' ? [] : [release])).map((id) => <option key={id} value={id}>{id.slice(0,8)}</option>)}</select></label><span>Health: <strong data-testid="health-status">{health.label}</strong></span><span>Last observed: {when(data?.lastObservedAtMs)} · Aruba</span></div>
    {error ? <div className={styles.errorBanner} role="status"><strong>Monitoring unavailable.</strong><span>{error} Any displayed values are last known, not current health.</span></div> : null}
    {data?.truncated ? <div className={styles.warningBanner}>Read budget reached. This window is incomplete; narrow the range before comparing results.</div> : null}
    {tab === 'overview' || tab === 'live' ? <>
      <div className={styles.metricGrid}><Card title="System Health" value={health.label} tone={tone} detail="Only workflows with sufficient, recent evidence"/><Card title="Active Sessions" value={data ? count(data.activeSessions) : 'Unknown'} detail={`Visible sessions observed in last 5 min${data?.sessionsTruncated ? ' · count limited' : ''}`}/><LatencyCard title="Schedule Data Ready · p95" item={metric(data,'schedule_data_ready')}/><LatencyCard title="Support Validation · p95" item={metric(data,'support_slot_validation')}/><LatencyCard title="Confirm Appointment · p95" item={metric(data,'confirm_appointment')}/><Card title="Baseline Coverage" value={data ? `${data.baseline.observedDays} / 5 days` : 'Collecting'} detail={data?.baseline.ready ? 'Minimum sample gate met · review representativeness' : 'Needs ≥20 observations per critical workflow'}/></div>
      <div className={styles.twoColumn}><article className={styles.panel}><div className={styles.panelHeader}><div><h2>Workflow response trend</h2><p>One operation at a time; no artificial platform-wide latency average.</p></div><select aria-label="Trend workflow" value={trend} onChange={(event) => setTrend(event.target.value)}>{workflows.map((name) => <option key={name} value={name}>{label(name)}</option>)}</select></div><Chart data={data}/></article><article className={styles.panel}><div className={styles.panelHeader}><div><h2>Active modules</h2><p>Presence estimates, not employee productivity tracking.</p></div></div><div className={styles.compactRows}>{Object.entries(data?.activeModules || {}).map(([name,n]) => <div key={name}><span>{label(name)}</span><strong>{n} sessions</strong></div>)}{!data || !Object.keys(data.activeModules).length ? <p>No recent session evidence.</p> : null}</div><p className={styles.note}>Collection pauses in hidden tabs. Multiple tabs may represent the same user.</p></article></div>
      <div className={styles.twoColumn}><article className={styles.panel}><h2>Measured workflow health</h2><MetricTable items={measured.slice(0,8)}/></article><article className={styles.panel}><h2>Warnings in this window</h2>{alerts.map((item) => <div className={styles.alertRow} key={item.title}><span className={styles[item.severity]}>{item.severity}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></div>)}{!alerts.length ? <p>No threshold breach observed in the measured workflows.</p> : null}</article></div>
    </> : null}
    {tab === 'schedule' ? <><div className={styles.metricGrid}>{[...workflows,'schedule_work_orders','schedule_reference_data'].map((name) => <LatencyCard key={name} title={label(name)} item={metric(data,name)}/>)}<Card title="Fallback Events" value={count(metric(data,'schedule_work_order_fallback')?.sum)} detail="No event is not proof that a fallback cannot occur."/></div><div className={styles.twoColumn}><article className={styles.panel}><h2>Scheduling baseline</h2><MetricTable items={measured.filter((item) => item.module === 'scheduling')}/></article><article className={styles.panel}><h2>Measurement boundaries</h2><div className={styles.compactRows}><div><span>Schedule Data Ready</span><strong>Data fetch + projection, not paint</strong></div><div><span>Support / Confirm</span><strong>Request start → response headers</strong></div><div><span>Click-to-paint</span><strong>Not instrumented specifically</strong></div><div><span>False empty schedule</span><strong>Not verified by this collector</strong></div></div><p className={styles.note}>Parallel stages are not added as a waterfall. No booking, capacity or notification rules are changed by these measurements.</p></article></div></> : null}
    {tab === 'infrastructure' ? <><div className={styles.metricGrid}><Card title="Observed HTTP Requests" value={count(measured.filter((item) => ['firestore_rest','office_booking','inventory_api','field_api','tasks_api','api_other'].includes(item.name)).reduce((sum,item) => sum+item.count,0) || null)} detail="Browser observations, not Firestore billed reads"/><Card title="Telemetry Buckets Read" value={data ? count(data.bucketCount) : 'Unknown'} detail="Read window is bounded; hourly/daily rollups for longer periods"/><Card title="Function Server CPU" value="Not connected"/><Card title="Billed Database Reads" value="Not connected"/><Card title="Backup Provider" value="Not verified"/><Card title="Measured Releases" value={data ? count(data.releases.length) : 'Unknown'}/></div><article className={styles.panel}><h2>Observed network operations</h2><MetricTable items={measured.filter((item) => !item.name.startsWith('schedule_'))}/><p className={styles.note}>HTTP timings include network and server response time; they do not isolate database execution or prove server uptime.</p></article></> : null}
    {tab === 'alerts' ? <div className={styles.twoColumn}><article className={styles.panel}><h2>Evidence-based warnings</h2>{alerts.map((item) => <div className={styles.alertRow} key={item.title}><span className={styles[item.severity]}>{item.severity}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></div>)}{!alerts.length ? <p>No threshold breach in this measured window.</p> : null}</article><article className={styles.panel}><h2>Evaluation policy</h2><p>No health certification on stale, missing or failed telemetry.</p><div className={styles.compactRows}><div><span>Minimum latency sample</span><strong>20 observations</strong></div><div><span>p99 caution</span><strong>Under 100 observations</strong></div><div><span>Fresh operational evidence</span><strong>Within 5 minutes</strong></div><div><span>Alerts</span><strong>Read-only window analysis</strong></div></div><p className={styles.note}>This release does not automatically change production, send external notifications, or claim an incident root cause.</p></article></div> : null}
    {tab === 'recovery' ? <><div className={styles.metricGrid}><Card title="Business Data Backup" value="Not verified" tone="warning"/><Card title="Restore Rehearsal" value="Not verified" tone="warning"/><Card title="Collection Switch" value={data ? data.policy.enabled ? 'Enabled' : 'Paused' : 'Unknown'}/><Card title="Data Storage" value="Isolated telemetry"/><Card title="Operational Migrations" value="None in this module"/><Card title="Automatic Data Restore" value="Not implemented"/></div><div className={styles.twoColumn}><article className={styles.panel}><h2>Pause measurement safely</h2><p>This switch stops telemetry ingestion, not Scheduling, CRM, authentication, or any other business workflow. In-flight batches must pass the same server-side switch inside their transaction.</p><button type="button" className={styles.secondaryButton} disabled={!data || controlBusy} onClick={() => void onToggle()}>{controlBusy ? 'Verifying change…' : data?.policy.enabled ? 'Pause collection' : 'Resume collection'}</button><p className={styles.note}>Clients stop collecting on their next policy check, within 60 seconds. Server rejection applies immediately after the control change commits. Changes are versioned and audited.</p></article><article className={styles.panel}><h2>Recovery boundaries</h2><ol className={styles.rollbackSteps}><li><span>1</span><div><strong>Disable telemetry</strong><p>Use the collection switch, or the deployment-level emergency switch in the runbook.</p></div></li><li><span>2</span><div><strong>Restore the reviewed web revision if necessary</strong><p>Do not replace business records as part of a code rollback.</p></div></li><li><span>3</span><div><strong>Verify business data separately</strong><p>A real backup and isolated restoration rehearsal remain required before the later optimization project.</p></div></li></ol></article></div></> : null}
    <article className={styles.panel}><div className={styles.panelHeader}><div><h2>Release comparison</h2><p>Same workflow, same observation window. Values are histogram bounds, not exact percent improvements.</p></div><div className={styles.heroActions}><label>Baseline <select aria-label="Baseline release" value={before} onChange={(event) => setBefore(event.target.value)}><option value="">Choose release</option>{data?.releases.map((id) => <option key={id} value={id}>{id.slice(0,8)}</option>)}</select></label><label>Compare <select aria-label="Comparison release" value={after} onChange={(event) => setAfter(event.target.value)}><option value="">Choose release</option>{data?.releases.map((id) => <option key={id} value={id}>{id.slice(0,8)}</option>)}</select></label></div></div>{before && after && before !== after ? <div className={styles.statusTable}><table className={styles.nativeTable}><thead><tr><th>Workflow</th><th>Baseline p95</th><th>Compare p95</th><th>Evidence</th></tr></thead><tbody>{workflows.map((name) => { const left=data?.releaseMetrics.find((m) => m.release===before && m.name===name && m.module==='scheduling'); const right=data?.releaseMetrics.find((m) => m.release===after && m.name===name && m.module==='scheduling'); return <tr key={name}><td>{label(name)}</td><td>{latencyLabel(left?.p95)}</td><td>{latencyLabel(right?.p95)}</td><td>{left && right && left.count>=20 && right.count>=20 ? `${left.count} vs ${right.count} samples` : 'Insufficient comparable samples'}</td></tr>; })}</tbody></table></div> : <div className={styles.emptyState}>Select two different measured releases. The baseline will populate only after approved activation and real use.</div>}</article>
    <p className={styles.note}>Window starts {when(data?.windowStartMs)}; grouped into {data ? data.bucketSizeMs/60000 : '—'}-minute intervals. No raw client names, appointment content, query strings or credentials are stored in metrics. Version 2 measurements only.</p>
  </section>;
}
