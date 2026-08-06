const { FieldValue } = require("firebase-admin/firestore");
const {
  MAX_SEARCH_DAYS,
  MAX_VANS,
  addDays,
  arubaDateParts,
  cleanText,
  hashId,
  isHalfDay,
  normalizePhone,
  normalizeRouteConfig,
  normalizeText,
  normalizeTime,
  occupiedSlots,
  orderBlocksCapacity,
  orderSlotCount,
  propertyZone,
  resolveAssignment,
  resolveCustomer,
  snapshotItems,
} = require("./whatsappCopilotSchedulingCore");
const {
  candidateAvailability,
  formatAvailabilityReply,
  formatConfirmationReply,
  generateOptions,
  normalizeOrderTime,
} = require("./whatsappCopilotAvailability");

function conversationKey(request) {
  return request.contactPhone
    || request.contactJid
    || normalizeText(request.chatTitle)
    || hashId(request.latestCustomerTurn, 20);
}

async function saveOffer(db, request, analysis, result) {
  const key = conversationKey(request);
  const id = `wa-offer-${hashId(key, 32)}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 48 * 60 * 60 * 1_000).toISOString();
  await db.collection("whatsappCopilotOffers").doc(id).set({
    id,
    conversationKey: key,
    chatTitle: request.chatTitle,
    contactPhone: request.contactPhone || "",
    language: analysis.language,
    status: "open",
    request: {
      intent: analysis.intent,
      serviceType: analysis.collectedInformation.serviceType,
      quantity: result.quantity,
      address: analysis.collectedInformation.address,
      presetId: result.preset.id,
      presetLabel: result.preset.label,
      durationMinutesPerUnit: result.preset.durationMinutesPerUnit,
    },
    options: result.options,
    createdAt: FieldValue.serverTimestamp(),
    createdAtIso: now.toISOString(),
    expiresAt,
  }, { merge: true });
  return { id, key, expiresAt };
}

async function getOpenOffer(db, request) {
  const key = conversationKey(request);
  const id = `wa-offer-${hashId(key, 32)}`;
  const snapshot = await db.collection("whatsappCopilotOffers").doc(id).get();
  if (!snapshot.exists) return null;
  const offer = { id: snapshot.id, ...snapshot.data() };
  if (offer.status !== "open" || !Array.isArray(offer.options)) return null;
  if (offer.expiresAt && offer.expiresAt < new Date().toISOString()) return null;
  return offer;
}

function selectedOfferOption(analysis, offer) {
  if (!offer?.options?.length) return null;
  const ordinal = Number(analysis.selectedOptionOrdinal ?? 0);
  if (ordinal >= 1 && ordinal <= offer.options.length) return offer.options[ordinal - 1];
  const requestedDate = cleanText(analysis.collectedInformation?.requestedDate || analysis.collectedInformation?.preferredDate, 20);
  const requestedTime = normalizeTime(analysis.collectedInformation?.requestedTime || analysis.collectedInformation?.preferredTime);
  const matches = offer.options.filter((option) =>
    (!requestedDate || option.date === requestedDate)
    && (!requestedTime || option.time === requestedTime),
  );
  return matches.length === 1 ? matches[0] : null;
}

async function loadSchedulingData(db, startDate, endDate) {
  const workOrderQuery = db.collection("workOrders").where("date", ">=", startDate).where("date", "<=", endDate);
  const [
    workOrderSnapshot,
    serviceSnapshot,
    propertySnapshot,
    clientSnapshot,
    vanSnapshot,
    staffSnapshot,
    assignmentSnapshot,
    absenceSnapshot,
    closureSnapshot,
    businessSnapshot,
    halfDaySnapshot,
  ] = await Promise.all([
    workOrderQuery.get(),
    db.collection("services").get(),
    db.collection("properties").get(),
    db.collection("clients").get(),
    db.collection("vans").get(),
    db.collection("staffProfiles").get(),
    db.collection("dailyVanAssignments").get(),
    db.collection("staffAbsences").get(),
    db.collection("calendarClosures").get(),
    db.collection("businessSettings").get(),
    db.collection("vanHalfDaySchedules").get(),
  ]);
  return {
    workOrders: snapshotItems(workOrderSnapshot),
    services: snapshotItems(serviceSnapshot),
    properties: snapshotItems(propertySnapshot),
    clients: snapshotItems(clientSnapshot),
    vans: snapshotItems(vanSnapshot).filter((van) => van.active !== false).slice(0, MAX_VANS),
    staffProfiles: snapshotItems(staffSnapshot),
    dailyVanAssignments: snapshotItems(assignmentSnapshot),
    staffAbsences: snapshotItems(absenceSnapshot),
    calendarClosures: snapshotItems(closureSnapshot),
    businessSettings: snapshotItems(businessSnapshot),
    vanHalfDaySchedules: snapshotItems(halfDaySnapshot),
  };
}

function routeConfigFromSettings(settings) {
  const saved = settings.find((item) => item.id === "whatsapp-copilot-routing");
  return normalizeRouteConfig(saved);
}

function customerLanguage(language) {
  if (language === "pap-aw") return "Papiamento";
  if (language === "en") return "English";
  return "Español";
}

async function ensureCustomerAndProperty(transaction, db, { customer, request, analysis, option }) {
  if (customer.client && customer.property) return { client: customer.client, property: customer.property, created: false };
  const phone = normalizePhone(request.contactPhone || customer.phone);
  if (!phone) {
    throw new Error("No se pudo identificar el número de WhatsApp para crear o enlazar el cliente en el ERP.");
  }
  const clientId = customer.client?.id ?? `client-wa-${hashId(phone, 24)}`;
  const propertyId = customer.property?.id ?? `property-wa-${hashId(`${clientId}|${normalizeText(option.address)}`, 24)}`;
  const clientRef = db.collection("clients").doc(clientId);
  const propertyRef = db.collection("properties").doc(propertyId);
  const [clientSnapshot, propertySnapshot] = await Promise.all([transaction.get(clientRef), transaction.get(propertyRef)]);
  const now = new Date().toISOString();
  const client = clientSnapshot.exists ? { id: clientSnapshot.id, ...clientSnapshot.data() } : {
    id: clientId,
    name: `Cliente WhatsApp ${phone.slice(-4)}`,
    phone: `+${phone}`,
    phoneCountry: "AW",
    whatsapp: `+${phone}`,
    whatsappCountry: "AW",
    preferredLanguage: customerLanguage(analysis.language),
    address: option.address,
    zone: option.zone || "",
    balance: 0,
    equipmentCount: 0,
    active: true,
    source: "WhatsApp AI Copilot",
    createdAt: now,
    updatedAt: now,
  };
  const property = propertySnapshot.exists ? { id: propertySnapshot.id, ...propertySnapshot.data() } : {
    id: propertyId,
    clientId,
    name: "Propiedad principal",
    type: "Otro",
    address: option.address,
    addressRaw: option.address,
    addressNormalized: normalizeText(option.address),
    neighborhood: option.zone || "",
    operationalZone: option.zone || "",
    zone: option.zone || "",
    active: true,
    source: "WhatsApp AI Copilot",
    createdAt: now,
    updatedAt: now,
  };
  if (!clientSnapshot.exists) transaction.set(clientRef, client);
  if (!propertySnapshot.exists) transaction.set(propertyRef, property);
  return { client, property, created: !clientSnapshot.exists || !propertySnapshot.exists };
}

function notificationRecipient(client) {
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
    templateLanguage: client.templateLanguage,
    sendConfirmation: true,
    sendReminder: true,
  };
}

function workOrderBase({ id, option, assignment, allocation, client, property, analysis, primaryId, isPrimary, supportCount }) {
  const now = new Date().toISOString();
  const workItem = {
    id: option.presetId,
    presetId: option.presetId,
    label: option.presetLabel,
    kind: option.presetId.includes("installation") ? "installation" : "service",
    quantity: allocation.quantity,
    durationMinutesPerUnit: option.durationMinutesPerUnit,
  };
  const equipmentLabel = allocation.quantity === 1 ? "1 aire acondicionado" : `${allocation.quantity} aires acondicionados`;
  const problem = workItem.kind === "installation"
    ? `${option.presetLabel} de ${equipmentLabel}.`
    : `${option.presetLabel} para ${equipmentLabel}.`;
  return {
    id,
    clientId: client.id,
    propertyId: property.id,
    serviceId: option.serviceId,
    date: option.date,
    time: option.time,
    status: "Confirmada",
    technicianIds: assignment.technicianIds,
    vanId: assignment.vanId,
    address: option.address,
    zone: option.zone || property.operationalZone || property.zone || "",
    problem: isPrimary ? problem : `Apoyo a la cita principal: ${problem}`,
    officeNotes: isPrimary
      ? `Cita coordinada por WhatsApp AI Copilot${supportCount ? ` con ${supportCount} van(es) de apoyo` : ""}.`
      : "Asignación interna de van de apoyo. No enviar confirmación ni recordatorio duplicado.",
    appointmentWorkType: option.presetId,
    appointmentPresetId: option.presetId,
    appointmentWorkLabel: option.presetLabel,
    appointmentDurationMinutes: allocation.quantity * option.durationMinutesPerUnit,
    appointmentWorkItems: [workItem],
    appointmentAssignmentRole: isPrimary ? "primary" : "support",
    parentWorkOrderId: isPrimary ? undefined : primaryId,
    fullDaySingleProperty: allocation.fullDay === true,
    amount: 0,
    paid: 0,
    schedulingMode: "perUnit",
    airConditionerCount: allocation.quantity,
    scheduledSlots: allocation.slots,
    whatsappNotificationsEnabled: isPrimary,
    notificationRecipients: isPrimary ? [notificationRecipient(client)] : [],
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
    createdBy: "whatsapp-ai-copilot",
    aiConversationLanguage: analysis.language,
  };
}

async function reserveOption({ db, request, analysis, offer, option }) {
  const nowInAruba = arubaDateParts();
  const today = nowInAruba.date;
  if (option.date < today || (option.date === today && option.time <= nowInAruba.time)) {
    throw new Error("El horario seleccionado ya pasó. Debe generarse una nueva disponibilidad.");
  }
  const data = await loadSchedulingData(db, today, addDays(today, MAX_SEARCH_DAYS));
  const latestCustomer = resolveCustomer({
    clients: data.clients,
    properties: data.properties,
    contactPhone: request.contactPhone,
    chatTitle: request.chatTitle,
    address: option.address,
  });
  const routeConfig = routeConfigFromSettings(data.businessSettings);
  const candidateZone = propertyZone(latestCustomer.property, option.address, routeConfig);

  const refreshedAssignments = [];
  for (const requested of option.assignments) {
    const van = data.vans.find((item) => item.id === requested.vanId);
    if (!van) throw new Error("Una de las vans ofrecidas ya no está disponible en el ERP.");
    const assignment = resolveAssignment(van, option.date, data.staffProfiles, data.dailyVanAssignments, data.staffAbsences);
    const availability = candidateAvailability({
      date: option.date,
      time: option.time,
      allocation: { quantity: requested.quantity, slots: requested.slots, fullDay: requested.fullDay },
      van,
      assignment,
      data,
      routeConfig,
      candidateZone,
    });
    if (!availability) throw new Error("El horario seleccionado cambió mientras el cliente respondía. Debe generarse una nueva disponibilidad.");
    refreshedAssignments.push(availability);
  }

  const primaryId = `WO-WA-${option.date.replaceAll("-", "")}-${hashId(`${offer.id}|${option.id}`, 8).toUpperCase()}`;
  const createdIds = [];
  await db.runTransaction(async (transaction) => {
    const existingRef = db.collection("workOrders").doc(primaryId);
    const existing = await transaction.get(existingRef);
    if (existing.exists) {
      createdIds.push(primaryId);
      return;
    }

    const sameDayQuery = db.collection("workOrders").where("date", "==", option.date);
    const sameDaySnapshot = await transaction.get(sameDayQuery);
    const sameDayOrders = snapshotItems(sameDaySnapshot).filter(orderBlocksCapacity);
    for (const assignment of refreshedAssignments) {
      const halfDay = isHalfDay(assignment.vanId, option.date, data.vanHalfDaySchedules);
      const requestedSlots = occupiedSlots(option.time, assignment.slots, halfDay);
      const conflict = sameDayOrders.some((order) => {
        if (order.vanId !== assignment.vanId) return false;
        const existingSlots = occupiedSlots(normalizeOrderTime(order.time), orderSlotCount(order, data.services), halfDay);
        return existingSlots.some((slot) => requestedSlots.includes(slot));
      });
      if (conflict) throw new Error("El horario seleccionado acaba de ser ocupado. Debe ofrecerse la siguiente opción disponible.");
    }

    const ensured = await ensureCustomerAndProperty(transaction, db, {
      customer: latestCustomer,
      request,
      analysis,
      option,
    });
    const supportCount = Math.max(0, refreshedAssignments.length - 1);
    refreshedAssignments.forEach((assignment, index) => {
      const id = index === 0 ? primaryId : `${primaryId}-SUP-${index}`;
      const workOrder = workOrderBase({
        id,
        option,
        assignment,
        allocation: assignment,
        client: ensured.client,
        property: ensured.property,
        analysis,
        primaryId,
        isPrimary: index === 0,
        supportCount,
      });
      transaction.set(db.collection("workOrders").doc(id), workOrder);
      createdIds.push(id);
    });
    transaction.set(db.collection("whatsappCopilotOffers").doc(offer.id), {
      status: "booked",
      selectedOptionId: option.id,
      primaryWorkOrderId: primaryId,
      workOrderIds: createdIds,
      bookedAt: FieldValue.serverTimestamp(),
      bookedAtIso: new Date().toISOString(),
    }, { merge: true });
  });
  return { primaryWorkOrderId: primaryId, workOrderIds: createdIds, option };
}

async function orchestrateScheduling({ db, request, analysis }) {
  const today = arubaDateParts().date;
  const offer = await getOpenOffer(db, request);
  const selected = selectedOfferOption(analysis, offer);
  if (offer && selected && analysis.customerConfirmedAppointment) {
    try {
      const booking = await reserveOption({ db, request, analysis, offer, option: selected });
      return {
        handled: true,
        action: "appointment_booked",
        reply: formatConfirmationReply(analysis.language, selected),
        booking,
        offer,
        metadata: {
          appointmentCreated: true,
          primaryWorkOrderId: booking.primaryWorkOrderId,
          workOrderIds: booking.workOrderIds,
          selectedOption: selected,
        },
      };
    } catch (error) {
      const data = await loadSchedulingData(db, today, addDays(today, MAX_SEARCH_DAYS));
      const routeConfig = routeConfigFromSettings(data.businessSettings);
      const result = generateOptions({ analysis, request, data, routeConfig, today });
      const newOffer = result.options.length ? await saveOffer(db, request, analysis, result) : null;
      return {
        handled: true,
        action: "appointment_changed_reoffer",
        reply: formatAvailabilityReply(analysis.language, result),
        offer: newOffer,
        result,
        warning: error.message,
        metadata: { appointmentCreated: false, availabilityOptions: result.options, reofferedBecause: error.message },
      };
    }
  }

  const data = await loadSchedulingData(db, today, addDays(today, MAX_SEARCH_DAYS));
  const routeConfig = routeConfigFromSettings(data.businessSettings);
  const result = generateOptions({ analysis, request, data, routeConfig, today });
  const savedOffer = result.options.length ? await saveOffer(db, request, analysis, result) : null;
  return {
    handled: true,
    action: result.options.length ? "availability_offered" : "availability_unavailable",
    reply: formatAvailabilityReply(analysis.language, result),
    result,
    offer: savedOffer,
    metadata: {
      appointmentCreated: false,
      availabilityOptions: result.options,
      requestedDate: result.requestedDate || "",
      requestedDateUnavailable: result.requestedDateUnavailable,
      routeZone: result.candidateZone?.label || "",
      vansRequired: result.allocations.length,
      customerMatched: Boolean(result.customer?.client),
      propertyMatched: Boolean(result.customer?.property),
    },
  };
}

module.exports = { orchestrateScheduling };
