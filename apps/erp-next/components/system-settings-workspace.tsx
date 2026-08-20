'use client';

import { useEffect, useState } from 'react';
import { TextSizeControl } from '@/components/accessibility/text-size-control';
import { CanonicalOperatingCalendar } from '@/components/canonical-operating-calendar';
import { SchedulingWorkTypesSettings } from '@/components/scheduling-work-types-settings';
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
        <div><div className="eyebrow">Governed Configuration</div><h1>System Settings</h1><p>Scheduling Work Types define the fast appointment categories and time required to reserve capacity. Services & Products remains the detailed commercial catalog for prices, BTU-specific services and reporting. Scheduling separately owns van capacity, support resources, conflicts and calendar policy.</p></div>
        <div className="page-actions"><button className="btn primary" type="button" onClick={saveDraft} disabled={!ready || !dirty}>Save Preview Preferences</button></div>
      </section>

      <section className="sg-settings-grid">
        <SchedulingWorkTypesSettings />

        <article className="panel sg-setting-card">
          <header><div><span>My Preferences</span><h2>Accessibility</h2></div><b>Per User</b></header>
          <TextSizeControl />
          <div className="sg-runtime-note"><strong>Personal preference</strong><p>The approved default typography is Standard. Each user may enlarge operational text by 1–4 px without changing H1/H2/H3 page titles. The preference is saved automatically for the signed-in user and loads again when the ERP opens on this browser.</p></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Scheduling</span><h2>Route Buffer & Overtime</h2></div><b>Browser Preview</b></header>
          <div className="sg-form-grid">
            <label>Operational buffer<input type="number" min="0" max="120" step="5" value={settings.bufferMinutes} onChange={(e)=>update('bufferMinutes',Number(e.target.value))}/><small>preview margin before lunch / end-of-day route recovery</small></label>
            <label>Overtime threshold<input type="time" value={settings.afterHours} onChange={(e)=>update('afterHours',e.target.value)}/><small>preview flag only; this does not extend canonical scheduling capacity</small></label>
          </div>
          <div className="sg-runtime-note"><strong>Appointment duration belongs to Scheduling Work Types</strong><p>When the office books Standard Service, Deep Cleaning, Installation, Commercial Service or another appointment category, Scheduling uses the duration configured above and multiplies it by quantity. Detailed BTU-specific commercial services do not control the agenda picker.</p></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Operations</span><h2>Working Calendar</h2></div><b>Protected</b></header>
          <div className="sg-rule-table"><div><strong>Monday–Friday</strong><span>08:00–17:00</span><small>Lunch 12:00–13:00</small></div><div><strong>Saturday</strong><span>09:00–13:00</span><small>Short operating day; route buffer still protects closing margin</small></div><div><strong>Sunday</strong><span>Closed</span><small>No standard residential scheduling</small></div><div><strong>Emergency</strong><span>Commercial only</span><small>Requires governed exception path</small></div></div>
        </article>

        <CanonicalOperatingCalendar />

        <article className="panel sg-setting-card">
          <header><div><span>Dispatch</span><h2>Geography & Capacity</h2></div><b>Scheduling Policy</b></header>
          <div className="sg-rule-table"><div><strong>AM routing</strong><span>First AM job anchors sector</span><small>Later jobs same/adjacent/on route</small></div><div><strong>PM routing</strong><span>First PM job anchors sector</span><small>Afternoon cluster recalculated independently</small></div><div><strong>Van availability</strong><span>Calendar + crew + existing work</span><small>Scheduling owns whether a resource is actually free.</small></div><div><strong>Allocation & capacity</strong><span>Owned by Scheduling</span><small>Van limits and support behavior are agenda rules, not commercial service fields.</small></div></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Governance</span><h2>Protected Controls</h2></div><b className="danger">Owner approval</b></header>
          <div className="sg-protected-list"><div><span>Financial truth</span><strong>Cannot be overridden by AI</strong></div><div><span>Bank authority</span><strong>Read-only — no money movement</strong></div><div><span>Customer reports</span><strong>Office review before send</strong></div><div><span>Support van messaging</span><strong>Never duplicates customer reminders</strong></div></div>
        </article>
      </section>

      <section className="panel sg-change-banner"><div><strong>{dirty ? 'Unsaved preview preference changes' : 'Preview preferences saved locally'}</strong><p>Scheduling Work Types and the canonical working calendar above write to Firestore. Browser-only buffer/overtime preferences remain isolated from canonical appointment capacity.</p></div><span>{dirty ? 'Preview changed' : savedAt ? `Saved ${savedAt}` : 'Loaded from browser'}</span></section>
    </div>
  );
}
