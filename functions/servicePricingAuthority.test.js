const assert = require('node:assert/strict');
const test = require('node:test');
const {
  matrixPricingKind,
  pricingRowsForKind,
  resolveServicePriceSnapshot,
} = require('./servicePricingAuthority');

function service(overrides = {}) {
  return {
    id: 'service-12k-standard',
    itemType: 'Servicio',
    name: '12K Standard Service',
    active: true,
    basePrice: 999,
    pricingDefinition: { version: 1, mode: 'fixed', currency: 'AWG' },
    serviceDefinition: { version: 1, bookingCode: '12k_standard', duration: { minutes: 60 } },
    ...overrides,
  };
}

function companyRules(overrides = {}) {
  return {
    version: 7,
    currency: 'Afl.',
    standardServiceSplit: [
      { btu: 12000, price: 125, durationMinutes: 60 },
      { btu: 18000, price: 135, durationMinutes: 60 },
    ],
    deepCleaningSplit: [{ btu: 12000, price: 195, durationMinutes: 120 }],
    standardInstallationAdinaDemac: [{ btu: 18000, price: 225, durationMinutes: 120 }],
    ...overrides,
  };
}

const capturedAt = '2026-08-25T17:40:00.000Z';

test('Company Rules matrix overrides a conflicting catalog base price for governed standard service', () => {
  const snapshot = resolveServicePriceSnapshot({
    service: service(),
    pricingSettings: companyRules(),
    btu: 12000,
    capturedAt,
  });
  assert.deepEqual(snapshot, {
    currency: 'AWG',
    unitPrice: 125,
    sourceCatalogItemId: 'service-12k-standard',
    pricingVersion: 'company-service-pricing-rules:v7:standard_service:12000',
    capturedAt,
  });
});

test('known matrix booking codes resolve only to the protected Company Rules families', () => {
  assert.equal(matrixPricingKind(service()), 'standard_service');
  assert.equal(matrixPricingKind(service({ serviceDefinition: { version: 1, bookingCode: '12k_deep_cleaning', duration: { minutes: 90 } } })), 'deep_cleaning');
  assert.equal(matrixPricingKind(service({ serviceDefinition: { version: 1, bookingCode: '18k_standard_installation', duration: { minutes: 120 } } })), 'standard_installation');
  assert.equal(matrixPricingKind(service({ serviceDefinition: { version: 1, bookingCode: 'installation_extended_labor', duration: { minutes: 120 } } })), '');
  assert.equal(matrixPricingKind(service({ serviceDefinition: { version: 1, bookingCode: 'check_up', duration: { minutes: 60 } } })), '');
});

test('explicit canonical pricing rule kind wins without guessing from a custom booking code', () => {
  const snapshot = resolveServicePriceSnapshot({
    service: service({
      pricingRuleKind: 'deep_cleaning',
      serviceDefinition: { version: 1, bookingCode: 'custom_deep_v2', duration: { minutes: 90 } },
    }),
    pricingSettings: companyRules(),
    btu: 12000,
    capturedAt,
  });
  assert.equal(snapshot.unitPrice, 195);
  assert.equal(snapshot.pricingVersion, 'company-service-pricing-rules:v7:deep_cleaning:12000');
});

test('matrix-governed service fails closed when Company Rules or exact BTU is missing', () => {
  assert.throws(
    () => resolveServicePriceSnapshot({ service: service(), pricingSettings: null, btu: 12000, capturedAt }),
    (error) => error?.code === 'service_pricing_not_configured',
  );
  assert.throws(
    () => resolveServicePriceSnapshot({ service: service(), pricingSettings: companyRules(), btu: null, capturedAt }),
    (error) => error?.code === 'service_pricing_btu_required',
  );
  assert.throws(
    () => resolveServicePriceSnapshot({ service: service(), pricingSettings: companyRules(), btu: 24000, capturedAt }),
    (error) => error?.code === 'service_pricing_not_found',
  );
});

test('duplicate Company Rules rows for the same BTU fail closed instead of choosing one', () => {
  assert.throws(
    () => resolveServicePriceSnapshot({
      service: service(),
      pricingSettings: companyRules({ standardServiceSplit: [
        { btu: 12000, price: 125 },
        { btu: 12000, price: 130 },
      ] }),
      btu: 12000,
      capturedAt,
    }),
    (error) => error?.code === 'service_pricing_ambiguous',
  );
});

test('non-matrix canonical service uses explicit catalog fixed base price', () => {
  const snapshot = resolveServicePriceSnapshot({
    service: service({
      id: 'service-checkup',
      name: 'Check-up',
      basePrice: 75,
      serviceDefinition: { version: 1, bookingCode: 'check_up', duration: { minutes: 60 } },
    }),
    pricingSettings: companyRules(),
    btu: null,
    capturedAt,
  });
  assert.equal(snapshot.unitPrice, 75);
  assert.equal(snapshot.pricingVersion, 'service-catalog:service-checkup:fixed');
});

test('catalog quote mode cannot become an implicitly approved Field price', () => {
  assert.throws(
    () => resolveServicePriceSnapshot({
      service: service({
        id: 'service-quoted',
        serviceDefinition: { version: 1, bookingCode: 'custom_quote', duration: { minutes: 60 } },
        pricingDefinition: { version: 1, mode: 'quote', currency: 'AWG' },
      }),
      pricingSettings: companyRules(),
      btu: 12000,
      capturedAt,
    }),
    (error) => error?.code === 'service_pricing_quote_required',
  );
});

test('tiered catalog pricing requires one exact non-overlapping BTU tier', () => {
  const tiered = service({
    id: 'service-tiered',
    serviceDefinition: { version: 1, bookingCode: 'commercial_service', duration: { minutes: 120 } },
    pricingDefinition: {
      version: 1,
      mode: 'tiered_btu',
      currency: 'AWG',
      tiers: [
        { id: 'small', minBtu: 9000, maxBtu: 18000, amount: 200 },
        { id: 'large', minBtu: 18001, maxBtu: 36000, amount: 300 },
      ],
    },
  });
  const snapshot = resolveServicePriceSnapshot({ service: tiered, pricingSettings: companyRules(), btu: 24000, capturedAt });
  assert.equal(snapshot.unitPrice, 300);
  assert.match(snapshot.pricingVersion, /large$/);

  assert.throws(
    () => resolveServicePriceSnapshot({ service: tiered, pricingSettings: companyRules(), btu: null, capturedAt }),
    (error) => error?.code === 'service_pricing_btu_required',
  );
  assert.throws(
    () => resolveServicePriceSnapshot({
      service: {
        ...tiered,
        pricingDefinition: {
          ...tiered.pricingDefinition,
          tiers: [
            { id: 'one', minBtu: 9000, maxBtu: 24000, amount: 200 },
            { id: 'two', minBtu: 18000, maxBtu: 36000, amount: 300 },
          ],
        },
      },
      pricingSettings: companyRules(),
      btu: 20000,
      capturedAt,
    }),
    (error) => error?.code === 'service_pricing_ambiguous',
  );
});

test('catalog fallback fails closed on missing price, unsupported currency, mode or invalid timestamp', () => {
  const checkup = service({
    id: 'service-checkup',
    serviceDefinition: { version: 1, bookingCode: 'check_up', duration: { minutes: 60 } },
  });
  const { basePrice: _price, ...withoutPrice } = checkup;
  assert.throws(
    () => resolveServicePriceSnapshot({ service: withoutPrice, pricingSettings: companyRules(), capturedAt }),
    (error) => error?.code === 'service_pricing_not_configured',
  );
  assert.throws(
    () => resolveServicePriceSnapshot({ service: { ...checkup, pricingDefinition: { version: 1, mode: 'fixed', currency: 'USD' } }, pricingSettings: companyRules(), capturedAt }),
    (error) => error?.code === 'service_pricing_currency_unsupported',
  );
  assert.throws(
    () => resolveServicePriceSnapshot({ service: { ...checkup, pricingDefinition: { version: 1, mode: 'future', currency: 'AWG' } }, pricingSettings: companyRules(), capturedAt }),
    (error) => error?.code === 'service_pricing_mode_unsupported',
  );
  assert.throws(
    () => resolveServicePriceSnapshot({ service: checkup, pricingSettings: companyRules(), capturedAt: 'not-time' }),
    (error) => error?.code === 'service_pricing_timestamp_required',
  );
});

test('pricing row helper preserves the existing Company Rules collection shape', () => {
  const settings = companyRules();
  assert.equal(pricingRowsForKind(settings, 'standard_service'), settings.standardServiceSplit);
  assert.equal(pricingRowsForKind(settings, 'deep_cleaning'), settings.deepCleaningSplit);
  assert.equal(pricingRowsForKind(settings, 'standard_installation'), settings.standardInstallationAdinaDemac);
});
