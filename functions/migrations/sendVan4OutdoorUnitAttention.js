const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { canonicalizeVanCatalog } = require("../bookingVanIdentity");
const { createWhatsAppTransactionalService, validWacliRecipient } = require("../whatsappTransactionalService");

initializeApp();

const db = getFirestore();
const whatsapp = createWhatsAppTransactionalService({ db });
const MESSAGE = "Goyo y Walter, por favor tengan más atención con los outdoor units porque están quedando sucios. Asegúrense de dejarlos bien limpios antes de terminar cada trabajo.";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const snapshot = await db.collection("vans").get();
  const rawVans = snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
  const catalog = canonicalizeVanCatalog(rawVans);
  const van4 = catalog.vans.find((van) => van.id === "VAN-4");
  if (!van4) throw new Error("VAN-4 was not found in the canonical van catalog.");

  const groupJid = String(van4.whatsappScheduleGroupJid || "").trim();
  if (!groupJid.endsWith("@g.us") || !validWacliRecipient(groupJid)) {
    throw new Error("VAN-4 does not have a valid WhatsApp group JID.");
  }

  const queueId = `van4-outdoor-unit-attention-2026-08-22`;
  const result = await whatsapp.queueWacliText({
    queueId,
    to: groupJid,
    text: MESSAGE,
    metadata: {
      purpose: "van4-outdoor-unit-cleanliness-attention",
      intendedVanId: "VAN-4",
      createdByUserId: "github-actions-van4-message",
      createdByName: "DEMAC Operations",
    },
  });
  if (!result.queued) throw new Error(`Could not queue message: ${result.reason || "unknown reason"}`);

  const deadline = Date.now() + 120000;
  let status = "";
  let errorMessage = "";
  while (Date.now() < deadline) {
    const doc = await db.collection("whatsappOutboundQueue").doc(result.queueId).get();
    const data = doc.exists ? doc.data() || {} : {};
    status = String(data.status || "missing");
    errorMessage = String(data.errorMessage || "");
    if (status === "sent" || status === "failed") break;
    await sleep(2000);
  }

  console.log(JSON.stringify({ vanId: "VAN-4", groupName: van4.whatsappScheduleGroupName || "Goyo y Walter", queueId: result.queueId, status, errorMessage }, null, 2));
  if (status !== "sent") throw new Error(errorMessage || `Message status is ${status || "unknown"}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
