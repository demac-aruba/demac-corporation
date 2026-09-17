const crypto = require("node:crypto");
const { getAuth } = require("firebase-admin/auth");
const { FieldValue, Timestamp, getFirestore } = require("firebase-admin/firestore");
const { onRequest } = require("firebase-functions/v2/https");

const API_VERSION = 1;
const BUCKET_MS = 15 * 60 * 1000;
const SHARD_COUNT = 4;
const MAX_MEASUREMENTS = 80;
const MAX_DASHBOARD_BUCKETS = 12_000;
const TELEMETRY_RETENTION_MS = 45 * 24 * 60 * 60 * 1000;
const SESSION_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const HISTOGRAM_BOUNDS_MS = Object.freeze([50, 100, 200, 400, 800, 1_500, 2_500, 5_000, 10_000, 30_000]);
const DASHBOARD_ROLES = new Set(["super_admin", "superadmin", "super-admin", "owner", "admin", "auditor"]);

function cleanText(value, limit = 120) {
  return String(value ?? "").trim().slice(0, limit);
}

function safeToken(value, fallback = "unknown", limit = 64) {
  const normalized = cleanText(value, limit).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function safeRoute(value) {
  const raw = cleanText(value, 180) || "/";
  return (raw.split("?")[0].split("#")[0] || "/").slice(0, 180);
}

function safeNumber(value, min = 0, max = 120_000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(max, Math.max(min, number));
}

function normalizedRole(value) {
  return safeToken(value, "unknown", 80).replaceAll("-", "_");
}

function bearerToken(request) {
  const header = String(request?.headers?.authorization || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  return cleanText(match?.[1], 4_000);
}

function sessionShard(sessionId) {
  const digest = crypto.createHash("sha256").update(String(sessionId || "unknown")).digest();
  return digest[0] % SHARD_COUNT;
}

function bucketStartMs(nowMs = Date.now()) {
  return Math.floor(nowMs / BUCKET_MS) * BUCKET_MS;
}

function histogramBucket(valueMs) {
  const value = safeNumber(valueMs, 0, 120_000) ?? 0;
  const index = HISTOGRAM_BOUNDS_MS.findIndex((bound) => value <= bound);
  return index >= 0 ? `le_${HISTOGRAM_BOUNDS_MS[index]}` : "gt_30000";
}

function histogramUpperBound(key) {
  if (key === "gt_30000") return 60_000;
  const value = Number(String(key).replace("le_", ""));
  return Number.isFinite(value) ? value : 0;
}

function percentileFromHistogram(histogram = {}, count = 0, percentile = 0.95) {
  const total = Number(count) || Object.values(histogram).reduce((sum, value) => sum + (Number(value) || 0), 0);
  if (total <= 0) return 0;
  const target = Math.max(1, Math.ceil(total * percentile));
  const keys = [...HISTOGRAM_BOUNDS_MS.map((bound) => `le_${bound}`), "gt_30000"];
  let seen = 0;
  for (const key of keys) {
    seen += Number(histogram[key]) || 0;
    if (seen >= target) return histogramUpperBound(key);
  }
  return histogramUpperBound(keys[keys.length - 1]);
}

function normalizeMeasurement(input = {}, fallbackRoute = "unknown") {
  const name = safeToken(input.name, "metric", 80);
  const module = safeToken(input.module, "erp", 48);
  const route = safeRoute(input.route || fallbackRoute);
  const unit = ["ms", "count", "ratio", "bytes"].includes(input.unit) ? input.unit : "count";
  const value = safeNumber(input.value, 0, unit === "bytes" ? 1_000_000_000 : 120_000);
  if (value === null) return null;
  return {
    name,
    module,
    route,
    unit,
    value,
    error: input.error === true,
  };
}

function aggregateMeasurements(measurements, release) {
  const aggregated = new Map();
  for (const measurement of measurements) {
    const releaseToken = safeToken(release, "unknown", 40);
    const key = `${measurement.module}__${measurement.name}__${releaseToken}`;
    const current = aggregated.get(key) || {
      module: measurement.module,
      name: measurement.name,
      release: releaseToken,
      unit: measurement.unit,
      count: 0,
      sum: 0,
      errors: 0,
      histogram: {},
    };
    current.count += 1;
    current.sum += measurement.value;
    if (measurement.error) current.errors += 1;
    if (measurement.unit === "ms") {
      const bucket = histogramBucket(measurement.value);
      current.histogram[bucket] = (current.histogram[bucket] || 0) + 1;
    }
    aggregated.set(key, current);
  }
  return aggregated;
}

function incrementalMetric(metric) {
  const histogram = {};
  for (const [key, value] of Object.entries(metric.histogram || {})) histogram[key] = FieldValue.increment(value);
  return {
    module: metric.module,
    name: metric.name,
    release: metric.release,
    unit: metric.unit,
    count: FieldValue.increment(metric.count),
    sum: FieldValue.increment(metric.sum),
    errors: FieldValue.increment(metric.errors),
    ...(Object.keys(histogram).length ? { histogram } : {}),
  };
}

function mergeDashboardMetric(target, source) {
  const key = `${source.module}__${source.name}__${source.release}`;
  const current = target.get(key) || {
    module: source.module,
    name: source.name,
    release: source.release,
    unit: source.unit,
    count: 0,
    sum: 0,
    errors: 0,
    histogram: {},
  };
  current.count += Number(source.count) || 0;
  current.sum += Number(source.sum) || 0;
  current.errors += Number(source.errors) || 0;
  for (const [bucket, value] of Object.entries(source.histogram || {})) {
    current.histogram[bucket] = (current.histogram[bucket] || 0) + (Number(value) || 0);
  }
  target.set(key, current);
}

function serializeDashboardMetric(metric) {
  const average = metric.count > 0 ? metric.sum / metric.count : 0;
  return {
    module: metric.module,
    name: metric.name,
    release: metric.release,
    unit: metric.unit,
    count: metric.count,
    average: Math.round(average * 100) / 100,
    errors: metric.errors,
    errorRate: metric.count > 0 ? Math.round((metric.errors / metric.count) * 10000) / 100 : 0,
    p50: metric.unit === "ms" ? percentileFromHistogram(metric.histogram, metric.count, 0.5) : null,
    p95: metric.unit === "ms" ? percentileFromHistogram(metric.histogram, metric.count, 0.95) : null,
    p99: metric.unit === "ms" ? percentileFromHistogram(metric.histogram, metric.count, 0.99) : null,
  };
}

function createPerformanceTelemetryApi({ db, verifyIdToken, now = () => Date.now() } = {}) {
  if (!db || typeof db.collection !== "function") throw new Error("A Firestore-compatible db is required.");
  if (typeof verifyIdToken !== "function") throw new Error("verifyIdToken is required.");

  async function identity(request) {
    const token = bearerToken(request);
    if (!token) {
      const error = new Error("Firebase authentication is required.");
      error.code = "unauthenticated";
      throw error;
    }
    let decoded;
    try {
      decoded = await verifyIdToken(token);
    } catch (cause) {
      const error = new Error("The Firebase session is invalid or expired.");
      error.code = "unauthenticated";
      error.cause = cause;
      throw error;
    }
    const uid = cleanText(decoded.uid || decoded.user_id || decoded.sub, 180);
    const profileSnapshot = await db.collection("users").doc(uid).get();
    const profile = profileSnapshot.exists ? (profileSnapshot.data() || {}) : {};
    if (profile.active !== true) {
      const error = new Error("This DEMAC ERP account is inactive or not provisioned.");
      error.code = "permission_denied";
      throw error;
    }
    return {
      uid,
      role: normalizedRole(profile.role || decoded.role),
    };
  }

  async function ingest(data, actor) {
    const sessionId = safeToken(data.sessionId, "", 96);
    if (!sessionId) {
      const error = new Error("A telemetry session id is required.");
      error.code = "invalid_request";
      throw error;
    }
    const route = safeRoute(data.route);
    const module = safeToken(data.module, "erp", 48);
    const release = safeToken(data.release, "unknown", 40);
    const supplied = Array.isArray(data.measurements) ? data.measurements.slice(0, MAX_MEASUREMENTS) : [];
    const measurements = supplied.map((entry) => normalizeMeasurement(entry, route)).filter(Boolean);
    if (!measurements.length) return { success: true, version: API_VERSION, accepted: 0 };

    const nowMs = now();
    const startMs = bucketStartMs(nowMs);
    const shard = sessionShard(sessionId);
    const bucketId = `${startMs}-${shard}`;
    const bucketRef = db.collection("performanceTelemetryBuckets").doc(bucketId);
    const aggregates = aggregateMeasurements(measurements, release);
    const metrics = {};
    for (const [key, metric] of aggregates) metrics[key] = incrementalMetric(metric);

    await bucketRef.set({
      bucketStartAt: Timestamp.fromMillis(startMs),
      bucketStartMs: startMs,
      shard,
      metrics,
      expiresAt: Timestamp.fromMillis(startMs + TELEMETRY_RETENTION_MS),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    await db.collection("performanceTelemetrySessions").doc(sessionId).set({
      sessionId,
      role: actor.role,
      route,
      module,
      release,
      lastSeenAt: FieldValue.serverTimestamp(),
      lastSeenMs: nowMs,
      expiresAt: Timestamp.fromMillis(nowMs + SESSION_RETENTION_MS),
    }, { merge: true });

    return { success: true, version: API_VERSION, accepted: measurements.length, bucketStartMs: startMs };
  }

  async function dashboard(data, actor) {
    if (!DASHBOARD_ROLES.has(actor.role)) {
      const error = new Error("Performance & Health Center is restricted to authorized system roles.");
      error.code = "permission_denied";
      throw error;
    }
    const allowedMinutes = new Set([60, 360, 1_440, 10_080, 43_200]);
    const requested = Number(data.rangeMinutes);
    const rangeMinutes = allowedMinutes.has(requested) ? requested : 1_440;
    const nowMs = now();
    const sinceMs = nowMs - rangeMinutes * 60_000;
    const query = await db.collection("performanceTelemetryBuckets")
      .where("bucketStartAt", ">=", Timestamp.fromMillis(sinceMs))
      .orderBy("bucketStartAt", "asc")
      .limit(MAX_DASHBOARD_BUCKETS)
      .get();

    const merged = new Map();
    const timeline = new Map();
    let latestBucketMs = 0;
    for (const doc of query.docs) {
      const value = doc.data() || {};
      const startMs = Number(value.bucketStartMs) || value.bucketStartAt?.toMillis?.() || 0;
      latestBucketMs = Math.max(latestBucketMs, startMs);
      const timelineEntry = timeline.get(startMs) || {
        bucketStartMs: startMs,
        samples: 0,
        errors: 0,
        latencySum: 0,
        latencyCount: 0,
      };
      for (const metric of Object.values(value.metrics || {})) {
        if (!metric || typeof metric !== "object") continue;
        mergeDashboardMetric(merged, metric);
        const metricCount = Number(metric.count) || 0;
        timelineEntry.samples += metricCount;
        timelineEntry.errors += Number(metric.errors) || 0;
        if (metric.unit === "ms") {
          timelineEntry.latencySum += Number(metric.sum) || 0;
          timelineEntry.latencyCount += metricCount;
        }
      }
      timeline.set(startMs, timelineEntry);
    }

    const activeSinceMs = nowMs - 10 * 60_000;
    const sessionsSnapshot = await db.collection("performanceTelemetrySessions")
      .where("lastSeenMs", ">=", activeSinceMs)
      .limit(200)
      .get();
    const activeModules = {};
    const activeRoles = {};
    for (const doc of sessionsSnapshot.docs) {
      const value = doc.data() || {};
      const module = safeToken(value.module, "erp", 48);
      const role = normalizedRole(value.role);
      activeModules[module] = (activeModules[module] || 0) + 1;
      activeRoles[role] = (activeRoles[role] || 0) + 1;
    }

    const serializedTimeline = [...timeline.values()]
      .sort((a, b) => a.bucketStartMs - b.bucketStartMs)
      .map((entry) => ({
        bucketStartMs: entry.bucketStartMs,
        samples: entry.samples,
        errors: entry.errors,
        averageLatencyMs: entry.latencyCount > 0
          ? Math.round((entry.latencySum / entry.latencyCount) * 100) / 100
          : 0,
      }));

    return {
      success: true,
      version: API_VERSION,
      generatedAt: new Date(nowMs).toISOString(),
      rangeMinutes,
      bucketCount: query.size,
      truncated: query.size >= MAX_DASHBOARD_BUCKETS,
      latestBucketAt: latestBucketMs ? new Date(latestBucketMs).toISOString() : null,
      metrics: [...merged.values()].map(serializeDashboardMetric),
      timeline: serializedTimeline,
      activeSessions: sessionsSnapshot.size,
      activeModules,
      activeRoles,
    };
  }

  async function handle(request) {
    if (request.method === "OPTIONS") return { status: 204, body: null };
    if (request.method !== "POST") return { status: 405, body: { error: { code: "method_not_allowed", message: "POST is required." } } };
    try {
      const actor = await identity(request);
      const action = cleanText(request.body?.action, 80);
      const data = request.body?.data && typeof request.body.data === "object" ? request.body.data : {};
      const body = action === "ingest"
        ? await ingest(data, actor)
        : action === "dashboard"
          ? await dashboard(data, actor)
          : (() => {
            const error = new Error("Unknown performance telemetry action.");
            error.code = "invalid_request";
            throw error;
          })();
      return { status: 200, body };
    } catch (error) {
      const code = cleanText(error?.code, 80) || "internal_error";
      const status = code === "unauthenticated" ? 401 : code === "permission_denied" ? 403 : code === "invalid_request" ? 400 : 500;
      return { status, body: { error: { code, message: error?.message || "Performance telemetry request failed." } } };
    }
  }

  return { handle, ingest, dashboard };
}

let defaultApi = null;
function getDefaultApi() {
  if (!defaultApi) {
    defaultApi = createPerformanceTelemetryApi({
      db: getFirestore(),
      verifyIdToken: (token) => getAuth().verifyIdToken(token),
    });
  }
  return defaultApi;
}

const performanceTelemetry = onRequest(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30, minInstances: 0 },
  async (request, response) => {
    response.set("Access-Control-Allow-Origin", "*");
    response.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    const result = await getDefaultApi().handle(request);
    if (result.status === 204) {
      response.status(204).send("");
      return;
    }
    response.status(result.status).json(result.body);
  },
);

module.exports = {
  API_VERSION,
  HISTOGRAM_BOUNDS_MS,
  aggregateMeasurements,
  bucketStartMs,
  createPerformanceTelemetryApi,
  histogramBucket,
  normalizeMeasurement,
  percentileFromHistogram,
  performanceTelemetry,
  sessionShard,
};
