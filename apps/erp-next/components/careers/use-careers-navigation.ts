'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export type CareerView = 'jobs' | 'detail' | 'form' | 'success' | 'admin';
export type RecruitmentTab = 'applications' | 'vacancies' | 'settings';
export interface CareerRoute {
  view: CareerView;
  role?: string;
  step?: number;
  reviewing?: boolean;
  receipt?: string;
  tab?: RecruitmentTab;
  candidate?: string;
}
interface Entry { id: number; parent: number | null; route: CareerRoute; scroll: number; focus: string | null }
const stateKey = 'demacCareersNavigation';
const stages = ['details', 'experience', 'documents', 'review'];
const ownedParams = ['view', 'role', 'step', 'receipt', 'tab', 'candidate'];
export function routeKey(route: CareerRoute): string {
  return [route.view, route.role || '', route.step ?? '', route.reviewing ? 'review' : '', route.receipt || '', route.tab || '', route.candidate || ''].join('|');
}
function readRoute(): CareerRoute {
  const params = new URLSearchParams(window.location.search);
  if (params.get('view') === 'admin') {
    const tab = params.get('tab');
    return { view: 'admin', tab: tab === 'vacancies' || tab === 'settings' ? tab : 'applications', candidate: params.get('candidate') || undefined };
  }
  if (params.has('receipt')) return { view: 'success', receipt: params.get('receipt') || undefined };
  const role = params.get('role');
  if (!role) return { view: 'jobs' };
  if (!params.has('step')) return { view: 'detail', role };
  const index = stages.indexOf(params.get('step') || '');
  return { view: 'form', role, step: Math.max(0, Math.min(index, 2)), reviewing: index === 3 };
}
function routeUrl(route: CareerRoute): string {
  const url = new URL(window.location.href);
  ownedParams.forEach(key => url.searchParams.delete(key));
  if (route.view === 'detail' || route.view === 'form') url.searchParams.set('role', route.role || '');
  if (route.view === 'form') url.searchParams.set('step', stages[route.reviewing ? 3 : route.step || 0]);
  if (route.view === 'success') url.searchParams.set('receipt', route.receipt || '');
  if (route.view === 'admin') {
    url.searchParams.set('view', 'admin');
    url.searchParams.set('tab', route.tab || 'applications');
    if (route.candidate) url.searchParams.set('candidate', route.candidate);
  }
  url.hash = '';
  return `${url.pathname}${url.search}`;
}
/** Native browser history, integrated with Next's supported History API.
 * Only route identifiers are put in URLs/history.state. Drafts, files, contact
 * details and scroll/focus snapshots remain in component memory, never storage.
 */
export function useCareersNavigation(normalize: (route: CareerRoute) => CareerRoute) {
  const [screen, setScreen] = useState<{ route: CareerRoute; ready: boolean; revision: number }>({ route: { view: 'jobs' }, ready: false, revision: 0 });
  const normalizer = useRef(normalize);
  normalizer.current = normalize;
  const entries = useRef(new Map<number, Entry>());
  const current = useRef<Entry | null>(null);
  const sequence = useRef(0);
  const session = useRef('');
  const restoring = useRef(false);
  const pendingPosition = useRef<{ entry: Entry; restore: boolean } | null>(null);
  const savePosition = useCallback(() => {
    if (!current.current || restoring.current) return;
    current.current.scroll = window.scrollY;
    current.current.focus = document.activeElement?.getAttribute('data-career-focus') || null;
  }, []);
  const publish = useCallback((entry: Entry, restore: boolean) => {
    current.current = entry;
    restoring.current = true;
    pendingPosition.current = { entry, restore };
    setScreen(previous => ({ route: entry.route, ready: true, revision: previous.revision + 1 }));
  }, []);
  // Run against the committed DOM before it becomes interactive. A delayed rAF
  // focus can steal focus after a user (or browser automation) starts typing.
  useLayoutEffect(() => {
    const pending = pendingPosition.current;
    if (!screen.ready || !pending) return;
    pendingPosition.current = null;
    const { entry, restore } = pending;
    const target = restore && entry.focus
      ? Array.from(document.querySelectorAll<HTMLElement>('[data-career-focus]')).find(element => element.getAttribute('data-career-focus') === entry.focus)
      : document.querySelector<HTMLElement>('[data-career-page-title], main h1');
    target?.focus({ preventScroll: true });
    window.scrollTo({ top: restore ? entry.scroll : 0, behavior: 'instant' });
    restoring.current = false;
  }, [screen.ready, screen.revision]);
  useEffect(() => {
    const pathname = window.location.pathname;
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    session.current = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const initial: Entry = { id: ++sequence.current, parent: null, route: normalizer.current(readRoute()), scroll: 0, focus: null };
    entries.current.set(initial.id, initial);
    window.history.replaceState({ [stateKey]: { session: session.current, id: initial.id } }, '', routeUrl(initial.route));
    publish(initial, false);
    const onPopState = () => {
      if (window.location.pathname !== pathname) return;
      const marker = window.history.state?.[stateKey];
      const existing = marker?.session === session.current ? entries.current.get(marker.id) : undefined;
      const requested = readRoute();
      const resolved = normalizer.current(requested);
      const entry: Entry = existing || { id: ++sequence.current, parent: null, route: resolved, scroll: 0, focus: null };
      entry.route = resolved;
      entries.current.set(entry.id, entry);
      if (!existing || routeKey(requested) !== routeKey(resolved)) {
        window.history.replaceState({ [stateKey]: { session: session.current, id: entry.id } }, '', routeUrl(resolved));
      }
      publish(entry, true);
    };
    const onScroll = () => { if (current.current && !restoring.current) current.current.scroll = window.scrollY; };
    window.addEventListener('popstate', onPopState);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('scroll', onScroll);
      window.history.scrollRestoration = previousRestoration;
    };
  }, [publish]);
  const navigate = useCallback((requested: CareerRoute, replace = false) => {
    const resolved = normalizer.current(requested);
    if (current.current && routeKey(current.current.route) === routeKey(resolved)) return;
    savePosition();
    const entry: Entry = { id: ++sequence.current, parent: replace ? current.current?.parent ?? null : current.current?.id ?? null, route: resolved, scroll: 0, focus: null };
    entries.current.set(entry.id, entry);
    window.history[replace ? 'replaceState' : 'pushState']({ [stateKey]: { session: session.current, id: entry.id } }, '', routeUrl(resolved));
    publish(entry, false);
  }, [publish, savePosition]);
  const backTo = useCallback((fallback: CareerRoute) => {
    savePosition();
    let ancestor = current.current;
    let distance = 0;
    const marker = window.history.state?.[stateKey];
    while (marker?.session === session.current && ancestor?.parent != null && distance < 100) {
      ancestor = entries.current.get(ancestor.parent) || null;
      distance += 1;
      if (ancestor && routeKey(ancestor.route) === routeKey(fallback)) { window.history.go(-distance); return; }
    }
    // Direct role URLs have no in-module parent. Never send them to an unrelated
    // origin or add sentinel entries that trap the browser Back button.
    navigate(fallback);
  }, [navigate, savePosition]);
  return { ...screen, navigate, backTo };
}
