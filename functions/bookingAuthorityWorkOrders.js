const { cleanText } = require("./bookingAuthorityCore");

function notificationRecipient(client) {
  const target = cleanText(client?.whatsapp || client?.phone, 80);
  if (!target) return null;
  return {
    id: `client-${client.id}`,
    recipientType: "client",
    sourceId: client.id,
    name: client.name || "Cliente",
    role: "Cliente / facturación",
    phone: client.phone || "",
    phoneCountry: client.phoneCountry || "AW",
    whatsapp: client.whatsapp || client.phone || "",
    whatsappCountry: client.whatsappCountry || client.phoneCountry || "AW",
    preferredLanguage: client.preferredLanguage || "Español",
    sendConfirmation: true,
    sendReminder: true,
  };
}

function fallbackWorkItem(option, assignment, request) {
  const primaryWork = request.workLines?.[0] || {};
  return {
    id: primaryWork.id || primaryWork.presetId || "work-1",
    presetId: primaryWork.presetId || option.presetId || "",
    serviceId: primaryWork.serviceId || option.serviceId || "",
    label: option.presetLabel || primaryWork.presetId || "Service",
    quantity: assignment.quantity,
    durationMinutes: Math.max(30, Number(assignment.durationMinutes) || assignment.slots * 60),
    durationMinutesPerUnit: Math.max(30, Number(option.durationMinutesPerUnit) || 60),
    durationMode: option.durationMode || "per_unit",
    serviceDefinitionVersion: option.serviceDefinitionVersion || 0,
  };
}

function workItemsForAssignment(option, assignment, request) {
  const optionItems = Array.isArray(option.workItems) ? option.workItems : [];
  if (!optionItems.length) return [fallbackWorkItem(option, assignment, request)];

  // Mixed appointments are intentionally kept on one van, so every selected
  // line belongs to the same Work Order. A single-service job may use support;
  // in that case split only that service quantity according to the assignment.
  if (optionItems.length > 1 || option.assignments.length === 1) {
    return optionItems.map((item) => ({ ...item }));
  }

  const item = optionItems[0];
  const durationMinutes = Math.max(
    30,
    Number(assignment.durationMinutes)
      || (item.durationMode === "fixed" || item.durationMode === "manual"
        ? item.durationMinutes
        : assignment.quantity * item.durationMinutesPerUnit),
  );
  return [{ ...item, quantity: assignment.quantity, durationMinutes }];
}

function normalizedRecipientSnapshots(context, customer) {
  const supplied = Array.isArray(context?.notificationRecipients)
    ? context.notificationRecipients.filter((recipient) => recipient && typeof recipient === "object")
    : [];
  if (supplied.length) return supplied.map((recipient) => ({ ...recipient }));
  const fallback = notificationRecipient(customer);
  return fallback ? [fallback] : [];
}

function buildWorkOrders({ appointment, option, request, customer, property, context = {}, now = new Date() }) {
  const notificationRecipients = normalizedRecipientSnapshots(context, customer);
  const whatsappEnabled = notificationRecipients.some((recipient) =>
    (recipient.sendConfirmation === true || recipient.sendReminder === true)
    && cleanText(recipient.whatsapp || recipient.phone, 80));
  const supportCount = Math.max(0, option.assignments.length - 1);

  return option.assignments.map((assignment, index) => {
    const id = `WO-${appointment.appointmentId}-${index + 1}`;
    const isPrimary = index === 0;
    const workItems = workItemsForAssignment(option, assignment, request);
    const singleItem = workItems.length === 1 ? workItems[0] : null;
    const workSummary = workItems
      .map((item) => `${item.label || item.presetId} × ${item.quantity}`)
      .join("; ");
    const durationMinutes = Math.max(
      30,
      Number(assignment.durationMinutes)
        || workItems.reduce((sum, item) => sum + Math.max(0, Number(item.durationMinutes) || 0), 0)
        || assignment.slots * 60,
    );
    const workType = singleItem?.presetId || "multiple_services";
    const workLabel = singleItem?.label || "Multiple services";
    const serviceId = singleItem?.serviceId || "";
    const durationMode = singleItem?.durationMode || (workItems.length > 1 ? "mixed" : option.durationMode || "per_unit");
    const problem = workSummary || "Scheduled HVAC work";
    const appointmentEndTime = cleanText(assignment.endTime || option.endTime, 20);

    return {
      id,
      appointmentId: appointment.appointmentId,
      clientId: customer.id,
      propertyId: property.id,
      serviceId,
      date: option.date,
      time: assignment.time || option.time,
      status: "Confirmada",
      technicianIds: assignment.technicianIds || [],
      vanId: assignment.vanId,
      address: option.address || property.address || property.addressRaw || "",
      zone: option.zone || property.operationalZone || property.zone || "",
      problem: isPrimary ? `${problem}.` : `Apoyo a la cita principal: ${problem}.`,
      officeNotes: isPrimary
        ? `Cita creada por DEMAC Booking Authority${supportCount ? ` con ${supportCount} van(es) de apoyo` : ""}.`
        : "Asignación interna de van de apoyo. No enviar confirmación ni recordatorio duplicado.",
      appointmentWorkType: workType,
      appointmentPresetId: workType,
      appointmentWorkLabel: workLabel,
      appointmentDurationMinutes: durationMinutes,
      appointmentDurationMode: durationMode,
      appointmentEndTime,
      serviceDefinitionVersion: singleItem?.serviceDefinitionVersion || 0,
      appointmentWorkItems: workItems,
      appointmentAssignmentRole: isPrimary ? "primary" : "support",
      parentWorkOrderId: isPrimary ? undefined : `WO-${appointment.appointmentId}-1`,
      fullDaySingleProperty: assignment.fullDay === true,
      amount: 0,
      paid: 0,
      schedulingMode: durationMode === "per_unit" ? "perUnit" : "fixed",
      airConditionerCount: assignment.quantity,
      scheduledSlots: assignment.slots,
      whatsappNotificationsEnabled: isPrimary && whatsappEnabled,
      notificationRecipients: isPrimary ? notificationRecipients : [],
      confirmedAt: now.toISOString(),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      createdBy: "booking-authority",
    };
  });
}

module.exports = {
  buildWorkOrders,
  notificationRecipient,
  normalizedRecipientSnapshots,
  workItemsForAssignment,
};
