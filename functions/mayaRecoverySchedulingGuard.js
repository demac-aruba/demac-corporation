'use strict';

const { createSchedulingProvider } = require('./bookingAuthoritySchedulingProvider');
const { documentId } = require('./mayaOperationsReadModel');
const { requireCondition: need } = require('./mayaRecoveryOfferPolicy');

// A guard around the existing provider, not another scheduling engine. Lifecycle
// generates canonical Work Order IDs which may differ from a legacy appointment's
// linked IDs. Read generated destinations before any lifecycle writes, so a stale
// or foreign record cannot be merged into merely because its generated ID matches.
function createRecoveryLifecycleProvider({ db }) {
  const provider = createSchedulingProvider({ db });
  const build = provider.buildWorkOrders.bind(provider);
  return {
    ...provider,
    async buildWorkOrders(args) {
      const workOrders = await build(args);
      const appointmentId = args.appointment.appointmentId || args.appointment.id;
      const references = workOrders.map(order => db.collection('workOrders').doc(documentId(order.id)));
      const snapshots = await Promise.all(references.map(ref => ref.get()));
      const linked = new Set(args.appointment.workOrderIds || []);
      snapshots.forEach((snapshot, index) => {
        const orderId = workOrders[index].id;
        if (!snapshot.exists) {
          need(!linked.has(orderId), 'recovery_original_work_changed');
          return;
        }
        const current = snapshot.data();
        // Never adopt an unlinked preexisting record, even one asserting the same
        // Appointment ID. Unlinked records require reconciliation outside recovery.
        need(linked.has(orderId) && current.appointmentId === appointmentId
          && current.clientId === args.request.customerId && current.propertyId === args.request.propertyId,
        'recovery_work_destination_conflict');
      });
      return workOrders;
    },
  };
}
module.exports = { createRecoveryLifecycleProvider };
