const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { createTechnicianDailyScheduleService } = require("../technicianDailyScheduleService");

const DATE_KEY = "2026-08-22";
const DELIVERY_KEY = "manual-chatgpt-20260822-0812";
const SUCCESS_STATES = new Set(["sent", "delivered", "read"]);
const FAILURE_STATES = new Set(["failed", "cancelled"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactResult(item = {}) {
  return {
    vanId: String(item.vanId || ""),
    groupName: String(item.groupName || ""),
    workOrderId: String(item.workOrderId || ""),
    lunchBreak: item.lunchBreak === true,
    queueId: String(item.queueId || ""),
    queued: item.queued === true,
    created: item.created === true,
    existing: item.existing === true,
    reason: String(item.reason || ""),
  };
}

async function queueStatuses(db, queueIds) {
  return Promise.all(queueIds.map(async (queueId) => {
    const snapshot = await db.collection("whatsappOutboundQueue").doc(queueId).get();
    const data = snapshot.exists ? snapshot.data() || {} : {};
    return {
      queueId,
      status: snapshot.exists ? String(data.status || "unknown").toLowerCase() : "missing",
      messageId: String(data.messageId || ""),
      errorMessage: String(data.errorMessage || ""),
    };
  }));
}

async function main() {
  initializeApp();
  const db = getFirestore();
  const schedules = createTechnicianDailyScheduleService({ db });

  const result = await schedules.queueDay(DATE_KEY, {
    deliveryKey: DELIVERY_KEY,
    reason: "manual-office-van-schedule",
  });

  if (result.dateKey !== DATE_KEY) {
    throw new Error(`Schedule service returned ${result.dateKey || "no date"}; expected ${DATE_KEY}.`);
  }
  if (result.vanCount !== 4) {
    throw new Error(`Expected four canonical Vans; schedule service returned ${result.vanCount}.`);
  }
  if (!result.workOrderCount) {
    throw new Error(`No active Work Orders were found for ${DATE_KEY}. Nothing was sent.`);
  }

  const attempted = (result.results || []).map(compactResult);
  const rejected = attempted.filter((item) => !item.queued);
  if (rejected.length) {
    throw new Error(`Schedule queue rejected ${rejected.length} message(s): ${JSON.stringify(rejected)}`);
  }

  const queueIds = [...new Set(attempted.map((item) => item.queueId).filter(Boolean))];
  if (!queueIds.length || queueIds.length !== result.messageCount) {
    throw new Error(`Expected ${result.messageCount} queue ids; found ${queueIds.length}.`);
  }

  const deadline = Date.now() + 120_000;
  let statuses = [];
  while (Date.now() < deadline) {
    statuses = await queueStatuses(db, queueIds);
    if (statuses.every((item) => SUCCESS_STATES.has(item.status))) break;
    if (statuses.some((item) => FAILURE_STATES.has(item.status))) break;
    await sleep(2_000);
  }

  const failures = statuses.filter((item) => FAILURE_STATES.has(item.status));
  if (failures.length) {
    throw new Error(`WhatsApp delivery failed for ${failures.length} message(s): ${JSON.stringify(failures)}`);
  }
  const pending = statuses.filter((item) => !SUCCESS_STATES.has(item.status));
  if (pending.length) {
    throw new Error(`Timed out waiting for ${pending.length} WhatsApp acknowledgement(s): ${JSON.stringify(pending)}`);
  }

  const perVan = {};
  for (const item of attempted) {
    if (!perVan[item.vanId]) perVan[item.vanId] = { messages: 0, workOrders: 0, lunchBreaks: 0 };
    perVan[item.vanId].messages += 1;
    if (item.lunchBreak) perVan[item.vanId].lunchBreaks += 1;
    else perVan[item.vanId].workOrders += 1;
  }

  process.stdout.write(`${JSON.stringify({
    success: true,
    dateKey: result.dateKey,
    vanCount: result.vanCount,
    workOrderCount: result.workOrderCount,
    lunchBreakCount: result.lunchBreakCount,
    messageCount: result.messageCount,
    deliveryKey: DELIVERY_KEY,
    perVan,
    acknowledgements: statuses.map((item) => ({ queueId: item.queueId, status: item.status, messageId: item.messageId })),
  })}\n`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
