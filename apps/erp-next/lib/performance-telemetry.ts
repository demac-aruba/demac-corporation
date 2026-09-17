'use client';

import { firebaseClientConfig } from './firebase/client-config';
import { requireFirebaseWebSession } from './firebase/session';

export type PerformanceUnit = 'ms' | 'count' | 'ratio' | 'bytes';
export type PerformanceMeasurement = {
  name: string;
  module: string;
  value: number;
  unit: PerformanceUnit;
  error?: boolean;
  route?: string;
};

export type PerformanceDashboardMetric = {
  module: string;
  name: string;
  release: string;
  unit: PerformanceUnit;
  count: number;
  average: number;
  errors: number;
  errorRate: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
};

export type PerformanceDashboard = {
  success: true;
  version: number;
  generatedAt: string;
  rangeMinutes: number;
  bucketCount: number;
  truncated: boolean;
  latestBucketAt: string | null;
  metrics: PerformanceDashboardMetric[];
  timeline: Array<{ bucketStartMs: number; samples: number; errors: number; averageLatencyMs: number }>;
  activeSessions: number;
  activeModules: Record<string, number>;
  activeRoles: Record<string, number>;
};

type ApiError = { error?: { code?: string; message?: string } };

const TELEMETRY_SESSION_KEY = 'demac.performance.session.v1';
const MAX_QUEUE = 80;
const queue: PerformanceMeasurement[] = [];
let flushPromise: Promise<void> | null = null;

function endpoint() {
  if (!firebaseClientConfig.projectId) throw new Error('Firebase project is not configured for performance telemetry.');
  return `https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/performanceTelemetry`;
}

function safeRoute(value?: string) {
  if (value) return value.slice(0, 180);
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`.slice(0, 180);
}

export function moduleFromPath(pathname: string) {
  const segment = pathname.split('?')[0].split('/').filter(Boolean)[0] || 'dashboard';
  if (segment === 'settings') return pathname.includes('/performance') ? 'performance' : 'settings';
  return segment.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
}

function releaseTag() {
  return (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
    || process.env.NEXT_PUBLIC_GIT_SHA
    || process.env.NEXT_PUBLIC_APP_VERSION
    || 'unknown').slice(0, 40);
}

export function performanceSessionId() {
  if (typeof window === 'undefined') return 'server';
  const existing = window.sessionStorage.getItem(TELEMETRY_SESSION_KEY);
  if (existing) return existing;
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const value = `erp-${random}`.slice(0, 96);
  window.sessionStorage.setItem(TELEMETRY_SESSION_KEY, value);
  return value;
}

export function recordPerformanceMeasurement(input: PerformanceMeasurement) {
  if (typeof window === 'undefined') return;
  if (!Number.isFinite(input.value) || input.value < 0) return;
  queue.push({
    ...input,
    name: input.name.slice(0, 80),
    module: input.module.slice(0, 48),
    route: safeRoute(input.route),
  });
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  if (queue.length >= 36) void flushPerformanceTelemetry();
}

export function recordDuration(name: string, module: string, startedAt: number, options: { error?: boolean; route?: string } = {}) {
  recordPerformanceMeasurement({
    name,
    module,
    value: Math.max(0, performance.now() - startedAt),
    unit: 'ms',
    error: options.error,
    route: options.route,
  });
}

export async function measurePerformance<T>(name: string, module: string, task: () => Promise<T>, route?: string): Promise<T> {
  const startedAt = performance.now();
  try {
    const value = await task();
    recordDuration(name, module, startedAt, { route });
    return value;
  } catch (error) {
    recordDuration(name, module, startedAt, { error: true, route });
    throw error;
  }
}

async function callPerformanceTelemetry<T>(action: 'ingest' | 'dashboard', data: Record<string, unknown>, timeoutMs = 10_000): Promise<T> {
  const session = await requireFirebaseWebSession();
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, data }),
      signal: controller.signal,
      keepalive: action === 'ingest',
    });
    const payload = await response.json().catch(() => ({})) as T & ApiError;
    if (!response.ok) throw new Error(payload.error?.message || 'Performance telemetry request failed.');
    return payload;
  } finally {
    window.clearTimeout(timer);
  }
}

export async function flushPerformanceTelemetry() {
  if (typeof window === 'undefined' || queue.length === 0) return;
  if (flushPromise) return flushPromise;
  const measurements = queue.splice(0, MAX_QUEUE);
  const route = safeRoute();
  const module = moduleFromPath(window.location.pathname);
  flushPromise = callPerformanceTelemetry('ingest', {
    sessionId: performanceSessionId(),
    route,
    module,
    release: releaseTag(),
    measurements,
  }, 8_000)
    .then(() => undefined)
    .catch(() => {
      const room = Math.max(0, MAX_QUEUE - queue.length);
      if (room > 0) queue.unshift(...measurements.slice(-room));
    })
    .finally(() => { flushPromise = null; });
  return flushPromise;
}

export function getPerformanceDashboard(rangeMinutes = 1_440) {
  return callPerformanceTelemetry<PerformanceDashboard>('dashboard', { rangeMinutes }, 15_000);
}
