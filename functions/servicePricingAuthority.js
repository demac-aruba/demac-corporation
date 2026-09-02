'use strict';

const PRICING_RULE_KINDS = new Set(['standard_service', 'deep_cleaning', 'standard_installation']);
const MATRIX_BOOKING_CODE_PATTERNS = Object.freeze({
  standard_service: /^(?:standard_service|(?:9k|12k|18k|24k|36k)_standard(?:_service)?)$/,
  deep_cleaning: /^(?:deep_cleaning|(?:9k|12k|18k|24k|36k)_deep_cleaning)$/,
  standard_installation: /^(?:standard_installation|(?:12k|18k|24k|36k)_standard_installation)$/,
});

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function normalizedCode(value) {
  return text(value, 160)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function pricingRowsForKind(settings, kind) {
  if (kind === 'deep_cleaning') return Array.isArray(settings?.deepCleaningSplit) ? settings.deepCleaningSplit : [];
  if (kind === 'standard_installation') return Array.isArray(settings?.standardInstallationAdinaDemac) ? settings.standardInstallationAdinaDemac : [];
  return Array.isArray(settings?.standardServiceSplit) ? settings.standardServiceSplit : [];
}

function explicitPricingRuleKind(service = {}) {
  const candidates = [
    service.pricingRuleKind,
    service.pricingDefinition?.ruleKind,
    service.serviceDefinition?.pricingRuleKind,
  ];
  for (const candidate of candidates) {
    const normalized = normalizedCode(candidate);
    if (PRICING_RULE_KINDS.has(normalized)) return normalized;
  }
  return '';
}

function matrixPricingKind(service = {}) {
  const explicit = explicitPricingRuleKind(service);
  if (explicit) return explicit;
  const bookingCode = normalizedCode(service.serviceDefinition?.bookingCode || service.bookingCode);
  if (!bookingCode) return '';
  return Object.entries(MATRIX_BOOKING_CODE_PATTERNS)
    .find(([, pattern]) => pattern.test(bookingCode))?.[0] || '';
}

function canonicalBtu(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function canonicalMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : null;
}

function companyMatrixPrice({ service, pricingSettings, btu }) {
  const kind = matrixPricingKind(service);
  if (!kind) return null;
  if (!pricingSettings || typeof pricingSettings !== 'object' || Array.isArray(pricingSettings)) {
    const error = new Error('Company service pricing rules are required for this Field service.');
    error.code = 'service_pricing_not_configured';
    throw error;
  }
  const requestedBtu = canonicalBtu(btu);
  if (!requestedBtu) {
    const error = new Error('Exact A/C BTU is required before presenting this governed service price.');
    error.code = 'service_pricing_btu_required';
    throw error;
  }
  const rows = pricingRowsForKind(pricingSettings, kind)
    .map((row) => ({ btu: canonicalBtu(row?.btu), price: canonicalMoney(row?.price) }))
    .filter((row) => row.btu && row.price !== null);
  const matching = rows.filter((row) => row.btu === requestedBtu);
  if (matching.length !== 1) {
    const error = new Error('No unique approved Company Rules price exists for this service and BTU.');
    error.code = matching.length ? 'service_pricing_ambiguous' : 'service_pricing_not_found';
    throw error;
  }
  const version = Number.isSafeInteger(pricingSettings.version) && pricingSettings.version > 0
    ? pricingSettings.version
    : 1;
  return {
    currency: 'AWG',
    unitPrice: matching[0].price,
    sourceCatalogItemId: text(service.id, 180),
    pricingVersion: `company-service-pricing-rules:v${version}:${kind}:${requestedBtu}`,
  };
}

function tierMatches(tier, btu) {
  const minimum = canonicalBtu(tier?.minBtu);
  const maximum = canonicalBtu(tier?.maxBtu);
  if (minimum !== null && btu < minimum) return false;
  if (maximum !== null && btu > maximum) return false;
  return true;
}

function catalogPrice({ service, btu }) {
  const definition = service?.pricingDefinition && typeof service.pricingDefinition === 'object' && !Array.isArray(service.pricingDefinition)
    ? service.pricingDefinition
    : null;
  const mode = normalizedCode(definition?.mode || 'fixed');
  const currency = text(definition?.currency, 20).toUpperCase() || 'AWG';
  if (currency !== 'AWG') {
    const error = new Error('Field pricing currently requires the canonical AWG catalog currency.');
    error.code = 'service_pricing_currency_unsupported';
    throw error;
  }
  if (mode === 'quote') {
    const error = new Error('This service requires an office quote before customer approval.');
    error.code = 'service_pricing_quote_required';
    throw error;
  }
  let unitPrice = null;
  let pricingVersion = `service-catalog:${text(service?.id, 180)}:${mode || 'fixed'}`;
  if (mode === 'tiered_btu') {
    const requestedBtu = canonicalBtu(btu);
    if (!requestedBtu) {
      const error = new Error('Exact A/C BTU is required before presenting this tiered service price.');
      error.code = 'service_pricing_btu_required';
      throw error;
    }
    const tiers = Array.isArray(definition?.tiers) ? definition.tiers : [];
    const matching = tiers.filter((tier) => tierMatches(tier, requestedBtu));
    if (matching.length !== 1) {
      const error = new Error('No unique canonical catalog tier exists for this A/C BTU.');
      error.code = matching.length ? 'service_pricing_ambiguous' : 'service_pricing_not_found';
      throw error;
    }
    unitPrice = canonicalMoney(matching[0].amount);
    pricingVersion = `${pricingVersion}:${text(matching[0].id, 80) || requestedBtu}`;
  } else if (mode === 'fixed' || mode === 'per_unit') {
    if (!Object.prototype.hasOwnProperty.call(service || {}, 'basePrice')) {
      const error = new Error('The canonical catalog service has no configured base price.');
      error.code = 'service_pricing_not_configured';
      throw error;
    }
    unitPrice = canonicalMoney(service.basePrice);
  } else {
    const error = new Error(`Unsupported canonical service pricing mode: ${mode || 'missing'}.`);
    error.code = 'service_pricing_mode_unsupported';
    throw error;
  }
  if (unitPrice === null) {
    const error = new Error('The canonical catalog service price is invalid.');
    error.code = 'service_pricing_invalid';
    throw error;
  }
  return {
    currency: 'AWG',
    unitPrice,
    sourceCatalogItemId: text(service?.id, 180),
    pricingVersion,
  };
}

function resolveServicePriceSnapshot({ service, pricingSettings, btu, capturedAt } = {}) {
  if (!service || typeof service !== 'object' || Array.isArray(service) || !text(service.id, 180)) {
    const error = new Error('A canonical Service record is required for Field pricing.');
    error.code = 'service_pricing_service_required';
    throw error;
  }
  const timestamp = text(capturedAt, 80);
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    const error = new Error('A valid capture timestamp is required for Field pricing.');
    error.code = 'service_pricing_timestamp_required';
    throw error;
  }
  const matrix = companyMatrixPrice({ service, pricingSettings, btu });
  const resolved = matrix || catalogPrice({ service, btu });
  return { ...resolved, capturedAt: timestamp };
}

module.exports.MATRIX_BOOKING_CODE_PATTERNS = MATRIX_BOOKING_CODE_PATTERNS;
module.exports.PRICING_RULE_KINDS = PRICING_RULE_KINDS;
module.exports.canonicalBtu = canonicalBtu;
module.exports.catalogPrice = catalogPrice;
module.exports.companyMatrixPrice = companyMatrixPrice;
module.exports.explicitPricingRuleKind = explicitPricingRuleKind;
module.exports.matrixPricingKind = matrixPricingKind;
module.exports.pricingRowsForKind = pricingRowsForKind;
module.exports.resolveServicePriceSnapshot = resolveServicePriceSnapshot;
