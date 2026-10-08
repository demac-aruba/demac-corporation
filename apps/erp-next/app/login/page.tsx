'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { defaultAuthenticatedRoute } from '@/lib/role-routing';

export default function LoginPage() {
  const router = useRouter();
  const { firebaseConfigured, mode, principal, status, error: sessionError, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === 'firebase' && status === 'ready' && principal.active) {
      router.replace(defaultAuthenticatedRoute(principal.role));
    }
  }, [mode, principal.active, principal.role, router, status]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firebaseConfigured || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const visibleError = error ?? (status === 'error' ? sessionError : null);

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><div className="auth-brand-mark">D</div><div><strong>DEMAC</strong><span>ERP NEXT</span></div></div>
        <div className="auth-brand-copy">
          <div className="eyebrow">Professional Cooling Solutions</div>
          <h1>One operating system for DEMAC.</h1>
          <p>Secure access to customers, dispatch, field work, inventory, communications, finance, projects and management intelligence.</p>
          <div className="auth-brand-points"><div><strong>Authorized users only</strong><span>Every account must exist in Firebase Authentication and the DEMAC ERP user registry.</span></div><div><strong>Role-aware</strong><span>Each user sees only the operational surfaces allowed by their role.</span></div><div><strong>Session protected</strong><span>ERP modules remain locked when a valid authenticated session is not present.</span></div><div><strong>Auditable access</strong><span>User identity follows the same governed account model used by DEMAC.</span></div></div>
        </div>
        <div className="auth-security-note"><i /><span>DEMAC ERP is private. Authentication is required before any internal ERP module is displayed.</span></div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <header className="auth-card-head"><span>Secure Access</span><h2>Sign in to DEMAC ERP</h2><p>Use your authorized DEMAC email and password. Accounts must be explicitly provisioned and enabled by an administrator.</p></header>

          <div className={`auth-config-status ${firebaseConfigured ? 'ready' : ''}`}><i /><div><strong>{firebaseConfigured ? 'Secure Firebase sign-in is active' : 'Secure sign-in is unavailable'}</strong><span>{firebaseConfigured ? 'Your password is verified directly by Firebase Authentication and is never stored in ERP Next code.' : 'ERP access is locked because the Firebase authentication configuration is not available in this deployment.'}</span></div></div>

          {mode === 'firebase' ? <div className="auth-config-status ready"><i /><div><strong>Authenticated session detected</strong><span>{principal.displayName} · opening your authorized ERP workspace…</span></div></div> : null}

          <form className="auth-form" onSubmit={submit}>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!firebaseConfigured || busy} placeholder="Authorized DEMAC email" /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!firebaseConfigured || busy} placeholder="Password" /></label>
            {visibleError ? <div className="auth-error">{visibleError}</div> : null}
            <button className="auth-primary" type="submit" disabled={!firebaseConfigured || busy || !email.trim() || !password}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
          </form>

          <p className="auth-footnote">There is no public preview or guest access. If you need a new account, an authorized DEMAC administrator must create it.</p>
        </div>
      </section>
    </main>
  );
}
