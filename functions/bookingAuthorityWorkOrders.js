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

function requestCustomerFacingDescription(request) {
  const descriptions = [...new Set((Array.isArray(request?.workLines) ? request.workLines : [])
    .map((line) => cleanText(line?.customerFacingDescription, 1500))
    .filter(Boolean))];
  return cleanText(descriptions.join("; "), 1500);
}

function requestTechnicianInstructions(request) {
  const instructions = [...new Set((Array.isArray(request?.workLines) ? request.workLines : [])
    .map((line) => cleanText(line?.technicianInstructions, 1500))
    .filter(Boolean))];
  return cleanText(instructions.join("; "), 1500);
}

function automaticCustomerFacingDescription(option, request) {
  const optionItems = Array.isArray(option?.workItems) ? option.workItems.filter(Boolean) : [];
  const entries = optionItems.length
    ? optionItems.map((item) => {
      const label = cleanText(item?.label || item?.presetId, 180);
      const quantity = Math.max(1, Number(item?.quantity) || 1);
      return label ? `${quantity} × ${label}` : "";
    }).filter(Boolean)
    : (Array.isArray(request?.workLines) ? request.workLines : []).map((line) => {
      const label = cleanText(line?.label || line?.presetLabel || line?.presetId, 180);
      const quantity = Math.max(1, Number(line?.quantity) || 1);
      return label ? `${quantity} × ${label}` : "";
    }).filter(Boolean);
  return entries.length ? `Scheduled work: ${entries.join("; ")}.` : "";
}

function workOrderCustomerDescription(option, request, fallback) {
  const explicit = requestCustomerFacingDescription(request);
  const automatic = cleanText(automaticCustomerFacingDescription(option, request), 1500);
  return {
    customerFacingDescription: explicit || cleanText(fallback, 1500),
    customerFacingDescriptionIsDefault: Boolean(explicit && automatic && explicit === automatic),
  };
}

function temporaryHoldProjection(context, appointment) {
  return context?.appointmentState === "temporary_hold" || cleanText(appointment?.status, 40) === "temporary_hold";
}

function backdatedProjection(context, appointment) {
  return (context?.bookingMode === "backdated" && context?.backdatingAcknowledged === true)
    || appointment?.backdated === true
    || appointment?.bookingMode === "backdated";
}

function buildWorkOrders({ appointment, option, request, customer, property, actor = {}, context = {}, now = new Date() }) {
  // Lifecycle changes update Scheduling-owned fields on existing Work Orders. They
  // must not replace communication policy, payment state, or creation audit fields.
  // Newly created support Work Orders still receive their normal initialization.
  const lifecycleRebuild = context.reschedule === true || context.detailsEdit === true;
  const temporaryHold = temporaryHoldProjection(context, appointment);
  const backdated = backdatedProjection(context, appointment);
  const existingWorkOrderIds = new Set([
    ...(Array.isArray(appointment?.workOrderIds) ? appointment.workOrderIds : []),
    cleanText(appointment?.workOrderId, 180),
  ].filter(Boolean));
  const notificationRecipients = lifecycleRebuild || backdated ? [] : normalizedRecipientSnapshots(context, customer);
  const whatsappEnabled = notificationRecipients.some((recipient) =>
    (recipient.sendConfirmation === true || recipient.sendReminder === true)
    && cleanText(recipient.whatsapp || recipient.phone, 80));
  const supportCount = Math.max(0, option.assignments.length - 1);
  const technicianInstructions = requestTechnicianInstructions(request);

  return option.assignments.map((assignment, index) => {
    const id = `WO-${appointment.appointmentId}-${index + 1}`;
    const isPrimary = index === 0;
    const alreadyExists = existingWorkOrderIds.has(id);
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
    const customerDescription = workOrderCustomerDescription(option, request, problem);
    const appointmentEndTime = cleanText(assignment.endTime || option.endTime, 20);
    const appointmentCapacityEndTime = cleanText(
      assignment.capacityEndTime
        || (isPrimary ? option.capacityEndTime : "")
        || appointmentEndTime,
      20,
    );
    const preserveExistingDomainState = lifecycleRebuild && alreadyExists;
    const communicationSnapshot = preserveExistingDomainState
      ? {}
      : temporaryHold
        ? {
          whatsappNotificationsEnabled: false,
          notificationRecipients: [],
        }
        : backdated
          ? {
            whatsappNotificationsEnabled: false,
            notificationRecipients: [],
          }
        : {
          whatsappNotificationsEnabled: isPrimary && whatsappEnabled,
          notificationRecipients: isPrimary ? notificationRecipients : [],
        };
    const initializationSnapshot = preserveExistingDomainState
      ? {}
      : {
        amount: 0,
        paid: 0,
        ...(temporaryHold ? { heldAt: now.toISOString() } : { confirmedAt: now.toISOString() }),
        createdAt: now.toISOString(),
        createdBy: "booking-authority",
      };

    return {
      id,
      appointmentId: appointment.appointmentId,
      clientId: customer.id,
      propertyId: property.id,
      serviceId,
      date: option.date,
      time: assignment.time || option.time,
      status: temporaryHold ? "Reserva temporal" : "Confirmada",
      technicianIds: assignment.technicianIds || [],
      vanId: assignment.vanId,
      address: option.address || property.address || property.addressRaw || "",
      zone: option.zone || property.operationalZone || property.zone || "",
      problem: isPrimary ? `${problem}.` : `Apoyo a la cita principal: ${problem}.`,
      customerFacingDescription: customerDescription.customerFacingDescription,
      customerFacingDescriptionIsDefault: customerDescription.customerFacingDescriptionIsDefault,
      technicianInstructions,
      officeNotes: temporaryHold
        ? (isPrimary
          ? `Reserva temporal creada por DEMAC Booking Authority${supportCount ? ` con ${supportCount} van(es) de apoyo` : ""}. No enviar comunicación al cliente hasta confirmar.`
          : "Asignación interna de apoyo reservada temporalmente. No enviar comunicación al cliente.")
        : backdated
          ? (isPrimary
            ? `Trabajo ya realizado registrado retrospectivamente por DEMAC Booking Authority${supportCount ? ` con ${supportCount} van(es) de apoyo` : ""}. No enviar confirmación ni recordatorio automático.`
            : "Asignación retrospectiva interna de van de apoyo. No enviar notificaciones automáticas.")
          : isPrimary
            ? `Cita creada por DEMAC Booking Authority${supportCount ? ` con ${supportCount} van(es) de apoyo` : ""}.`
            : "Asignación interna de van de apoyo. No enviar confirmación ni recordatorio duplicado.",
      appointmentWorkType: workType,
      appointmentPresetId: workType,
      appointmentWorkLabel: workLabel,
      appointmentDurationMinutes: durationMinutes,
      appointmentDurationMode: durationMode,
      appointmentEndTime,
      appointmentCapacityEndTime,
      serviceDefinitionVersion: singleItem?.serviceDefinitionVersion || 0,
      appointmentWorkItems: workItems,
      appointmentAssignmentRole: isPrimary ? "primary" : "support",
      parentWorkOrderId: isPrimary ? undefined : `WO-${appointment.appointmentId}-1`,
      fullDaySingleProperty: assignment.fullDay === true,
      schedulingMode: durationMode === "per_unit" ? "perUnit" : "fixed",
      airConditionerCount: assignment.quantity,
      scheduledSlots: assignment.slots,
      ...(backdated
        ? {
          bookingMode: "backdated",
          backdated: true,
          backdatingAcknowledged: true,
          workAlreadyPerformed: true,
          backdatedRecordedAtIso: now.toISOString(),
          backdatedRecordedBy: cleanText(actor.id || actor.userId, 160),
          backdatedRecordedByName: cleanText(actor.name || actor.displayName, 160),
        }
        : {}),
      ...communicationSnapshot,
      ...initializationSnapshot,
      updatedAt: now.toISOString(),
    };
  });
}

module.exports = {
  automaticCustomerFacingDescription,
  backdatedProjection,
  buildWorkOrders,
  notificationRecipient,
  normalizedRecipientSnapshots,
  requestCustomerFacingDescription,
  requestTechnicianInstructions,
  temporaryHoldProjection,
  workItemsForAssignment,
  workOrderCustomerDescription,
};
