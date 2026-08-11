'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isFirebaseClientConfigured } from '@/lib/firebase/client-config';
import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import { clearFirebaseWebSession, loadFirebaseWebSession, signInWithFirebaseEmail } from '@/lib/firebase/session';
import { roleLabels, type AuthPrincipal } from '@/lib/security';

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

  const lockSession = useCallback((message: string | null = null, nextStatus: AuthStatus = 'ready') => {
    clearFirebaseWebSession();
    setMode('signed_out');
    setPrincipal(signedOutPrincipal);
    setError(message);
    setStatus(nextStatus);
  }, []);

  const loadExistingSession = useCallback(async () => {
    if (!isFirebaseClientConfigured) {
      lockSession('Secure sign-in is not configured in this deployment. ERP access remains locked.', 'error');
      return;
    }
    if (!loadFirebaseWebSession()) {
      lockSession();
      return;
    }
    try {
      const nextPrincipal = await loadFirebasePrincipal();
      setPrincipal(nextPrincipal);
      setMode('firebase');
      setError(null);
      setStatus('ready');
    } catch (loadError) {
      lockSession(friendlyAuthError(loadError), 'error');
    }
  }, [lockSession]);

  useEffect(() => { void loadExistingSession(); }, [loadExistingSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (!isFirebaseClientConfigured) {
      const message = 'Secure sign-in is not configured in this deployment. ERP access remains locked.';
      lockSession(message, 'error');
      throw new Error(message);
    }
    setStatus('loading');
    setError(null);
    try {
      await signInWithFirebaseEmail(email.trim(), password);
      const nextPrincipal = await loadFirebasePrincipal();
      setPrincipal(nextPrincipal);
      setMode('firebase');
      setStatus('ready');
    } catch (signInError) {
      const message = friendlyAuthError(signInError);
      lockSession(message, 'error');
      throw new Error(message);
    }
  }, [lockSession]);

  const signOut = useCallback(() => {
    lockSession();
  }, [lockSession]);

  const refreshPrincipal = useCallback(async () => {
    if (mode !== 'firebase') throw new Error('Authentication is required.');
    try {
      const nextPrincipal = await loadFirebasePrincipal();
      setPrincipal(nextPrincipal);
      setError(null);
    } catch (refreshError) {
      const message = friendlyAuthError(refreshError);
      lockSession(message, 'error');
      throw new Error(message);
    }
  }, [lockSession, mode]);

  const value = useMemo<AuthContextValue>(() => ({
    mode,
    status,
    principal,
    firebaseConfigured: isFirebaseClientConfigured,
    error,
    signIn,
    signOut,
    refreshPrincipal,
  }), [error, mode, principal, refreshPrincipal, signIn, signOut, status]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}

export function principalRoleLabel(principal: AuthPrincipal) {
  return roleLabels[principal.role];
}
