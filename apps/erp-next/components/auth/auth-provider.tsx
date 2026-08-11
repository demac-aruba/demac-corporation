'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isFirebaseClientConfigured } from '@/lib/firebase/client-config';
import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import { clearFirebaseWebSession, loadFirebaseWebSession, signInWithFirebaseEmail } from '@/lib/firebase/session';
import { previewPrincipal, roleLabels, type AuthPrincipal } from '@/lib/security';

export type AuthMode = 'preview' | 'firebase';

type AuthContextValue = {
  mode: AuthMode;
  status: 'loading' | 'ready' | 'error';
  principal: AuthPrincipal;
  firebaseConfigured: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => void;
  usePreviewMode: () => void;
  refreshPrincipal: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function friendlyAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/i.test(message)) return 'The email or password is not valid.';
  if (/TOO_MANY_ATTEMPTS/i.test(message)) return 'Too many sign-in attempts. Try again later.';
  if (/USER_DISABLED/i.test(message)) return 'This Firebase user account is disabled.';
  if (/not configured/i.test(message)) return 'Firebase client configuration is not available in this deployment.';
  return message;
}

export function AuthProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [mode, setMode] = useState<AuthMode>('preview');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [principal, setPrincipal] = useState<AuthPrincipal>(previewPrincipal);
  const [error, setError] = useState<string | null>(null);

  const loadExistingSession = useCallback(async () => {
    if (!isFirebaseClientConfigured || !loadFirebaseWebSession()) {
      setMode('preview');
      setPrincipal(previewPrincipal);
      setStatus('ready');
      return;
    }
    try {
      const nextPrincipal = await loadFirebasePrincipal();
      setPrincipal(nextPrincipal);
      setMode('firebase');
      setError(null);
      setStatus('ready');
    } catch (loadError) {
      clearFirebaseWebSession();
      setMode('preview');
      setPrincipal(previewPrincipal);
      setError(friendlyAuthError(loadError));
      setStatus('ready');
    }
  }, []);

  useEffect(() => { void loadExistingSession(); }, [loadExistingSession]);

  const signIn = useCallback(async (email: string, password: string) => {
    setStatus('loading');
    setError(null);
    try {
      await signInWithFirebaseEmail(email.trim(), password);
      const nextPrincipal = await loadFirebasePrincipal();
      if (!nextPrincipal.active) throw new Error('This ERP user profile is inactive.');
      setPrincipal(nextPrincipal);
      setMode('firebase');
      setStatus('ready');
    } catch (signInError) {
      clearFirebaseWebSession();
      setMode('preview');
      setPrincipal(previewPrincipal);
      const message = friendlyAuthError(signInError);
      setError(message);
      setStatus('error');
      throw new Error(message);
    }
  }, []);

  const signOut = useCallback(() => {
    clearFirebaseWebSession();
    setPrincipal(previewPrincipal);
    setMode('preview');
    setError(null);
    setStatus('ready');
  }, []);

  const usePreviewMode = useCallback(() => {
    clearFirebaseWebSession();
    setPrincipal(previewPrincipal);
    setMode('preview');
    setError(null);
    setStatus('ready');
  }, []);

  const refreshPrincipal = useCallback(async () => {
    if (mode !== 'firebase') return;
    const nextPrincipal = await loadFirebasePrincipal();
    setPrincipal(nextPrincipal);
  }, [mode]);

  const value = useMemo<AuthContextValue>(() => ({
    mode,
    status,
    principal,
    firebaseConfigured: isFirebaseClientConfigured,
    error,
    signIn,
    signOut,
    usePreviewMode,
    refreshPrincipal,
  }), [error, mode, principal, refreshPrincipal, signIn, signOut, status, usePreviewMode]);

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
