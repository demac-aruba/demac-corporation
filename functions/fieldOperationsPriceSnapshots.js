const { fieldError } = require('./fieldOperationsAuthorityCore');

const FIELD_PRICE_SNAPSHOT_REQUIRED_ORIGINS = new Set([
  'added_on_site_client_request',
  'added_on_site_technician_discovery',
]);

function text(value, limit = 1000) {
  return String(value ?? '').trim().slice(0, limit);
}

function canonicalMoney(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw fieldError('invalid_field_price_snapshot', `Persisted Field price ${label} is invalid.`, 409);
  }
  return Math.round(number * 100) / 100;
}

function optionalMoney(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return canonicalMoney(value, label);
}

function canonicalPricingVersion(value) {
  if (typeof value === 'string') {
    const normalized = text(value, 240);
    if (normalized) return normalized;
  }
  if (Number.isSafeInteger(value) && value > 0) return value;
  throw fieldError('invalid_field_price_snapshot', 'Persisted Field price pricingVersion is invalid.', 409);
}

function projectFieldPriceSnapshot(value, expectedServiceCatalogItemId = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw fieldError('invalid_field_price_snapshot', 'Persisted Field price snapshot is invalid.', 409);
  }
  const currency = text(value.currency, 20).toUpperCase();
  if (!currency) {
    throw fieldError('invalid_field_price_snapshot', 'Persisted Field price currency is missing.', 409);
  }
  const sourceCatalogItemId = text(value.sourceCatalogItemId, 180);
  const expectedServiceId = text(expectedServiceCatalogItemId, 180);
  if (expectedServiceId && sourceCatalogItemId !== expectedServiceId) {
    throw fieldError(
      'work_intervention_price_identity_conflict',
      'Persisted Work Intervention price does not match its canonical Service identity.',
      409,
    );
  }
  if (!sourceCatalogItemId) {
    throw fieldError('invalid_field_price_snapshot', 'Persisted Field price source Service is missing.', 409);
  }
  const capturedAt = text(value.capturedAt, 80);
  if (!capturedAt || Number.isNaN(Date.parse(capturedAt))) {
    throw fieldError('invalid_field_price_snapshot', 'Persisted Field price capturedAt is invalid.', 409);
  }
  const discountAmount = optionalMoney(value.discountAmount, 'discountAmount');
  const taxAmount = optionalMoney(value.taxAmount, 'taxAmount');
  const lineTotal = optionalMoney(value.lineTotal, 'lineTotal');
  return {
    currency,
    unitPrice: canonicalMoney(value.unitPrice, 'unitPrice'),
    ...(discountAmount === undefined ? {} : { discountAmount }),
    ...(taxAmount === undefined ? {} : { taxAmount }),
    ...(lineTotal === undefined ? {} : { lineTotal }),
    sourceCatalogItemId,
    pricingVersion: canonicalPricingVersion(value.pricingVersion),
    capturedAt,
  };
}

function priceSnapshotRequiredForOrigin(origin) {
  return FIELD_PRICE_SNAPSHOT_REQUIRED_ORIGINS.has(text(origin, 80));
}

module.exports.FIELD_PRICE_SNAPSHOT_REQUIRED_ORIGINS = FIELD_PRICE_SNAPSHOT_REQUIRED_ORIGINS;
module.exports.priceSnapshotRequiredForOrigin = priceSnapshotRequiredForOrigin;
module.exports.projectFieldPriceSnapshot = projectFieldPriceSnapshot;
