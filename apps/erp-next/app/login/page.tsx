'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';

export default function LoginPage() {
  const router = useRouter();
  const { firebaseConfigured, mode, principal, signIn, usePreviewMode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firebaseConfigured || !email.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email, password);
      router.push('/dashboard');
    } catch (signInError) {
      setError(signInError instanceof Error ? signInError.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  const continuePreview = () => {
    usePreviewMode();
    router.push('/dashboard');
  };

  return (
    <main className="auth-page">
      <section className="auth-brand-panel">
        <div className="auth-brand"><div className="auth-brand-mark">D</div><div><strong>DEMAC</strong><span>ERP NEXT</span></div></div>
        <div className="auth-brand-copy">
          <div className="eyebrow">Professional Cooling Solutions</div>
          <h1>One operating system for DEMAC.</h1>
          <p>Customers, dispatch, field work, inventory, communications, finance, projects and management intelligence—designed as one governed company system.</p>
          <div className="auth-brand-points"><div><strong>Role-aware</strong><span>Every user sees the right operational surface.</span></div><div><strong>Evidence-driven</strong><span>Transactions and audit history stay traceable.</span></div><div><strong>AI governed</strong><span>AI interprets and prepares; humans approve sensitive actions.</span></div><div><strong>Live + Field</strong><span>Office and technician workflows share the same business model.</span></div></div>
        </div>
        <div className="auth-security-note"><i /><span>Firebase authentication is optional during the rebuild; real-data mode will require authenticated access before production activation.</span></div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-card">
          <header className="auth-card-head"><span>Secure Access</span><h2>Sign in to ERP Next</h2><p>Use an authorized Firebase account when the production connection is ready, or continue in Preview Owner mode while we finish the rebuild.</p></header>

          <div className={`auth-config-status ${firebaseConfigured ? 'ready' : ''}`}><i /><div><strong>{firebaseConfigured ? 'Firebase client configuration detected' : 'Firebase sign-in is not active in this build'}</strong><span>{firebaseConfigured ? 'The existing Vercel/Firebase public configuration was detected. Sign-in uses Firebase Authentication; Firestore writes still depend on the final Security Rules review.' : 'ERP Next remains safely available in Preview Owner mode. No Firebase Console change is required to keep reviewing the product.'}</span></div></div>

          {mode === 'firebase' ? <div className="auth-config-status ready"><i /><div><strong>Already signed in</strong><span>{principal.displayName} · {principal.role}</span></div></div> : null}

          <form className="auth-form" onSubmit={submit}>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!firebaseConfigured || busy} placeholder="Authorized DEMAC email" /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!firebaseConfigured || busy} placeholder="Password" /></label>
            {error ? <div className="auth-error">{error}</div> : null}
            <button className="auth-primary" type="submit" disabled={!firebaseConfigured || busy || !email.trim() || !password}>{busy ? 'Signing in…' : 'Sign in with Firebase'}</button>
          </form>

          <div className="auth-divider">or</div>
          <button className="auth-preview-btn" type="button" onClick={continuePreview}>Continue in Preview Owner Mode</button>
          <p className="auth-footnote">Preview mode uses structured/browser test data only. It is intentionally not treated as authenticated production access.</p>
        </div>
      </section>
    </main>
  );
}
