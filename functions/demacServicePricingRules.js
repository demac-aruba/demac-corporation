const { cleanText, normalizeText } = require("./whatsappCopilotSchedulingCore");

const DEFAULT_SERVICE_PRICING_RULES = Object.freeze({
  id: "company-service-pricing-rules",
  version: 1,
  currency: "Afl.",
  standardServiceSplit: [
    { btu: 9000, price: 100, durationMinutes: 60, priceType: "special" },
    { btu: 12000, price: 125, durationMinutes: 60, priceType: "special" },
    { btu: 18000, price: 135, durationMinutes: 60, priceType: "special" },
    { btu: 24000, price: 145, durationMinutes: 60, priceType: "special" },
    { btu: 36000, price: 175, durationMinutes: 60, priceType: "regular" },
  ],
  deepCleaningSplit: [
    { btu: 9000, price: 195, durationMinutes: 120 },
    { btu: 12000, price: 195, durationMinutes: 120 },
    { btu: 18000, price: 195, durationMinutes: 120 },
    { btu: 24000, price: 195, durationMinutes: 120 },
    { btu: 36000, price: 225, durationMinutes: 120 },
  ],
  standardInstallationAdinaDemac: [
    { btu: 12000, price: 200, durationMinutes: 120, priceType: "special" },
    { btu: 18000, price: 225, durationMinutes: 120, priceType: "special" },
    { btu: 24000, price: 250, durationMinutes: 120, priceType: "special" },
    { btu: 36000, price: 300, durationMinutes: 180, priceType: "special" },
  ],
});

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeRows(rawRows, fallbackRows) {
  const byBtu = new Map((Array.isArray(rawRows) ? rawRows : []).map((row) => [Number(row?.btu), row]));
  return fallbackRows.map((fallback) => {
    const saved = byBtu.get(fallback.btu) || {};
    return {
      ...fallback,
      ...saved,
      btu: fallback.btu,
      price: positiveNumber(saved.price, fallback.price),
      durationMinutes: Math.max(30, positiveNumber(saved.durationMinutes, fallback.durationMinutes)),
      priceType: cleanText(saved.priceType, 30) || fallback.priceType || "regular",
    };
  });
}

function normalizeServicePricingRules(raw) {
  return {
    ...DEFAULT_SERVICE_PRICING_RULES,
    ...(raw || {}),
    id: "company-service-pricing-rules",
    standardServiceSplit: normalizeRows(raw?.standardServiceSplit, DEFAULT_SERVICE_PRICING_RULES.standardServiceSplit),
    deepCleaningSplit: normalizeRows(raw?.deepCleaningSplit, DEFAULT_SERVICE_PRICING_RULES.deepCleaningSplit),
    standardInstallationAdinaDemac: normalizeRows(raw?.standardInstallationAdinaDemac, DEFAULT_SERVICE_PRICING_RULES.standardInstallationAdinaDemac),
  };
}

function extractBtu(value) {
  const raw = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const short = raw.match(/\b(9|12|18|24|36)\s*(?:k|mil)\b/);
  if (short) return Number(short[1]) * 1000;

  const thousands = raw.match(/\b(9|12|18|24|36)\s*(?:[.,]\s*|\s+)000\s*(?:btu)?\b/);
  if (thousands) return Number(thousands[1]) * 1000;

  const compact = raw.match(/\b(9000|12000|18000|24000|36000)\s*(?:btu)?\b/);
  return compact ? Number(compact[1]) : 0;
}

function inboundHistory(conversation) {
  return (conversation?.messages || [])
    .filter((item) => item?.direction === "inbound" && item?.text)
    .map((item) => String(item.text));
}

function contextText(conversation, latestText) {
  return [...inboundHistory(conversation), latestText].filter(Boolean).join(" \n ");
}

function mostRecentHistoricalBtu(conversation, latestText) {
  const latestNormalized = normalizeText(latestText);
  for (const text of [...inboundHistory(conversation)].reverse()) {
    if (latestNormalized && normalizeText(text) === latestNormalized) continue;
    const btu = extractBtu(text);
    if (btu) return btu;
  }
  return 0;
}

function priceQuestionMode(value) {
  const text = normalizeText(value);
  if (!text) return "single";
  if (/\b(mismo precio|mismos precios|igual precio|igual cuestan|varia el precio|varian los precios|precio varia|precio cambia|dependen de los btu|same price|same prices|price vary|prices vary|different price|different prices|mesun prijs|prijs ta varia|prijsnan ta varia)\b/.test(text)) {
    return "comparison";
  }
  if (/\b(todos los aires|todos los btu|cada btu|todos los precios|lista de precios|precios por btu|cuanto cuesta cada|all btus|all sizes|each btu|price list|prices by btu|tur airco|tur btu|prijsnan)\b/.test(text)) {
    return "matrix";
  }
  return "single";
}

function detectServiceRuleKind(text, facts = {}) {
  const normalized = normalizeText(`${text} ${facts.serviceType || ""}`);
  if (/\b(deep cleaning|deep clean|limpieza profunda|servicio profundo)\b/.test(normalized)) return "deep_cleaning";
  if (/\b(instalacion|installation|instalar|instala)\b/.test(normalized)) return "standard_installation";
  if (/\b(servicio|service|mantenimiento|cleaning)\b/.test(normalized)) return "standard_service";
  if (normalizeText(facts.serviceType) === "installation") return "standard_installation";
  return "standard_service";
}

function rowsForKind(rules, kind) {
  if (kind === "deep_cleaning") return rules.deepCleaningSplit;
  if (kind === "standard_installation") return rules.standardInstallationAdinaDemac;
  return rules.standardServiceSplit;
}

function findRow(rows, btu) {
  return (rows || []).find((row) => Number(row.btu) === Number(btu)) || null;
}

function resolvePricingContext({ pricingRules, conversation, latestText, facts = {} }) {
  const rules = normalizeServicePricingRules(pricingRules);
  const fullText = contextText(conversation, latestText);
  const questionMode = priceQuestionMode(latestText);
  const latestBtu = extractBtu(latestText);
  const historicalBtu = mostRecentHistoricalBtu(conversation, latestText);
  // The current turn is authoritative. A comparison/list question must never inherit
  // an old BTU from history, which previously caused repeated single-price replies.
  const btu = latestBtu || (questionMode === "single" ? historicalBtu : 0);
  const kind = detectServiceRuleKind(fullText, facts);
  const normalized = normalizeText(fullText);
  const mentionsSplit = /\b(split|split unit|mini split)\b/.test(normalized);
  const mentionsAdina = /\badina\b/.test(normalized);
  const purchasedFromDemac = /\b(comprad[oa] con (?:ustedes|demac)|compre con (?:ustedes|demac)|bought (?:it )?from (?:you|demac)|compra cu boso|cumpra cu boso)\b/.test(normalized);
  const rows = rowsForKind(rules, kind);
  const row = findRow(rows, btu);

  return {
    rules,
    kind,
    btu,
    latestBtu,
    historicalBtu,
    row,
    rows,
    questionMode,
    mentionsSplit,
    mentionsAdina,
    purchasedFromDemac,
  };
}

function btuLabel(btu) {
  return Number(btu || 0).toLocaleString("en-US");
}

function priceTypeLabel(type, language) {
  if (type !== "special") return "";
  if (language === "en") return " special price";
  if (language === "pap-aw") return " prijs special";
  return " precio especial";
}

function compactPriceRows(rows) {
  return (rows || []).map((row) => `${btuLabel(row.btu)} BTU — Afl. ${Number(row.price).toFixed(0)}`).join("; ");
}

function formatPriceMatrix(context, language = "es") {
  const { kind, rows, questionMode } = context;
  if (!rows?.length) return "";
  const list = compactPriceRows(rows);
  const comparison = questionMode === "comparison";

  if (language === "en") {
    if (kind === "deep_cleaning") return `${comparison ? "No. " : ""}Deep-cleaning pricing depends on the unit size: ${list}.`;
    if (kind === "standard_installation") return `${comparison ? "No. " : ""}For Adina units purchased from DEMAC, standard-installation pricing depends on BTU: ${list}.`;
    return `${comparison ? "No. " : ""}Standard-service pricing varies by the split unit's BTU: ${list}.`;
  }
  if (language === "pap-aw") {
    if (kind === "deep_cleaning") return `${comparison ? "No. " : ""}E prijs di deep cleaning ta varia segun e capacidad di e airco: ${list}.`;
    if (kind === "standard_installation") return `${comparison ? "No. " : ""}Pa airco Adina cumpra cu DEMAC, e prijs di instalacion standard ta varia segun BTU: ${list}.`;
    return `${comparison ? "No. " : ""}E prijs di servicio standard ta varia segun e BTU di e split unit: ${list}.`;
  }
  if (kind === "deep_cleaning") return `${comparison ? "No. " : ""}El precio del deep cleaning varía según la capacidad del aire: ${list}.`;
  if (kind === "standard_installation") return `${comparison ? "No. " : ""}Para equipos Adina comprados con DEMAC, el precio de la instalación estándar varía según los BTU: ${list}.`;
  return `${comparison ? "No. " : ""}El precio del servicio estándar varía según los BTU del split: ${list}.`;
}

function formatPriceReply(context, language = "es") {
  const { kind, btu, row, questionMode } = context;
  if (questionMode !== "single" || !row || !btu) return formatPriceMatrix(context, language);

  const amount = Number(row.price).toFixed(0);
  const capacity = btuLabel(btu);
  if (language === "en") {
    if (kind === "deep_cleaning") return `For a split unit of ${capacity} BTU, deep cleaning costs Afl. ${amount}.`;
    if (kind === "standard_installation") return `If it is an Adina unit purchased from us, the special price for a standard ${capacity} BTU installation is Afl. ${amount}.`;
    return `For a ${capacity} BTU split unit, standard service is Afl. ${amount}${priceTypeLabel(row.priceType, language)}.`;
  }
  if (language === "pap-aw") {
    if (kind === "deep_cleaning") return `Pa un split unit di ${capacity} BTU, deep cleaning ta costa Afl. ${amount}.`;
    if (kind === "standard_installation") return `Si ta un airco Adina cumpra cu nos, e prijs special pa un instalacion standard di ${capacity} BTU ta Afl. ${amount}.`;
    return `Pa un split unit di ${capacity} BTU, servicio standard ta Afl. ${amount}${priceTypeLabel(row.priceType, language)}.`;
  }
  if (kind === "deep_cleaning") return `Para un split unit de ${capacity} BTU, el deep cleaning cuesta Afl. ${amount}.`;
  if (kind === "standard_installation") return `Si es un equipo Adina comprado con nosotros, el precio especial de una instalación estándar de ${capacity} BTU es Afl. ${amount}.`;
  return `Para un split unit de ${capacity} BTU, el servicio estándar cuesta Afl. ${amount}${row.priceType === "special" ? " como precio especial" : ""}.`;
}

function compactDurationRows(rows) {
  return (rows || []).map((row) => {
    const hours = Number(row.durationMinutes || 0) / 60;
    const display = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".0", "");
    return `${btuLabel(row.btu)} BTU — ${display} h`;
  }).join("; ");
}

function formatDurationReply(context, language = "es", quantity = 0) {
  const { kind, btu, row, rows } = context;
  let minutes = Number(row?.durationMinutes || 0);
  if (!minutes && kind === "standard_service") minutes = Number(rows?.[0]?.durationMinutes || 60);
  if (!minutes && kind === "deep_cleaning") minutes = Number(rows?.[0]?.durationMinutes || 120);

  if (!minutes && kind === "standard_installation" && rows?.length) {
    const list = compactDurationRows(rows);
    if (language === "en") return `Standard-installation duration depends on BTU: ${list}.`;
    if (language === "pap-aw") return `Duracion di instalacion standard ta depende di BTU: ${list}.`;
    return `La duración de la instalación estándar depende de los BTU: ${list}.`;
  }
  if (!minutes) return "";

  const hours = minutes / 60;
  const display = Number.isInteger(hours) ? String(hours) : hours.toFixed(1).replace(".0", "");
  const plural = hours === 1 ? "" : "s";
  if (language === "en") {
    if (kind === "standard_service") return `A standard service takes approximately ${display} hour${plural} per AC unit.`;
    if (kind === "standard_installation" && btu) return `A standard installation for a ${btuLabel(btu)} BTU unit takes approximately ${display} hour${plural}.`;
    if (kind === "deep_cleaning") return `A deep cleaning takes approximately ${display} hour${plural} per AC unit.`;
  }
  if (language === "pap-aw") {
    if (kind === "standard_service") return `Un servicio standard ta dura aproximadamente ${display} ora pa cada airco.`;
    if (kind === "standard_installation" && btu) return `Un instalacion standard pa un airco di ${btuLabel(btu)} BTU ta dura aproximadamente ${display} ora.`;
    if (kind === "deep_cleaning") return `Un deep cleaning ta dura aproximadamente ${display} ora pa cada airco.`;
  }
  if (kind === "standard_service") return `Un servicio estándar dura aproximadamente ${display} hora${plural} por aire.`;
  if (kind === "standard_installation" && btu) return `Una instalación estándar de ${btuLabel(btu)} BTU dura aproximadamente ${display} hora${plural}.`;
  if (kind === "deep_cleaning") return `Un deep cleaning dura aproximadamente ${display} hora${plural} por aire.`;
  return "";
}

module.exports = {
  DEFAULT_SERVICE_PRICING_RULES,
  detectServiceRuleKind,
  extractBtu,
  formatDurationReply,
  formatPriceMatrix,
  formatPriceReply,
  normalizeServicePricingRules,
  priceQuestionMode,
  resolvePricingContext,
  rowsForKind,
};