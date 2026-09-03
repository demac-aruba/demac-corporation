'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { defaultAuthenticatedRoute, isAuthenticatedRouteAllowed } from '@/lib/role-routing';
import { useAuth } from './auth-provider';

export function AuthGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const { mode, status, principal } = useAuth();
  const authenticated = mode === 'firebase' && status === 'ready' && principal.active;
  const routeAllowed = authenticated && isAuthenticatedRouteAllowed(pathname ?? '/', principal.role);

  useEffect(() => {
    if (status === 'loading') return;
    if (!authenticated) {
      const next = pathname && pathname !== '/' ? `?next=${encodeURIComponent(pathname)}` : '';
      router.replace(`/login${next}`);
      return;
    }
    if (!routeAllowed) router.replace(defaultAuthenticatedRoute(principal.role));
  }, [authenticated, pathname, principal.role, routeAllowed, router, status]);

  if (!authenticated || !routeAllowed) {
    return (
      <main className="auth-lock-screen" aria-live="polite">
        <div className="auth-lock-card">
          <div className="auth-brand-mark">D</div>
          <strong>{status === 'loading' ? 'Securing DEMAC ERP…' : authenticated ? 'Opening your authorized workspace…' : 'Authentication required'}</strong>
          <span>{status === 'loading' ? 'Checking your authorized session.' : authenticated ? 'Redirecting to the ERP surface assigned to your role.' : 'Redirecting to secure sign-in.'}</span>
        </div>
      </main>
    );
  }

  return <>{children}</>;
}
