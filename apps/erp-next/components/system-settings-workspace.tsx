'use client';

import { useEffect, useState } from 'react';
import { browserKeys, loadBrowserValue, saveBrowserValue } from '@/lib/browser-store';

type BusinessSettings = {
  serviceMinutes: number;
  deepMinutes: number;
  bufferMinutes: number;
  afterHours: string;
};

const defaults: BusinessSettings = { serviceMinutes: 60, deepMinutes: 90, bufferMinutes: 30, afterHours: '17:00' };

export function SystemSettingsWorkspace() {
  const [settings, setSettings] = useState<BusinessSettings>(defaults);
  const [ready, setReady] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadBrowserValue(browserKeys.businessSettings, defaults));
    setReady(true);
  }, []);

  const update = <K extends keyof BusinessSettings>(key: K, value: BusinessSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  const saveDraft = () => {
    saveBrowserValue(browserKeys.businessSettings, settings);
    setDirty(false);
    setSavedAt(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
  };

  return (
    <div className="sg-stack">
      <section className="page-head">
        <div><div className="eyebrow">Governed Configuration</div><h1>System Settings</h1><p>Business rules that are expected to change belong in controlled configuration — with permissions and history — instead of being hidden inside application code.</p></div>
        <div className="page-actions"><button className="btn" type="button">Change History</button><button className="btn primary" type="button" onClick={saveDraft} disabled={!ready || !dirty}>Save Browser Draft</button></div>
      </section>

      <section className="sg-settings-grid">
        <article className="panel sg-setting-card">
          <header><div><span>Scheduling</span><h2>Work Durations</h2></div><b>Configurable</b></header>
          <div className="sg-form-grid"><label>Standard service<input type="number" min="30" step="15" value={settings.serviceMinutes} onChange={(e)=>update('serviceMinutes',Number(e.target.value))}/><small>minutes per standard booking unit</small></label><label>Deep cleaning<input type="number" min="45" step="15" value={settings.deepMinutes} onChange={(e)=>update('deepMinutes',Number(e.target.value))}/><small>default duration before travel rules</small></label><label>Operational buffer<input type="number" min="0" step="5" value={settings.bufferMinutes} onChange={(e)=>update('bufferMinutes',Number(e.target.value))}/><small>margin for delays / route recovery</small></label><label>Overtime threshold<input type="time" value={settings.afterHours} onChange={(e)=>update('afterHours',e.target.value)}/><small>work after this time is flagged</small></label></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Operations</span><h2>Working Calendar</h2></div><b>Protected</b></header>
          <div className="sg-rule-table"><div><strong>Monday–Friday</strong><span>08:00–17:00</span><small>Lunch 12:00–13:00</small></div><div><strong>Saturday</strong><span>09:00–13:00</span><small>Short operating day</small></div><div><strong>Sunday</strong><span>Closed</span><small>No standard residential scheduling</small></div><div><strong>Emergency</strong><span>Commercial only</span><small>Requires governed exception path</small></div></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Dispatch</span><h2>Geography & Capacity</h2></div><b>Configurable</b></header>
          <div className="sg-rule-table"><div><strong>AM routing</strong><span>First AM job anchors sector</span><small>Later jobs same/adjacent/on route</small></div><div><strong>PM routing</strong><span>First PM job anchors sector</span><small>Afternoon cluster recalculated independently</small></div><div><strong>Standard capacity</strong><span>6 jobs / team / day</span><small>Subject to duration and route constraints</small></div><div><strong>Single-property capacity</strong><span>Up to 7 services</span><small>Large jobs may link support van</small></div></div>
        </article>

        <article className="panel sg-setting-card">
          <header><div><span>Governance</span><h2>Protected Controls</h2></div><b className="danger">Owner approval</b></header>
          <div className="sg-protected-list"><div><span>Financial truth</span><strong>Cannot be overridden by AI</strong></div><div><span>Bank authority</span><strong>Read-only — no money movement</strong></div><div><span>Customer reports</span><strong>Office review before send</strong></div><div><span>Support van messaging</span><strong>Never duplicates customer reminders</strong></div></div>
        </article>
      </section>

      <section className="panel sg-change-banner"><div><strong>{dirty ? 'Unsaved browser configuration changes' : 'Browser configuration draft saved'}</strong><p>These values now persist on this browser for live workflow testing. Firebase-backed versioning, permissions and audit events will replace this preview store when production persistence is enabled.</p></div><span>{dirty ? 'Draft changed' : savedAt ? `Saved ${savedAt}` : 'Loaded from browser'}</span></section>
    </div>
  );
}
