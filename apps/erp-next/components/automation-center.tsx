'use client';

import { useState } from 'react';
import { automationRules } from '@/lib/system-governance';

export function AutomationCenter() {
  const [enabled, setEnabled] = useState<Record<string, boolean>>(() => Object.fromEntries(automationRules.map((rule) => [rule.id, rule.enabled])));

  return (
    <div className="sg-stack">
      <section className="page-head">
        <div><div className="eyebrow">Governed Automation</div><h1>Automation Center</h1><p>Automations are visible business rules with an owner, trigger, action, authority mode and failure path. Critical decisions never disappear inside hidden scripts.</p></div>
        <div className="page-actions"><button className="btn" type="button">Failure Queue</button><button className="btn primary" type="button">+ Automation</button></div>
      </section>

      <section className="sg-automation-summary"><article><span>Configured</span><strong>{automationRules.length}</strong><small>Governed rules</small></article><article><span>Enabled</span><strong>{Object.values(enabled).filter(Boolean).length}</strong><small>Preview state</small></article><article><span>Failures</span><strong>0</strong><small className="sg-good">No active failures</small></article><article><span>High-Risk Writes</span><strong>0</strong><small>Approval-only by policy</small></article></section>

      <section className="sg-automation-list">
        {automationRules.map((rule) => (
          <article className="panel sg-automation-card" key={rule.id}>
            <div className="sg-auto-head"><div><span>{rule.id}</span><h2>{rule.name}</h2></div><button className={`sg-toggle ${enabled[rule.id] ? 'on' : ''}`} type="button" onClick={() => setEnabled((current) => ({ ...current, [rule.id]: !current[rule.id] }))} aria-pressed={enabled[rule.id]}><i /></button></div>
            <div className="sg-auto-flow"><div><span>When</span><strong>{rule.trigger}</strong></div><b>→</b><div><span>Then</span><strong>{rule.action}</strong></div></div>
            <div className="sg-auto-meta"><div><span>Owner</span><strong>{rule.owner}</strong></div><div><span>Authority</span><strong>{rule.mode}</strong></div><div><span>Status</span><strong className={enabled[rule.id] ? 'sg-good' : 'sg-muted'}>{enabled[rule.id] ? 'Enabled preview' : 'Disabled'}</strong></div></div>
          </article>
        ))}
      </section>

      <section className="panel sg-guardrail"><div><span>Automation guardrail</span><strong>Bank transfers, refunds, journal entries, payroll changes, destructive deletes and large purchases cannot be automated without explicit approval.</strong></div><b>Protected</b></section>
    </div>
  );
}
