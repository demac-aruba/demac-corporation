const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { canonicalizeVanCatalog } = require("../bookingVanIdentity");
const { VAN_SCHEDULE_GROUP_TARGETS } = require("../vanScheduleGroupIdentity");
const { createWhatsAppTransactionalService, validWacliRecipient } = require("../whatsappTransactionalService");

initializeApp();

const db = getFirestore();
const whatsapp = createWhatsAppTransactionalService({ db });
const labelsByVan = new Map(VAN_SCHEDULE_GROUP_TARGETS.map((item) => [item.vanId, item.label]));

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const probeId = String(process.env.PROBE_ID || Date.now()).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const snapshot = await db.collection("vans").get();
  const rawVans = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  const catalog = canonicalizeVanCatalog(rawVans);

  if (catalog.vans.length !== 4) {
    throw new Error(`Expected exactly four active canonical vans; found ${catalog.vans.length}. No probe messages were queued.`);
  }

  const probes = catalog.vans.map((van) => {
    const label = labelsByVan.get(van.id) || van.id;
    const groupJid = String(van.whatsappScheduleGroupJid || "").trim();
    if (!groupJid.endsWith("@g.us") || !validWacliRecipient(groupJid)) {
      throw new Error(`${van.id} does not have a valid WhatsApp group JID. No probe messages were queued.`);
    }
    return { vanId: van.id, label, groupJid };
  });

  if (new Set(probes.map((item) => item.groupJid)).size !== 4) {
    throw new Error("The four canonical vans do not currently point to four unique WhatsApp group JIDs. No probe messages were queued.");
  }

  const queued = [];
  for (const probe of probes) {
    const queueId = `van-group-id-probe-${probeId}-${probe.vanId.toLowerCase()}`;
    const result = await whatsapp.queueWacliText({
      queueId,
      to: probe.groupJid,
      text: probe.label,
      metadata: {
        purpose: "van-group-id-probe",
        intendedVanId: probe.vanId,
        intendedGroupLabel: probe.label,
        createdByUserId: "github-actions-van-group-id-probe",
        createdByName: "DEMAC Van Group ID Probe",
      },
    });
    if (!result.queued) {
      throw new Error(`Could not queue ${probe.vanId}: ${result.reason || "unknown reason"}`);
    }
    queued.push({ ...probe, queueId: result.queueId, created: result.created });
  }

  const deadline = Date.now() + 120_000;
  let statuses = [];
  while (Date.now() < deadline) {
    statuses = await Promise.all(queued.map(async (probe) => {
      const doc = await db.collection("whatsappOutboundQueue").doc(probe.queueId).get();
      const data = doc.exists ? doc.data() || {} : {};
      return {
        vanId: probe.vanId,
        label: probe.label,
        groupJid: probe.groupJid,
        queueId: probe.queueId,
        status: String(data.status || "missing"),
        messageId: String(data.messageId || ""),
        errorMessage: String(data.errorMessage || ""),
      };
    }));

    if (statuses.every((item) => item.status === "sent")) break;
    if (statuses.some((item) => item.status === "failed")) break;
    await sleep(2_000);
  }

  console.log(JSON.stringify({ probeId, messages: statuses }, null, 2));

  const failed = statuses.filter((item) => item.status === "failed");
  if (failed.length) {
    throw new Error(`Van group ID probe had ${failed.length} failed WhatsApp send(s).`);
  }
  if (!statuses.length || statuses.some((item) => item.status !== "sent")) {
    throw new Error("Van group ID probe did not receive sent acknowledgements for all four messages before timeout.");
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
