export type PerformanceUnit = 'ms' | 'count';
export type PerformanceMeasurement = { name: string; module: string; value: number; unit: PerformanceUnit; error?: boolean; route?: string };
export type Observation = Omit<PerformanceMeasurement, 'route'> & { observedAtMs: number };
export type Policy = { success: boolean; enabled: boolean; configured: boolean; version: number; environment: string };
export type TelemetryBatch = { version: 2; environment: string; batchId: string; sessionId: string; release: string; module: string; visible: boolean; measurements: Observation[] };
export type PerformanceDashboardMetric = {
  name: string; module: string; release: string; unit: PerformanceUnit; count: number; sum: number; errors: number;
  histogram: Record<string, number>; lastObservedAtMs: number; average: number | null; errorRate: number | null;
  p50: number | null; p95: number | null; p99: number | null; percentileMethod: 'histogram-upper-bound'; lowSample: boolean;
};
export type HealthState = { status: 'healthy' | 'warning' | 'collecting' | 'stale' | 'unavailable'; label: string };
export type PerformanceDashboard = {
  success: true; version: number; environment: string; generatedAtMs: number; rangeMinutes: number;
  windowStartMs: number; windowEndMs: number; bucketSizeMs: number; bucketCount: number; truncated: boolean; sessionsTruncated: boolean;
  lastReceivedAtMs: number | null; lastObservedAtMs: number | null;
  policy: { enabled: boolean; configured: boolean; version: number };
  metrics: PerformanceDashboardMetric[]; releases: string[]; releaseMetrics: PerformanceDashboardMetric[];
  timeline: Array<PerformanceDashboardMetric & { atMs: number }>;
  trend: { name: string; module: string }; activeSessions: number; activeModules: Record<string,number>; activeRoles: Record<string,number>;
  health: HealthState; baseline: { observedDays: number; requiredDays: number; coverage: Array<{ name: string; count: number }>; ready: boolean };
  recovery: { backupVerified: boolean; restoreVerified: boolean; reason: string };
};
