'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth-provider';

export function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, status, principal } = useAuth();
  const authenticated = mode === 'firebase' && status === 'ready' && principal.active;

  useEffect(() => {
    if (status === 'loading') return;
    if (!authenticated) {
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${next}`);
    }
  }, [authenticated, pathname, router, status]);

  if (!authenticated) {
    return (
      <main className="auth-lock-screen" aria-live="polite">
        <div className="auth-lock-card">
          <div className="auth-brand-mark">D</div>
          <strong>{status === 'loading' ? 'Securing DEMAC ERP…' : 'Authentication required'}</strong>
          <span>{status === 'loading' ? 'Checking your authorized session.' : 'Redirecting to secure sign-in.'}</span>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
