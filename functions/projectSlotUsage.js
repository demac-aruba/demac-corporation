'use strict';

const { fail, identifier } = require('./projectRecords');

const cancelled = status => ['cancelada', 'cancelled', 'canceled'].includes(String(status ?? '').trim().toLowerCase());

async function readProjectUsage(db, get, project) {
  if (!Array.isArray(project.assignments)) fail('Project booking links could not be reconciled.');
  const links = project.assignments;
  const ids = links.map(link => identifier(link.workOrderId));
  if (new Set(ids).size !== ids.length) fail('Project Work Order links are ambiguous.');
  const snapshots = await Promise.all(ids.map(id => get(db.collection('workOrders').doc(id))));
  let usedSlots = 0;
  let unpostedScheduledSlots = 0;
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index]; const snap = snapshots[index]; const order = snap.exists ? snap.data() : null;
    if (!order || order.appointmentId !== link.appointmentId || order.clientId !== project.customerId
      || order.propertyId !== project.siteId || link.projectId !== project.id) {
      fail('Project slot usage could not be reconciled with canonical Work Orders.');
    }
    if (cancelled(order.status)) continue;
    const slots = Number(order.scheduledSlots);
    if (!Number.isSafeInteger(slots) || slots < 1 || slots > 6) fail('Project Work Order slot count is invalid.');
    usedSlots += slots;
    if (!link.postedAt) unpostedScheduledSlots += slots;
  }
  const budgetSlots = Number(project.estimatedSlots);
  if (!Number.isSafeInteger(budgetSlots) || budgetSlots < 0) fail('Approved Project slot budget is invalid.');
  return { budgetSlots, usedSlots, unpostedScheduledSlots };
}

module.exports = { readProjectUsage };
