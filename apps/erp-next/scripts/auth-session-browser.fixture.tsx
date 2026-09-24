// Component/fault-injection harness only; never imported by an application route.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AuthProvider, useAuth } from '../components/auth/auth-provider';
import * as session from '../lib/firebase/session';

declare global {
  interface Window {
    authHarness: { current: ReturnType<typeof useAuth> | null; session: typeof session };
    draftMounts: number;
  }
}
window.authHarness = { current: null, session };
window.draftMounts = 0;
function Capture() {
  const [draft, setDraft] = useState('');
  useEffect(() => { window.draftMounts += 1; }, []);
  return <label>Capture draft<input aria-label="Capture draft" value={draft} onChange={(event) => setDraft(event.target.value)} /></label>;
}
function View() {
  const auth = useAuth();
  window.authHarness.current = auth;
  return <main>
    <h1>DEMAC · Session regression fixture</h1>
    <output data-testid="auth-state">{auth.mode}:{auth.status}:{auth.principal.userId}</output>
    <output data-testid="auth-error">{auth.error}</output>
    {auth.mode === 'firebase' && auth.principal.active ? <section aria-label="Protected capture" key={auth.principal.userId}>
      <h2>{auth.principal.displayName}</h2><Capture />
      <button onClick={() => void auth.refreshPrincipal().catch(() => undefined)}>Refresh profile</button>
    </section> : <p>ERP locked</p>}
    <button onClick={() => void auth.signIn('tech@demac-preview.invalid','synthetic-test-only-password').catch(() => undefined)}>Sign in technician</button>
    <button onClick={() => void auth.signIn('helper@demac-preview.invalid','synthetic-test-only-password').catch(() => undefined)}>Sign in helper</button>
    <button onClick={auth.signOut}>Sign out</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><AuthProvider><View /></AuthProvider></StrictMode>);
