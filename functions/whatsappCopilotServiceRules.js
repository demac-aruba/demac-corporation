const availability = require("./whatsappCopilotAvailability");
const {
  DEFAULT_PRESETS,
  normalizeText,
} = require("./whatsappCopilotSchedulingCore");

const originalResolvePreset = availability.resolvePreset;
const REPAIR_FALLBACK = {
  id: "repair_diagnostic",
  label: "Diagnóstico / reparación",
  durationMinutesPerUnit: 60,
  kind: "service",
  active: true,
  sortOrder: 50,
};

function activePresets(presetSettings) {
  return Array.isArray(presetSettings?.presets) && presetSettings.presets.length
    ? presetSettings.presets.filter((preset) => preset.active !== false)
    : [...DEFAULT_PRESETS, REPAIR_FALLBACK];
}

function resolvePreset(analysis, presetSettings) {
  const text = normalizeText([
    analysis?.intent,
    analysis?.summary,
    analysis?.collectedInformation?.serviceType,
    analysis?.collectedInformation?.extraDetails,
  ].filter(Boolean).join(" "));
  if (/repair|reparacion|reparación|repara|diagnostic|diagnostico|diagnóstico|checkup|check up/.test(text)) {
    const presets = activePresets(presetSettings);
    const preset = presets.find((item) => item.id === "repair_diagnostic")
      || presets.find((item) => /repair|repar|diagnost|checkup/.test(normalizeText(`${item.id} ${item.label}`)))
      || REPAIR_FALLBACK;
    return {
      ...preset,
      durationMinutesPerUnit: Math.max(30, Number(preset.durationMinutesPerUnit || 60)),
    };
  }
  return originalResolvePreset(analysis, presetSettings);
}

availability.resolvePreset = resolvePreset;

module.exports = {
  REPAIR_FALLBACK,
  resolvePreset,
};
