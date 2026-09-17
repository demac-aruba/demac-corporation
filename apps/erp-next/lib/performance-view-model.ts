import type { HealthState, PerformanceDashboard, PerformanceDashboardMetric } from './performance-types';
export function displayHealth(data: PerformanceDashboard | null, error: string, now: number): HealthState {
  if (error) return {status:'unavailable',label:'Telemetry unavailable'};
  if (!data) return {status:'collecting',label:'Connecting to telemetry'};
  if (!data.policy.enabled) return {status:'collecting',label:'Collection paused'};
  if (now - data.generatedAtMs > 360000) return {status:'stale',label:'Dashboard data is stale'};
  if (!data.lastObservedAtMs) return {status:'collecting',label:'Collecting first samples'};
  if (now - data.lastObservedAtMs > 300000) return {status:'stale',label:'No recent observed activity'};
  if (data.truncated) return {status:'warning',label:'Incomplete measurement window'};
  return data.health;
}
export function metric(data: PerformanceDashboard | null, name: string, module = 'scheduling'): PerformanceDashboardMetric | null {
  // Backend pools compatible histograms. Never average or maximize percentiles here.
  return data?.metrics.find((item) => item.name === name && item.module === module) || null;
}
export function alertsFor(data: PerformanceDashboard | null, error: string, now: number) {
  const health = displayHealth(data,error,now);
  const alerts: Array<{ severity:'critical'|'warning'|'info';title:string;detail:string }> = [];
  if (!data || ['unavailable','stale','collecting'].includes(health.status)) return [{severity:'info' as const,title:health.label,detail:'Health is not certified without fresh, sufficient operational measurements.'}];
  for (const item of data.metrics) {
    if (item.module === 'performance') continue;
    if (['browser_error','unhandled_rejection','schedule_load_error','schedule_work_order_fallback','telemetry_dropped'].includes(item.name) && item.sum > 0) {
      alerts.push({severity:item.name === 'schedule_load_error' ? 'critical' : 'warning',title:item.name.replaceAll('_',' '),detail:`${Math.round(item.sum)} events recorded in the selected window. These are observations, not an automatic root-cause diagnosis.`});
    }
    const threshold = item.name === 'support_slot_validation' ? 1000 : item.name === 'confirm_appointment' ? 2000 : item.name === 'schedule_data_ready' ? 2500 : null;
    if (threshold && item.count >= 20 && item.p95 !== null && item.p95 > threshold) alerts.push({severity:'warning',title:`${item.name.replaceAll('_',' ')} exceeds initial target`,detail:`p95 upper bound ${item.p95} ms across ${item.count} observations. Thresholds are initial engineering targets.`});
  }
  return alerts;
}
export function latencyLabel(value: number | null | undefined) {
  if (value === null || value === undefined) return 'Not measured';
  return `≤ ${value >= 1000 ? `${(value/1000).toFixed(2)} s` : `${Math.round(value)} ms`}`;
}
