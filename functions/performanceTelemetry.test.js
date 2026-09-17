const test = require("node:test");
const assert = require("node:assert/strict");

const {
  aggregateMeasurements,
  bucketStartMs,
  histogramBucket,
  normalizeMeasurement,
  percentileFromHistogram,
  sessionShard,
} = require("./performanceTelemetry");

test("histogram buckets keep latency boundaries deterministic", () => {
  assert.equal(histogramBucket(0), "le_50");
  assert.equal(histogramBucket(50), "le_50");
  assert.equal(histogramBucket(51), "le_100");
  assert.equal(histogramBucket(800), "le_800");
  assert.equal(histogramBucket(801), "le_1500");
  assert.equal(histogramBucket(45_000), "gt_30000");
});

test("percentile calculation uses aggregated histogram without raw events", () => {
  const histogram = {
    le_50: 1,
    le_100: 2,
    le_200: 4,
    le_400: 3,
  };
  assert.equal(percentileFromHistogram(histogram, 10, 0.5), 200);
  assert.equal(percentileFromHistogram(histogram, 10, 0.95), 400);
  assert.equal(percentileFromHistogram({}, 0, 0.95), 0);
});

test("measurements are sanitized, bounded and contain no arbitrary payload", () => {
  const normalized = normalizeMeasurement({
    name: "Schedule Data Ready !!!",
    module: "Scheduling / Main",
    route: "/scheduling?week=2026-09-16&customer=private",
    value: 1842.5,
    unit: "ms",
    error: true,
    customerName: "must-not-survive",
  });
  assert.deepEqual(normalized, {
    name: "schedule_data_ready",
    module: "scheduling_main",
    route: "/scheduling",
    value: 1842.5,
    unit: "ms",
    error: true,
  });

  const bounded = normalizeMeasurement({ name: "huge", module: "erp", value: 999_999, unit: "ms" });
  assert.equal(bounded.value, 120_000);
});

test("aggregation groups by metric and release and counts errors", () => {
  const metrics = [
    normalizeMeasurement({ name: "schedule_data_ready", module: "scheduling", value: 120, unit: "ms" }),
    normalizeMeasurement({ name: "schedule_data_ready", module: "scheduling", value: 420, unit: "ms", error: true }),
    normalizeMeasurement({ name: "route_view", module: "scheduling", value: 1, unit: "count" }),
  ];
  const result = aggregateMeasurements(metrics, "ABC-123");
  const schedule = result.get("scheduling__schedule_data_ready__abc-123");
  assert.equal(schedule.count, 2);
  assert.equal(schedule.sum, 540);
  assert.equal(schedule.errors, 1);
  assert.equal(schedule.histogram.le_200, 1);
  assert.equal(schedule.histogram.le_800, 1);

  const views = result.get("scheduling__route_view__abc-123");
  assert.equal(views.count, 1);
  assert.equal(views.sum, 1);
  assert.deepEqual(views.histogram, {});
});

test("bucket and shard assignment are stable", () => {
  const timestamp = Date.UTC(2026, 8, 16, 13, 17, 42);
  assert.equal(bucketStartMs(timestamp), Date.UTC(2026, 8, 16, 13, 15, 0));
  assert.equal(sessionShard("erp-session-1"), sessionShard("erp-session-1"));
  assert.ok(sessionShard("erp-session-1") >= 0 && sessionShard("erp-session-1") < 4);
});
