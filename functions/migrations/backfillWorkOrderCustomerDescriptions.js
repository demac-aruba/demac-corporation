const { getApps, initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

if (!getApps().length) initializeApp();

const MIGRATION_ID = "customer-facing-description-work-order-v1";

function clean(value, max = 1500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function appointmentCustomerDescription(appointment = {}) {
  const descriptions = [...new Set((Array.isArray(appointment.workLines) ? appointment.workLines : [])
    .map((line) => clean(line?.customerFacingDescription))
    .filter(Boolean))];
  return clean(descriptions.join("; "));
}

function labelByPresetFromOrders(orders = []) {
  const labels = new Map();
  for (const order of orders) {
    for (const item of Array.isArray(order?.appointmentWorkItems) ? order.appointmentWorkItems : []) {
      const presetId = clean(item?.presetId, 180);
      const label = clean(item?.label, 180);
      if (presetId && label && !labels.has(presetId)) labels.set(presetId, label);
    }
    const presetId = clean(order?.appointmentPresetId || order?.appointmentWorkType, 180);
    const label = clean(order?.appointmentWorkLabel, 180);
    if (presetId && label && !labels.has(presetId)) labels.set(presetId, label);
  }
  return labels;
}

function automaticDescriptionForAppointment(appointment = {}, orders = []) {
  const labels = labelByPresetFromOrders(orders);
  const entries = (Array.isArray(appointment.workLines) ? appointment.workLines : []).map((line) => {
    const presetId = clean(line?.presetId, 180);
    const label = labels.get(presetId) || clean(line?.label || line?.presetLabel || presetId, 180);
    const quantity = Math.max(1, Number(line?.quantity) || 1);
    return label ? `${quantity} × ${label}` : "";
  }).filter(Boolean);
  return entries.length ? `Scheduled work: ${entries.join("; ")}.` : "";
}

function groupOrdersByAppointment(orderDocs) {
  const grouped = new Map();
  for (const doc of orderDocs) {
    const data = typeof doc.data === "function" ? doc.data() : doc.data || {};
    const appointmentId = clean(data.appointmentId, 240);
    if (!appointmentId) continue;
    const current = grouped.get(appointmentId) || [];
    current.push({ ref: doc.ref, id: doc.id, data });
    grouped.set(appointmentId, current);
  }
  return grouped;
}

async function commitWrites(db, writes) {
  let updated = 0;
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    const page = writes.slice(offset, offset + 400);
    for (const write of page) batch.set(write.ref, write.data, { merge: true });
    await batch.commit();
    updated += page.length;
  }
  return updated;
}

async function run({ db = getFirestore() } = {}) {
  const markerRef = db.collection("systemMigrations").doc(MIGRATION_ID);
  const marker = await markerRef.get();
  if (marker.exists && marker.data()?.completed === true) {
    return { migrationId: MIGRATION_ID, skipped: true, appointmentsScanned: 0, workOrdersUpdated: 0 };
  }

  const [appointmentsSnapshot, workOrdersSnapshot] = await Promise.all([
    db.collection("appointments").get(),
    db.collection("workOrders").get(),
  ]);
  const ordersByAppointment = groupOrdersByAppointment(workOrdersSnapshot.docs);
  const writes = [];
  let appointmentsWithDescription = 0;

  for (const appointmentDoc of appointmentsSnapshot.docs) {
    const appointment = appointmentDoc.data() || {};
    const description = appointmentCustomerDescription(appointment);
    if (!description) continue;
    appointmentsWithDescription += 1;
    const appointmentId = clean(appointment.appointmentId || appointmentDoc.id, 240);
    const orders = ordersByAppointment.get(appointmentId) || [];
    if (!orders.length) continue;
    const automaticDescription = clean(automaticDescriptionForAppointment(appointment, orders));
    const isDefault = Boolean(automaticDescription && automaticDescription === description);

    for (const order of orders) {
      if (clean(order.data.customerFacingDescription)) continue;
      writes.push({
        ref: order.ref,
        data: {
          customerFacingDescription: description,
          customerFacingDescriptionIsDefault: isDefault,
          customerFacingDescriptionBackfilledAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    }
  }

  const workOrdersUpdated = await commitWrites(db, writes);
  await markerRef.set({
    migrationId: MIGRATION_ID,
    completed: true,
    appointmentsScanned: appointmentsSnapshot.size,
    appointmentsWithDescription,
    workOrdersUpdated,
    completedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    migrationId: MIGRATION_ID,
    skipped: false,
    appointmentsScanned: appointmentsSnapshot.size,
    appointmentsWithDescription,
    workOrdersUpdated,
  };
}

if (require.main === module) {
  run()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  MIGRATION_ID,
  appointmentCustomerDescription,
  automaticDescriptionForAppointment,
  groupOrdersByAppointment,
  run,
};