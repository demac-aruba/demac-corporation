'use strict';
// Cloud Functions returns eventFilters in varying order on consecutive reads.
// They are an unordered conjunction; retain every attribute/operator/value.
function canonicalFunctionConfig(fn) {
  const trigger = fn.eventTrigger ? { ...fn.eventTrigger,
    ...(fn.eventTrigger.eventFilters ? { eventFilters: [...fn.eventTrigger.eventFilters].sort((a, b) =>
      JSON.stringify([a.attribute, a.operator || '', a.value]).localeCompare(JSON.stringify([b.attribute, b.operator || '', b.value]))) } : {}) } : null;
  return { runtime: fn.buildConfig.runtime, entryPoint: fn.buildConfig.entryPoint,
    service: Object.fromEntries(Object.entries(fn.serviceConfig).filter(([key]) => !['revision', 'uri', 'service'].includes(key))), trigger };
}
module.exports = { canonicalFunctionConfig };
