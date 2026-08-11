'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import type { UserRole } from '@/lib/domain';
import {
  createManagedUser,
  listManagedUsers,
  sendPasswordSetupEmail,
  updateManagedUser,
  type ManagedUser,
  type ManagedUserRole,
} from '@/lib/firebase/user-admin';
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

const managedRoleOptions: Array<{ value: ManagedUserRole; label: string; description: string }> = [
  { value: 'admin', label: 'Administrator', description: 'Full ERP access and user administration.' },
  { value: 'office', label: 'Office', description: 'Customers, scheduling and daily office operations.' },
  { value: 'supervisor', label: 'Supervisor', description: 'Operations supervision and field coordination.' },
  { value: 'technician', label: 'Technician', description: 'Assigned field work and technical reports.' },
  { value: 'accounting', label: 'Accounting', description: 'Finance and accounting access.' },
  { value: 'inventory', label: 'Inventory', description: 'Warehouse and inventory access.' },
];

function labelCapability(value: Capability) {
  return value.replaceAll('_', ' ').replace('.', ' · ');
}

function managedRoleLabel(role: ManagedUserRole) {
  return managedRoleOptions.find((option) => option.value === role)?.label ?? role;
}

function formatLastAccess(value?: string | null) {
  if (!value) return 'Never';
  try {
    return new Intl.DateTimeFormat('en', {
      timeZone: 'America/Aruba',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function AccessControlWorkspace() {
  const { principal } = useAuth();
  const [selectedRole, setSelectedRole] = useState<UserRole>('super_admin');
  const selected = roleCapabilities[selectedRole];
  const canManageUsers = principal.role === 'super_admin';

  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState('');
  const [userError, setUserError] = useState('');
  const [userMessage, setUserMessage] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [savingInvite, setSavingInvite] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [managedRole, setManagedRole] = useState<ManagedUserRole>('office');

  const loadUsers = useCallback(async () => {
    if (!canManageUsers) return;
    setUsersLoading(true);
    setUserError('');
    try {
      setUsers(await listManagedUsers());
    } catch (error) {
      setUserError(errorText(error));
    } finally {
      setUsersLoading(false);
    }
  }, [canManageUsers]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const activeUsers = useMemo(() => users.filter((user) => user.active).length, [users]);

  function openInvite() {
    setName('');
    setEmail('');
    setPhone('');
    setManagedRole('office');
    setUserError('');
    setUserMessage('');
    setInviteOpen(true);
  }

  async function saveInvite() {
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanName) return setUserError('Enter the user name.');
    if (!cleanEmail) return setUserError('Enter the email the user will use to sign in.');

    setSavingInvite(true);
    setUserError('');
    setUserMessage('');
    try {
      await createManagedUser({
        name: cleanName,
        email: cleanEmail,
        phone: phone.trim() || undefined,
        role: managedRole,
        active: true,
      });

      let accessEmailSent = true;
      try {
        await sendPasswordSetupEmail(cleanEmail);
      } catch {
        accessEmailSent = false;
      }

      setInviteOpen(false);
      setUserMessage(accessEmailSent
        ? `${cleanName} was created. Firebase sent ${cleanEmail} an email to set a private password.`
        : `${cleanName} was created. The account is secure, but the password setup email could not be sent; use “Send access email” below to retry.`);
      await loadUsers();
    } catch (error) {
      setUserError(errorText(error));
    } finally {
      setSavingInvite(false);
    }
  }

  async function toggleUser(user: ManagedUser) {
    setBusyUserId(user.uid);
    setUserError('');
    setUserMessage('');
    try {
      await updateManagedUser({
        uid: user.uid,
        name: user.name,
        email: user.email,
        phone: user.phone ?? undefined,
        role: user.role,
        active: !user.active,
      });
      setUserMessage(user.active ? `${user.name} can no longer sign in.` : `${user.name} was reactivated.`);
      await loadUsers();
    } catch (error) {
      setUserError(errorText(error));
    } finally {
      setBusyUserId('');
    }
  }

  async function resendAccess(user: ManagedUser) {
    setBusyUserId(user.uid);
    setUserError('');
    setUserMessage('');
    try {
      await sendPasswordSetupEmail(user.email);
      setUserMessage(`Firebase sent a password setup/reset email to ${user.email}.`);
    } catch (error) {
      setUserError(errorText(error));
    } finally {
      setBusyUserId('');
    }
  }

  return (
    <div className="ps-stack">
      <section className="page-head">
        <div>
          <div className="eyebrow">Security · Least Privilege</div>
          <h1>Access Control</h1>
          <p>ERP access requires an authorized Firebase account and an active DEMAC user profile. There is no public preview or guest mode.</p>
        </div>
        <div className="page-actions">
          <button className="btn" type="button" onClick={() => void loadUsers()} disabled={!canManageUsers || usersLoading}>{usersLoading ? 'Refreshing…' : 'Refresh Users'}</button>
          <button className="btn primary" type="button" onClick={openInvite} disabled={!canManageUsers}>Create User</button>
        </div>
      </section>

      <section className="ps-security-metrics">
        <article><span>Defined Roles</span><strong>{roles.length}</strong><small>Owner through Technician</small></article>
        <article><span>Authorized Users</span><strong>{canManageUsers ? activeUsers : 'Restricted'}</strong><small>{canManageUsers ? `${users.length} provisioned account${users.length === 1 ? '' : 's'}` : 'Owner-only administration'}</small></article>
        <article><span>High-Risk Actions</span><strong>Approval Only</strong><small className="ps-good">No autonomous money movement</small></article>
        <article><span>Production Auth</span><strong>Enforced</strong><small className="ps-good">Firebase email/password + active profile</small></article>
      </section>

      <section className="panel">
        <header className="panel-head">
          <div><h2>Users & Sign-In Access</h2><span>Only an administrator can create, disable, reactivate or resend access for ERP accounts.</span></div>
          <b>{canManageUsers ? 'Administrator' : 'Read only'}</b>
        </header>

        {!canManageUsers ? (
          <div style={{ padding: '18px' }}>Your current role can inspect access policy, but only the owner/administrator can manage sign-in accounts.</div>
        ) : (
          <div style={{ display: 'grid', gap: 12, padding: '16px' }}>
            <div style={{ border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
              <strong>Secure account model</strong>
              <p style={{ margin: '6px 0 0', opacity: 0.76 }}>Passwords are verified and stored by Firebase Authentication, not in the ERP source code. New users receive their own password setup email.</p>
            </div>

            {userMessage ? <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}><strong>{userMessage}</strong></div> : null}
            {userError ? <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}><strong>Access management error:</strong> {userError}</div> : null}
            {usersLoading && !users.length ? <div>Loading authorized users…</div> : null}
            {!usersLoading && !users.length ? <div>No provisioned users were returned.</div> : null}

            {users.map((user) => {
              const self = user.uid === principal.userId;
              return (
                <article key={user.uid} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 16, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 14, padding: 14 }}>
                  <div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <strong>{user.name}</strong>
                      <span>{user.active ? 'Active' : 'Disabled'}</span>
                      <span>· {managedRoleLabel(user.role)}</span>
                      {self ? <span>· Your account</span> : null}
                    </div>
                    <div style={{ marginTop: 4, opacity: 0.78 }}>{user.email}{user.phone ? ` · ${user.phone}` : ''}</div>
                    <small style={{ display: 'block', marginTop: 4, opacity: 0.68 }}>Last sign-in: {formatLastAccess(user.lastSignInAt)}</small>
                    {user.authMissing || user.profileMissing ? <small style={{ display: 'block', marginTop: 4 }}>Account needs repair: {user.authMissing ? 'missing Firebase Authentication account' : 'missing DEMAC user profile'}.</small> : null}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="btn" type="button" disabled={busyUserId === user.uid || !user.active || Boolean(user.authMissing)} onClick={() => void resendAccess(user)}>Send access email</button>
                    <button className="btn" type="button" disabled={busyUserId === user.uid || self || Boolean(user.authMissing)} onClick={() => void toggleUser(user)}>{user.active ? 'Disable' : 'Reactivate'}</button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="ps-access-layout">
        <aside className="panel ps-role-list">
          <header className="panel-head"><div><h2>Roles</h2><span>Select a role to inspect access</span></div></header>
          {roles.map((role) => <button className={selectedRole === role ? 'active' : ''} type="button" onClick={() => setSelectedRole(role)} key={role}><strong>{roleLabels[role]}</strong><span>{roleCapabilities[role].size} capabilities</span></button>)}
        </aside>

        <main className="panel ps-capability-panel">
          <header className="panel-head"><div><h2>{roleLabels[selectedRole]}</h2><span>Effective capability preview</span></div><b>{selected.size} allowed</b></header>
          <div className="ps-capability-groups">{capabilityGroups.map((group) => <section key={group.label}><h3>{group.label}</h3><div>{group.capabilities.map((capability) => <article className={selected.has(capability) ? 'allowed' : 'denied'} key={capability}><span>{selected.has(capability) ? '✓' : '—'}</span><strong>{labelCapability(capability)}</strong><small>{selected.has(capability) ? 'Allowed' : 'Not granted'}</small></article>)}</div></section>)}</div>
        </main>
      </section>

      <section className="ps-two-col">
        <article className="panel"><header className="panel-head"><div><h2>Enforcement Layers</h2><span>Defense in depth</span></div></header><div className="ps-rule-list"><div><strong>1 · Authentication</strong><span>Every ERP route requires a valid Firebase session and an active DEMAC profile.</span></div><div><strong>2 · Application services</strong><span>Sensitive commands check the required capability.</span></div><div><strong>3 · Database rules</strong><span>Firebase Security Rules independently enforce access.</span></div><div><strong>4 · Audit</strong><span>User provisioning and sensitive changes generate audit events.</span></div></div></article>
        <article className="panel"><header className="panel-head"><div><h2>Protected Decisions</h2><span>Explicit human authority</span></div></header><div className="ps-guardrails"><div><strong>Bank transfers / refunds</strong><span>Never autonomous</span></div><div><strong>Journal entries</strong><span>Finance approval</span></div><div><strong>Payroll-sensitive changes</strong><span>Restricted</span></div><div><strong>Destructive deletes</strong><span>Prefer archive + elevated approval</span></div><div><strong>Large purchases</strong><span>Approval threshold</span></div></div></article>
      </section>

      {inviteOpen ? (
        <div role="dialog" aria-modal="true" aria-label="Create ERP user" style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 24, background: 'rgba(0,0,0,.58)' }}>
          <div className="panel" style={{ width: 'min(680px, 100%)', maxHeight: '90vh', overflow: 'auto', padding: 20 }}>
            <header className="panel-head"><div><h2>Create ERP User</h2><span>This person will have no access until Firebase creates the account and DEMAC provisions the active user profile.</span></div></header>
            <div style={{ display: 'grid', gap: 14, marginTop: 16 }}>
              <label style={{ display: 'grid', gap: 6 }}><strong>Full name</strong><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Employee name" autoFocus /></label>
              <label style={{ display: 'grid', gap: 6 }}><strong>Sign-in email</strong><input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" type="email" autoCapitalize="none" /></label>
              <label style={{ display: 'grid', gap: 6 }}><strong>Phone (optional)</strong><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+297 ..." type="tel" /></label>
              <label style={{ display: 'grid', gap: 6 }}>
                <strong>Access role</strong>
                <select value={managedRole} onChange={(event) => setManagedRole(event.target.value as ManagedUserRole)}>
                  {managedRoleOptions.map((option) => <option key={option.value} value={option.value}>{option.label} — {option.description}</option>)}
                </select>
              </label>
              {userError ? <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>{userError}</div> : null}
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 4 }}>
                <button className="btn" type="button" disabled={savingInvite} onClick={() => setInviteOpen(false)}>Cancel</button>
                <button className="btn primary" type="button" disabled={savingInvite} onClick={() => void saveInvite()}>{savingInvite ? 'Creating…' : 'Create secure account'}</button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
