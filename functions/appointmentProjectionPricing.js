'use strict';

// Forecast-only fallback. Field and final-charge pricing retain exact-BTU rules.
const { matrixPricingKind, pricingRowsForKind, canonicalMoney, canonicalBtu } = require('./servicePricingAuthority');
function minimumProjectionPrice({ service, pricingSettings }) {
  const kind = matrixPricingKind(service);
  if (!kind) {
    const definition = service?.pricingDefinition;
    if (String(definition?.mode || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_') !== 'tiered_btu') return null;
    const invalid = () => { throw Object.assign(new Error('No valid minimum tariff is configured.'), { code: 'service_pricing_invalid' }); };
    if ((String(definition.currency ?? '').trim().toUpperCase() || 'AWG') !== 'AWG') return invalid();
    const tiers = Array.isArray(definition.tiers) ? definition.tiers : [];
    if (tiers.some(tier => !tier || typeof tier !== 'object' || Array.isArray(tier))) return invalid();
    const valid = tiers.map(tier => ({ amount: canonicalMoney(tier.amount),
      min: tier.minBtu == null || tier.minBtu === '' ? 1 : canonicalBtu(tier.minBtu),
      max: tier.maxBtu == null || tier.maxBtu === '' ? Infinity : canonicalBtu(tier.maxBtu) })).sort((a,b) => a.min - b.min);
    if (!valid.length || valid.some((tier, index) => tier.amount === null || !tier.min || !tier.max || tier.max < tier.min
      || index > 0 && tier.min <= valid[index - 1].max)) return invalid();
    return { unitPrice: Math.min(...valid.map(tier => tier.amount)), pricingVersion: `service-catalog:${service.id}:tiered_btu:minimum`, projectionOnly: true };
  }
  const rows = pricingRowsForKind(pricingSettings, kind);
  const valid = rows.map(row => ({ btu: canonicalBtu(row?.btu), price: canonicalMoney(row?.price) }));
  // Do not manufacture a minimum from incomplete/ambiguous configuration.
  if (!valid.length || valid.some(row => !row.btu || row.price === null)
    || new Set(valid.map(row => row.btu)).size !== valid.length) return null;
  return { unitPrice: Math.min(...valid.map(row => row.price)),
    pricingVersion: `company-service-pricing-rules:v${pricingSettings?.version || 1}:${kind}:minimum`,
    projectionOnly: true };
}
function bookingProjectionLines(appointment = {}) {
  const work = appointment.workItems?.length ? appointment.workItems : appointment.workLines || [];
  return work.map((line, index) => ({ id: line.id || `work-${index + 1}`, workLineId: line.id || `work-${index + 1}`,
    label: line.label || line.workTypeName || line.presetId || 'Trabajo agendado',
    presetId: line.presetId || '', serviceId: line.serviceId || '', quantity: line.quantity || 1 }));
}
module.exports = { minimumProjectionPrice, bookingProjectionLines };
