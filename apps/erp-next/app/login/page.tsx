'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { defaultAuthenticatedRoute } from '@/lib/role-routing';
import { FieldPortalHeader, PortalIcon, fieldPortalStyles as styles } from '@/components/field/field-portal-chrome';

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
    <main className={`${styles.portal} ${styles.loginPortal}`}>
      <FieldPortalHeader title="Acceso a DEMAC" />
      <section className={styles.loginSurface}>
        <h2>Iniciar sesión</h2>
        <p className={styles.loginIntro}>Accede con tu cuenta personal de DEMAC. Tu espacio se abrirá según tu asignación y tus permisos.</p>
        {!firebaseConfigured ? <div className={styles.error} role="alert">El acceso seguro no está configurado. Contacta a administración.</div> : null}
        {mode === 'firebase' ? <div className={styles.notice} role="status"><PortalIcon name="check" /><span>{principal.displayName} · Abriendo tu espacio autorizado…</span></div> : null}
        <form className={styles.loginForm} onSubmit={submit}>
          <label>Correo electrónico<input aria-label="Email" type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!firebaseConfigured || busy} placeholder="Tu correo autorizado" required /></label>
          <label>Contraseña<input aria-label="Password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!firebaseConfigured || busy} placeholder="Tu contraseña" required /></label>
          {visibleError ? <div className={styles.error} role="alert">{visibleError}</div> : null}
          <button className={styles.primary} type="submit" aria-label="Sign in securely" disabled={!firebaseConfigured || busy || !email.trim() || !password}><PortalIcon name="lock" />{busy ? 'Iniciando sesión…' : 'Entrar a mi cuenta'}</button>
        </form>
        <div className={styles.notice}><PortalIcon name="users" /><span>Técnicos y ayudantes usan cuentas individuales. No compartas tu contraseña.</span></div>
        <p className={styles.loginFooter}>Acceso solo para personal autorizado.<br />Para activar o recuperar tu cuenta, contacta a administración.</p>
      </section>
    </main>
  );
}
