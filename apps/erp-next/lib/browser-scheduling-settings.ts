import { browserKeys, loadBrowserValue } from './browser-store';
import { defaultSchedulingSettings, type SchedulingSettings, type WorkPreset } from './scheduling';

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

function positive(value: number, fallback: number) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function withConfiguredDurations(presets: WorkPreset[], settings: BrowserBusinessSettings): WorkPreset[] {
  return presets.map((preset) => {
    if (preset.id === 'standard_service') return { ...preset, durationMinutes: positive(settings.serviceMinutes, preset.durationMinutes) };
    if (preset.id === 'deep_cleaning') return { ...preset, durationMinutes: positive(settings.deepMinutes, preset.durationMinutes) };
    return preset;
  });
}

export function loadRuntimeSchedulingSettings(): SchedulingSettings {
  const browser = loadBrowserValue<BrowserBusinessSettings>(browserKeys.businessSettings, browserBusinessDefaults);
  return {
    ...defaultSchedulingSettings,
    workPresets: withConfiguredDurations(defaultSchedulingSettings.workPresets, browser),
    routeBufferMinutes: Math.max(0, Number.isFinite(browser.bufferMinutes) ? browser.bufferMinutes : defaultSchedulingSettings.routeBufferMinutes),
    workdayEnd: /^\d{2}:\d{2}$/.test(browser.afterHours) ? browser.afterHours : defaultSchedulingSettings.workdayEnd,
  };
}
