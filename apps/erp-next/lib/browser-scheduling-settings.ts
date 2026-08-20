import { browserKeys, loadBrowserValue } from './browser-store';
import { configureSchedulingRuntime, type SchedulingRuntimeOverrides } from './scheduling';

/**
 * Browser scheduling settings are retained only for non-canonical preview
 * compatibility. Service durations are deliberately ignored by the runtime:
 * canonical service duration now belongs to services/{serviceId}.serviceDefinition.
 */
export type BrowserBusinessSettings = {
  serviceMinutes: number;
  deepMinutes: number;
  bufferMinutes: number;
  afterHours: string;
};

export const browserBusinessDefaults: BrowserBusinessSettings = {
  serviceMinutes: 60,
  deepMinutes: 90,
  bufferMinutes: 30,
  afterHours: '17:00',
};

function clampMinutes(value: number, fallback: number, minimum: number) {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.round(value / 15) * 15;
  return Math.max(minimum, Math.min(480, rounded));
}

function clampBuffer(value: number) {
  if (!Number.isFinite(value)) return browserBusinessDefaults.bufferMinutes;
  return Math.max(0, Math.min(120, Math.round(value / 5) * 5));
}

export function normalizeBrowserBusinessSettings(value: BrowserBusinessSettings): BrowserBusinessSettings {
  return {
    // Preserve old local values so preview data can still be read without a
    // destructive migration. These two fields no longer configure scheduling.
    serviceMinutes: clampMinutes(value.serviceMinutes, browserBusinessDefaults.serviceMinutes, 30),
    deepMinutes: clampMinutes(value.deepMinutes, browserBusinessDefaults.deepMinutes, 45),
    bufferMinutes: clampBuffer(value.bufferMinutes),
    afterHours: /^\d{2}:\d{2}$/.test(value.afterHours) ? value.afterHours : browserBusinessDefaults.afterHours,
  };
}

export function loadBrowserBusinessSettings() {
  return normalizeBrowserBusinessSettings(loadBrowserValue<BrowserBusinessSettings>(browserKeys.businessSettings, browserBusinessDefaults));
}

export function schedulingOverridesFromBrowser(value: BrowserBusinessSettings): SchedulingRuntimeOverrides {
  const normalized = normalizeBrowserBusinessSettings(value);
  return {
    routeMarginMinutes: normalized.bufferMinutes,
  };
}

export function applyBrowserSchedulingRuntime(value = loadBrowserBusinessSettings()) {
  return configureSchedulingRuntime(schedulingOverridesFromBrowser(value));
}
