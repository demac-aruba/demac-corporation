'use client';

import { useState } from 'react';
import type { UserRole } from '@/lib/domain';
import { roleCapabilities, roleLabels, type Capability } from '@/lib/security';

const roles = Object.keys(roleLabels) as UserRole[];
const capabilityGroups: { label: string; capabilities: Capability[] }[] = [
  { label: 'Customer & Sales', capabilities: ['crm.view','crm.manage','sales.view','sales.manage'] },
  { label: 'Operations', capabilities: ['scheduling.view','scheduling.manage','work_orders.view','work_orders.manage','field.execute'] },
  { label: 'Communications', capabilities: ['communications.view','communications.reply','communications.manage'] },
  { label: 'Inventory & Purchasing', capabilities: ['inventory.view','inventory.manage','inventory.approve','purchasing.view','purchasing.manage','purchasing.approve'] },
  { label: 'Finance', capabilities: ['finance.view','finance.manage','finance.approve','banking.view','banking.reconcile'] },
  { label: 'People & Projects', capabilities: ['employees.view','employees.manage','payroll_sensitive.view','projects.view','projects.manage'] },
  { label: 'Management & System', capabilities: ['reports.view','executive_ai.use','settings.view','settings.manage','automations.view','automations.manage','integrations.view','integrations.manage','audit.view','security.manage'] },
];

function labelCapability(value: Capability) {
  return value.replaceAll('_', ' ').replace('.', ' · ');
}

export function AccessControlWorkspace() {
  const [selectedRole, setSelectedRole] = useState<UserRole>('super_admin');
  const selected = roleCapabilities[selectedRole];

  return (
    <div className="ps-stack">
      <section className="page-head">
        <div><div className="eyebrow">Security · Least Privilege</div><h1>Access Control</h1><p>ERP access is defined by explicit capabilities and enforced again at the data layer. Hiding a menu is never considered sufficient authorization.</p></div>
        <div className="page-actions"><button className="btn" type="button">Policy History</button><button className="btn primary" type="button">Invite User</button></div>
      </section>

      <section className="ps-security-metrics"><article><span>Defined Roles</span><strong>{roles.length}</strong><small>Owner through Technician</small></article><article><span>Capabilities</span><strong>{new Set(roles.flatMap((role) => [...roleCapabilities[role]])).size}</strong><small>Explicit business permissions</small></article><article><span>High-Risk Actions</span><strong>Approval Only</strong><small className="ps-good">No autonomous money movement</small></article><article><span>Production Auth</span><strong>Pending</strong><small className="ps-warn">Firebase Auth not connected yet</small></article></section>

      <section className="ps-access-layout">
        <aside className="panel ps-role-list"><header className="panel-head"><div><h2>Roles</h2><span>Select a role to inspect access</span></div></header>{roles.map((role) => <button className={selectedRole === role ? 'active' : ''} type="button" onClick={() => setSelectedRole(role)} key={role}><strong>{roleLabels[role]}</strong><span>{roleCapabilities[role].size} capabilities</span></button>)}</aside>

        <main className="panel ps-capability-panel">
          <header className="panel-head"><div><h2>{roleLabels[selectedRole]}</h2><span>Effective capability preview</span></div><b>{selected.size} allowed</b></header>
          <div className="ps-capability-groups">{capabilityGroups.map((group) => <section key={group.label}><h3>{group.label}</h3><div>{group.capabilities.map((capability) => <article className={selected.has(capability) ? 'allowed' : 'denied'} key={capability}><span>{selected.has(capability) ? '✓' : '—'}</span><strong>{labelCapability(capability)}</strong><small>{selected.has(capability) ? 'Allowed' : 'Not granted'}</small></article>)}</div></section>)}</div>
        </main>
      </section>

      <section className="ps-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Enforcement Layers</h2><span>Defense in depth</span></div></header><div className="ps-rule-list"><div><strong>1 · Navigation</strong><span>Only relevant modules are shown for usability.</span></div><div><strong>2 · Application services</strong><span>Every sensitive command checks the required capability.</span></div><div><strong>3 · Database rules</strong><span>Firebase Security Rules independently enforce access when connected.</span></div><div><strong>4 · Audit</strong><span>Approved sensitive changes generate immutable audit events.</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Protected Decisions</h2><span>Explicit human authority</span></div></header><div className="ps-guardrails"><div><strong>Bank transfers / refunds</strong><span>Never autonomous</span></div><div><strong>Journal entries</strong><span>Finance approval</span></div><div><strong>Payroll-sensitive changes</strong><span>Restricted</span></div><div><strong>Destructive deletes</strong><span>Prefer archive + elevated approval</span></div><div><strong>Large purchases</strong><span>Approval threshold</span></div></div></article>
      </section>
    </div>
  );
}
