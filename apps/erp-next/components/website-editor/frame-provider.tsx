'use client';

import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { EDITOR_PATH, EDITOR_PROTOCOL, isEditorEnabled, isOwner, sameMessage, type EditorialChange, type EditorialField } from '@/lib/website-editor/contract';
import type { PublicVrfContent } from '@/lib/public-vrf-content';

const Overlays = lazy(() => import('./frame-overlays'));
type FrameContext = { active: boolean; editing: boolean; changes: EditorialChange[]; register: (pageId: string, content: PublicVrfContent, fields: EditorialField[]) => void; select: (field: string) => void };
const idle = { active: false, editing: false, changes: [], register: () => {}, select: () => {} } satisfies FrameContext;
const Context = createContext<FrameContext>(idle);

export function WebsiteFrameProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { principal, mode } = useAuth();
  const [session, setSession] = useState<{ channel: string; editing: boolean } | null>(null);
  const [changes, setChanges] = useState<EditorialChange[]>([]);
  const pageRef = useRef<{ pageId: string; content: PublicVrfContent; fields: EditorialField[] } | null>(null);
  const allowed = isEditorEnabled() && isOwner(principal, mode);
  const active = Boolean(session && allowed);
  const channel = session?.channel;
  const send = useCallback((payload: Record<string, unknown>) => {
    if (channel && allowed && window.parent !== window) window.parent.postMessage({ protocol: EDITOR_PROTOCOL, channel, ...payload }, window.location.origin);
  }, [channel, allowed]);
  const register = useCallback((pageId: string, content: PublicVrfContent, fields: EditorialField[]) => {
    pageRef.current = { pageId, content, fields };
    send({ type: 'page', pageId, content, fields, pathname });
  }, [send, pathname]);
  const select = useCallback((key: string) => send({ type: 'select', key }), [send]);

  useEffect(() => {
    // Normal visits, including authenticated top-level visits, never listen for
    // editor commands and never import the overlay implementation.
    if (!allowed || window.parent === window) { setSession(null); setChanges([]); return; }
    try { if (window.parent.location.origin !== location.origin || window.parent.location.pathname !== EDITOR_PATH) return; } catch { return; }
    function receive(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.protocol !== EDITOR_PROTOCOL) return;
      if (event.data.type === 'initialize' && typeof event.data.channel === 'string' && /^[0-9a-f-]{36}$/.test(event.data.channel)) {
        setSession((current) => current?.channel === event.data.channel ? current : { channel: event.data.channel, editing: true }); return;
      }
      if (!channel || !sameMessage(event, window.parent, channel)) return;
      if (event.data.type === 'state') {
        if (event.data.pageId !== 'vrf' || pathname !== '/services/vrf-systems/' && pathname !== '/services/vrf-systems') return;
        if (!Array.isArray(event.data.changes) || event.data.changes.length > 250) return;
        setChanges(event.data.changes);
        const editing = event.data.editing === true;
        setSession((current) => current && current.editing !== editing ? { ...current, editing } : current);
      }
      if (event.data.type === 'stop') { setSession(null); setChanges([]); }
      if (event.data.type === 'locate' && typeof event.data.key === 'string') {
        const node = [...document.querySelectorAll<HTMLElement>('[data-website-text], [data-website-image]')].find((item) => {
          const keyMatches = item.dataset.websiteText === event.data.key || item.dataset.websiteImage === event.data.key;
          const presentation = item.closest<HTMLElement>('[data-vrf-mobile], [data-vrf-desktop]');
          return keyMatches && (!presentation || presentation.getClientRects().length > 0);
        });
        if (node) {
          node.closest('details')?.setAttribute('open', '');
          const panel = node.closest<HTMLElement>('[role="tabpanel"]');
          if (panel?.hidden) [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.getAttribute('aria-controls') === panel.id)?.click();
          requestAnimationFrame(() => node.scrollIntoView({ block: 'center', behavior: 'smooth' }));
        }
      }
    }
    window.addEventListener('message', receive);
    window.parent.postMessage({ protocol: EDITOR_PROTOCOL, type: 'frame-ready' }, location.origin);
    return () => window.removeEventListener('message', receive);
  }, [allowed, channel, pathname]);

  useEffect(() => { if (!active) return; setChanges([]); send({ type: 'route', pathname }); }, [active, pathname, send]);
  useEffect(() => {
    if (!active) return;
    const preventLiveSubmission = (event: SubmitEvent) => { event.preventDefault(); event.stopImmediatePropagation(); send({ type: 'form-blocked' }); };
    document.addEventListener('submit', preventLiveSubmission, true);
    return () => document.removeEventListener('submit', preventLiveSubmission, true);
  }, [active, send]);
  const value = useMemo(() => ({ active, editing: active && Boolean(session?.editing), changes, register, select }), [active, session?.editing, changes, register, select]);
  return <Context.Provider value={value}>{children}{active && session?.editing && /^\/services\/vrf-systems\/?$/.test(pathname) ? <Suspense fallback={null}><Overlays onSelect={select} /></Suspense> : null}</Context.Provider>;
}
export function useWebsiteFrame() { return useContext(Context); }
