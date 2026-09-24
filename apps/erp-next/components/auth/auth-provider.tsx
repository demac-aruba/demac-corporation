'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isFirebaseClientConfigured } from '@/lib/firebase/client-config';
import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import { clearFirebaseWebSession, loadFirebaseWebSession, signInWithFirebaseEmail, FirebaseSessionSupersededError } from '@/lib/firebase/session';
import { roleLabels, type AuthPrincipal } from '@/lib/security';
import { isTransientFirebaseError } from '@/lib/firebase/request-error';
import recoveryStyles from './auth-recovery.module.css';

export type AuthMode = 'signed_out' | 'firebase';

type AuthStatus = 'loading' | 'ready' | 'error';

type AuthContextValue = {
  mode: AuthMode;
  status: AuthStatus;
  principal: AuthPrincipal;
  firebaseConfigured: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  refreshPrincipal: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const signedOutPrincipal: AuthPrincipal = {
  userId: 'signed-out',
  displayName: 'Signed out',
  role: 'auditor',
  active: false,
  capabilities: new Set(),
};

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/i.test(message)) return 'The email or password is not valid.';
  if (/TOO_MANY_ATTEMPTS/i.test(message)) return 'Too many sign-in attempts. Try again later.';
  if (/USER_DISABLED/i.test(message)) return 'This Firebase user account is disabled.';
  if (/profile.+not provisioned|not provisioned/i.test(message)) return 'This account is not authorized for DEMAC ERP. Ask an administrator to create or enable the ERP user profile.';
  if (/inactive/i.test(message)) return 'This DEMAC ERP account is inactive.';
  if (/role.+not recognized|unrecognized role/i.test(message)) return 'This DEMAC ERP account does not have a recognized access role.';
  if (/not configured/i.test(message)) return 'Secure sign-in is not configured in this deployment. ERP access remains locked.';
  return message;
}

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mode, setMode] = useState<AuthMode>('signed_out');
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [principal, setPrincipal] = useState<AuthPrincipal>(signedOutPrincipal);
  const [error, setError] = useState<string | null>(null);
  const [recoverable, setRecoverable] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const operation = useRef(0);
  const principalFlight = useRef<{ operation: number; promise: Promise<void> } | null>(null);
  const verifiedPrincipal = useRef<AuthPrincipal>(signedOutPrincipal);

  const lockSession = useCallback((message: string | null = null, nextStatus: AuthStatus = 'ready') => {
    operation.current += 1;
    principalFlight.current = null;
    // UI access must still lock when browser storage is unavailable.
    try { clearFirebaseWebSession(); } catch { /* Do not fall back to another token store. */ }
    verifiedPrincipal.current = signedOutPrincipal;
    setMode('signed_out');
    setPrincipal(signedOutPrincipal);
    setError(message);
    setStatus(nextStatus);
    setRecoverable(false);
    setRetrying(false);
  }, []);

  const verifySession = useCallback(async (id: number, uid: string) => {
    try {
      const nextPrincipal = await loadFirebasePrincipal();
      if (id !== operation.current) throw new FirebaseSessionSupersededError();
      if (loadFirebaseWebSession()?.uid !== uid || nextPrincipal.userId !== uid) {
        throw new Error('Authentication response identity mismatch.');
      }
      verifiedPrincipal.current = nextPrincipal;
      setPrincipal(nextPrincipal);
      setMode('firebase');
      setError(null);
      setStatus('ready');
      setRecoverable(false);
    } catch (failure) {
      if (id !== operation.current || failure instanceof FirebaseSessionSupersededError) throw failure;
      const message = friendlyAuthError(failure);
      let sameSession = false;
      try { sameSession = loadFirebaseWebSession()?.uid === uid; } catch { /* Storage failure is not authorization. */ }
      if (isTransientFirebaseError(failure) && sameSession) {
        // Only an already-verified principal stays visible. A stored token is NOT
        // permission to open the ERP on a fresh load before its profile is checked.
        const hasVerifiedPrincipal = verifiedPrincipal.current.active && verifiedPrincipal.current.userId === uid;
        setStatus(hasVerifiedPrincipal ? 'ready' : 'error');
        setError(message);
        setRecoverable(true);
      } else {
        lockSession(message, 'error');
      }
      throw failure;
    } finally {
      if (id === operation.current) setRetrying(false);
    }
  }, [lockSession]);

  const loadExistingSession = useCallback((): Promise<void> => {
    // Two consumers revalidating the same session share one result; a late denial
    // cannot be discarded merely because another same-session refresh started.
    if (principalFlight.current?.operation === operation.current) return principalFlight.current.promise;
    const id = ++operation.current;
    const promise = (async () => {
      if (!isFirebaseClientConfigured) {
        lockSession('Secure sign-in is not configured in this deployment. ERP access remains locked.', 'error');
        return;
      }
      let session;
      try { session = loadFirebaseWebSession(); }
      catch { lockSession('Browser session storage is unavailable. Secure access remains locked.', 'error'); return; }
      if (!session) { lockSession(); return; }
      setRetrying(true);
      if (!verifiedPrincipal.current.active) setStatus('loading');
      await verifySession(id, session.uid);
    })();
    principalFlight.current = { operation: id, promise };
    const release = () => { if (principalFlight.current?.promise === promise) principalFlight.current = null; };
    void promise.then(release, release);
    return promise;
  }, [lockSession, verifySession]);

  useEffect(() => {
    void loadExistingSession().catch(() => undefined);
    return () => { operation.current += 1; };
  }, [loadExistingSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    const id = ++operation.current;
    if (!isFirebaseClientConfigured) {
      const message = 'Secure sign-in is not configured in this deployment. ERP access remains locked.';
      lockSession(message, 'error');
      throw new Error(message);
    }
    // Never retain one employee's visible principal while another signs in.
    verifiedPrincipal.current = signedOutPrincipal;
    setPrincipal(signedOutPrincipal);
    setMode('signed_out');
    setStatus('loading');
    setError(null);
    setRecoverable(false);
    setRetrying(false);
    let uid: string;
    try {
      const session = await signInWithFirebaseEmail(email.trim(), password);
      if (id !== operation.current) throw new FirebaseSessionSupersededError();
      uid = session.uid;
    } catch (signInError) {
      if (id === operation.current && !(signInError instanceof FirebaseSessionSupersededError)) {
        lockSession(friendlyAuthError(signInError), 'error');
      }
      throw new Error(friendlyAuthError(signInError));
    }
    await verifySession(id, uid);
  }, [lockSession, verifySession]);

  const signOut = useCallback(() => { lockSession(); }, [lockSession]);

  const refreshPrincipal = useCallback(async () => {
    if (mode !== 'firebase') throw new Error('Authentication is required.');
    await loadExistingSession();
  }, [loadExistingSession, mode]);

  const value = useMemo<AuthContextValue>(() => ({
    mode, status, principal, firebaseConfigured: isFirebaseClientConfigured,
    error, signIn, signOut, refreshPrincipal,
  }), [error, mode, principal, refreshPrincipal, signIn, signOut, status]);

  return <AuthContext.Provider value={value}>
    {recoverable ? <aside className={recoveryStyles.notice} role="status" aria-live="polite">
      <div><strong>Conexión pendiente de verificar</strong><p>{mode === 'firebase'
        ? 'Tu captura sigue abierta. Los cambios solo están guardados cuando el servidor los confirma.'
        : 'El acceso sigue bloqueado hasta verificar tu cuenta. Puedes reintentar sin volver a escribir la contraseña.'}</p></div>
      <button type="button" disabled={retrying} onClick={() => void loadExistingSession().catch(() => undefined)}>
        {retrying ? 'Verificando…' : 'Reintentar conexión'}
      </button>
    </aside> : null}
    {children}
  </AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}

export function principalRoleLabel(principal: AuthPrincipal) {
  return roleLabels[principal.role];
}
