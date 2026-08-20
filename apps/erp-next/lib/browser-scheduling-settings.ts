import { browserKeys, loadBrowserValue } from './browser-store';
import { configureSchedulingRuntime, type SchedulingRuntimeOverrides } from './scheduling';

/**
 * Browser settings are limited to non-canonical preview preferences.
 * Service duration belongs only to services/{serviceId}.serviceDefinition.
 * Older browser records may still contain removed duration keys; they are ignored.
 */
export type BrowserBusinessSettings = {
  bufferMinutes: number;
  afterHours: string;
};

export const browserBusinessDefaults: BrowserBusinessSettings = {
  bufferMinutes: 30,
  afterHours: '17:00',
};

function clampBuffer(value: number) {
  if (!Number.isFinite(value)) return browserBusinessDefaults.bufferMinutes;
  return Math.max(0, Math.min(120, Math.round(value / 5) * 5));
}

export function normalizeBrowserBusinessSettings(value: BrowserBusinessSettings): BrowserBusinessSettings {
  return {
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
