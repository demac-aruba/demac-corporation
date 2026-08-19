'use client';

import { useEffect, useState } from 'react';
import { TextSizeControl } from '@/components/accessibility/text-size-control';
import { CanonicalOperatingCalendar } from '@/components/canonical-operating-calendar';
import { browserBusinessDefaults, loadBrowserBusinessSettings, normalizeBrowserBusinessSettings, type BrowserBusinessSettings } from '@/lib/browser-scheduling-settings';
import { browserKeys, saveBrowserValue } from '@/lib/browser-store';

export function SystemSettingsWorkspace() {
  const [settings, setSettings] = useState<BrowserBusinessSettings>(browserBusinessDefaults);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadBrowserBusinessSettings());
    setReady(true);
  }, []);

  const update = <K extends keyof BrowserBusinessSettings>(key: K, value: BrowserBusinessSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const saveDraft = () => {
    const normalized = normalizeBrowserBusinessSettings(settings);
    saveBrowserValue(browserKeys.businessSettings, normalized);
    setSettings(normalized);
    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    window.dispatchEvent(new Event('demac:business-settings-saved'));
  };

  return (
    <div className="sg-stack">
      <section className="page-head">
        <div><div className="eyebrow">Governed Configuration</div><h1>System Settings</h1><p>Business rules that are expected to change belong in controlled configuration — with permissions and history — instead of being hidden inside application code.</p></div>
        <div className="page-actions"><button className="btn" type="button">Change History</button><button className="btn primary" type="button" onClick={saveDraft} disabled={!ready || !dirty}>Save Browser Draft</button></div>
      </section>

      <section className="sg-settings-grid">
        <article className="panel sg-setting-card">
          <header><div><span>My Preferences</span><h2>Accessibility</h2></div><b>Per User</b></header>
          <TextSizeControl />
          <div className="sg-runtime-note"><strong>Personal preference</strong><p>The approved default typography is Standard. Each user may enlarge operational text by 1–4 px without changing H1/H2/H3 page titles. The preference is saved automatically for the signed-in user and loads again when the ERP opens on this browser.</p></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Scheduling</span><h2>Work Durations</h2></div><b>Live Runtime</b></header>
          <div className="sg-form-grid">
            <label>Standard service<input type="number" min="30" max="480" step="15" value={settings.serviceMinutes} onChange={(e)=>update('serviceMinutes',Number(e.target.value))}/><small>minutes per standard-service A/C unit</small></label>
            <label>Deep cleaning<input type="number" min="45" max="480" step="15" value={settings.deepMinutes} onChange={(e)=>update('deepMinutes',Number(e.target.value))}/><small>minutes per deep-cleaning A/C unit</small></label>
            <label>Operational buffer<input type="number" min="0" max="120" step="5" value={settings.bufferMinutes} onChange={(e)=>update('bufferMinutes',Number(e.target.value))}/><small>margin before lunch / end-of-day route recovery</small></label>
            <label>Overtime threshold<input type="time" value={settings.afterHours} onChange={(e)=>update('afterHours',e.target.value)}/><small>work after this time is flagged; this does not extend scheduling capacity</small></label>
          </div>
          <div className="sg-runtime-note"><strong>Operational effect</strong><p>After saving, Scheduling uses these service/deep-cleaning durations and the route buffer when calculating valid future options. Existing appointments keep their recorded start/end snapshots and are not silently rewritten.</p></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Operations</span><h2>Working Calendar</h2></div><b>Protected</b></header>
          <div className="sg-rule-table"><div><strong>Monday–Friday</strong><span>08:00–17:00</span><small>Lunch 12:00–13:00</small></div><div><strong>Saturday</strong><span>09:00–13:00</span><small>Short operating day; route buffer still protects closing margin</small></div><div><strong>Sunday</strong><span>Closed</span><small>No standard residential scheduling</small></div><div><strong>Emergency</strong><span>Commercial only</span><small>Requires governed exception path</small></div></div>
        </article>

        <CanonicalOperatingCalendar />

        <article className="panel sg-setting-card">
          <header><div><span>Dispatch</span><h2>Geography & Capacity</h2></div><b>Configurable</b></header>
          <div className="sg-rule-table"><div><strong>AM routing</strong><span>First AM job anchors sector</span><small>Later jobs same/adjacent/on route</small></div><div><strong>PM routing</strong><span>First PM job anchors sector</span><small>Afternoon cluster recalculated independently</small></div><div><strong>Standard capacity</strong><span>6 jobs / team / day</span><small>Subject to configured duration and route constraints</small></div><div><strong>Single-property capacity</strong><span>Up to 7 services</span><small>Large jobs may link support van; runtime duration must still fit the day</small></div></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Governance</span><h2>Protected Controls</h2></div><b className="danger">Owner approval</b></header>
          <div className="sg-protected-list"><div><span>Financial truth</span><strong>Cannot be overridden by AI</strong></div><div><span>Bank authority</span><strong>Read-only — no money movement</strong></div><div><span>Customer reports</span><strong>Office review before send</strong></div><div><span>Support van messaging</span><strong>Never duplicates customer reminders</strong></div></div>
        </article>
      </section>

      <section className="panel sg-change-banner"><div><strong>{dirty ? 'Unsaved browser configuration changes' : 'Browser configuration draft saved'}</strong><p>Saved Standard Service, Deep Cleaning and Operational Buffer values now feed the Scheduling runtime for live workflow testing. Canonical van half-days and company closures are displayed directly from Firestore above and are not overwritten by this browser draft.</p></div><span>{dirty ? 'Draft changed' : savedAt ? `Saved ${savedAt}` : 'Loaded from browser'}</span></section>
    </div>
  );
}
