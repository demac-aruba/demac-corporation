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
  const raw = String(value || "");
  const compact = normalizeText(raw).replace(/\s+/g, " ");
  const explicit = compact.match(/\b(9|12|18|24|36)\s*(?:k|mil)\b/);
  if (explicit) return Number(explicit[1]) * 1000;
  const full = compact.match(/\b(9[.,]?000|12[.,]?000|18[.,]?000|24[.,]?000|36[.,]?000)\s*(?:btu)?\b/);
  if (full) return Number(full[1].replace(/[.,]/g, ""));
  const withBtu = compact.match(/\b(9000|12000|18000|24000|36000)\s*btu\b/);
  return withBtu ? Number(withBtu[1]) : 0;
}

function contextText(conversation, latestText) {
  return [
    ...(conversation?.messages || []).filter((item) => item?.direction === "inbound").map((item) => item.text),
    latestText,
  ].filter(Boolean).join(" \n ");
}

function detectServiceRuleKind(text, facts = {}) {
  const normalized = normalizeText(`${text} ${facts.serviceType || ""}`);
  if (/\b(deep cleaning|deep clean|limpieza profunda|servicio profundo)\b/.test(normalized)) return "deep_cleaning";
  if (/\b(instalacion|instalación|installation|instalar|instala)\b/.test(normalized)) return "standard_installation";
  if (/\b(servicio|service|mantenimiento|cleaning)\b/.test(normalized)) return "standard_service";
  if (normalizeText(facts.serviceType) === "installation") return "standard_installation";
  return "standard_service";
}

function findRow(rows, btu) {
  return (rows || []).find((row) => Number(row.btu) === Number(btu)) || null;
}

function resolvePricingContext({ pricingRules, conversation, latestText, facts = {} }) {
  const rules = normalizeServicePricingRules(pricingRules);
  const text = contextText(conversation, latestText);
  const btu = extractBtu(text);
  const kind = detectServiceRuleKind(text, facts);
  const normalized = normalizeText(text);
  const mentionsSplit = /\b(split|split unit|mini split)\b/.test(normalized);
  const mentionsAdina = /\badina\b/.test(normalized);
  const purchasedFromDemac = /\b(comprad[oa] con (?:ustedes|demac)|compr[ée] con (?:ustedes|demac)|bought (?:it )?from (?:you|demac)|compra cu boso|cumpra cu boso)\b/.test(normalized);

  let row = null;
  if (kind === "deep_cleaning") row = findRow(rules.deepCleaningSplit, btu);
  else if (kind === "standard_installation") row = findRow(rules.standardInstallationAdinaDemac, btu);
  else row = findRow(rules.standardServiceSplit, btu);

  return {
    rules,
    kind,
    btu,
    row,
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

function formatPriceReply(context, language = "es") {
  const { kind, btu, row } = context;
  if (!row || !btu) return "";
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

function formatDurationReply(context, language = "es", quantity = 0) {
  const { kind, btu, row } = context;
  let minutes = Number(row?.durationMinutes || 0);
  if (!minutes && kind === "standard_service") minutes = 60;
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
  formatPriceReply,
  normalizeServicePricingRules,
  resolvePricingContext,
};
