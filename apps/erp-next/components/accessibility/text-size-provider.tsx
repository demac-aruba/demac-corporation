'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { loadBrowserUserPreferences, normalizeTextSizeOffset, saveBrowserUserPreferences, type TextSizeOffset } from '@/lib/user-preferences';

type AccessibilityTextContextValue = {
  textSizeOffset: TextSizeOffset;
  setTextSizeOffset: (value: number) => void;
  increaseTextSize: () => void;
  decreaseTextSize: () => void;
  resetTextSize: () => void;
};

const AccessibilityTextContext = createContext<AccessibilityTextContextValue | null>(null);
const offsetVariable = '--demac-accessibility-text-offset';
const explicitControlSelector = 'input,select,textarea,button,kbd';

type TrackedTextElement = {
  element: HTMLElement;
  baseSize: number;
  originalInlineSize: string;
  originalInlinePriority: string;
};

function canScale(element: HTMLElement) {
  if (!element.closest('.erp-frame')) return false;
  if (element.closest('h1,h2,h3')) return false;
  if (element.closest('[data-demac-text-scale="ignore"]')) return false;
  if (element.closest('svg')) return false;
  return !['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(element.tagName);
}

function hasDirectReadableText(element: HTMLElement) {
  return Array.from(element.childNodes).some((node) => node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim()));
}

function collectTargets(root: Node) {
  const targets = new Set<HTMLElement>();
  const consider = (element: HTMLElement | null) => {
    if (!element || !canScale(element)) return;
    if (hasDirectReadableText(element) || element.matches(explicitControlSelector)) targets.add(element);
  };

  if (root.nodeType === Node.TEXT_NODE) consider(root.parentElement);
  if (root instanceof HTMLElement) consider(root);

  if (root instanceof Element || root instanceof Document || root instanceof DocumentFragment) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let current: Node | null = walker.nextNode();
    while (current) {
      consider(current.parentElement);
      current = walker.nextNode();
    }
    root.querySelectorAll<HTMLElement>(explicitControlSelector).forEach(consider);
  }

  return [...targets];
}

function restoreInlineSize(record: TrackedTextElement) {
  if (record.originalInlineSize) {
    record.element.style.setProperty('font-size', record.originalInlineSize, record.originalInlinePriority);
  } else {
    record.element.style.removeProperty('font-size');
  }
}

export function AccessibilityTextProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const { principal } = useAuth();
  const pathname = usePathname();
  const [textSizeOffset, setOffsetState] = useState<TextSizeOffset>(0);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const trackedRef = useRef<Map<HTMLElement, TrackedTextElement>>(new Map());
  const offsetRef = useRef<TextSizeOffset>(0);

  offsetRef.current = textSizeOffset;

  useEffect(() => {
    setLoadedUserId(null);
    const preferences = loadBrowserUserPreferences(principal.userId);
    setOffsetState(preferences.textSizeOffset);
    setLoadedUserId(principal.userId);
  }, [principal.userId]);

  useEffect(() => {
    if (loadedUserId !== principal.userId) return;
    saveBrowserUserPreferences(principal.userId, { textSizeOffset });
    document.documentElement.dataset.demacTextSize = String(textSizeOffset);
    document.documentElement.style.setProperty(offsetVariable, `${textSizeOffset}px`);
  }, [loadedUserId, principal.userId, textSizeOffset]);

  useEffect(() => {
    if (loadedUserId !== principal.userId) return;

    const tracked = trackedRef.current;
    const rootStyle = document.documentElement.style;
    let resizeFrame = 0;

    const applyAccessibilityRule = (record: TrackedTextElement) => {
      record.element.style.setProperty(
        'font-size',
        `calc(${record.baseSize}px + var(${offsetVariable}, 0px))`,
        'important',
      );
    };

    const register = (elements: HTMLElement[]) => {
      const fresh = elements.filter((element) => element.isConnected && !tracked.has(element));
      if (!fresh.length) return;

      // Temporarily neutralize the offset while measuring so newly mounted pages
      // always capture their true CSS baseline, even when the current user is +1…+4.
      rootStyle.setProperty(offsetVariable, '0px');
      for (const element of fresh) {
        const originalInlineSize = element.style.getPropertyValue('font-size');
        const originalInlinePriority = element.style.getPropertyPriority('font-size');
        const computedSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
        if (!Number.isFinite(computedSize)) continue;
        const record: TrackedTextElement = {
          element,
          baseSize: computedSize,
          originalInlineSize,
          originalInlinePriority,
        };
        tracked.set(element, record);
        applyAccessibilityRule(record);
      }
      rootStyle.setProperty(offsetVariable, `${offsetRef.current}px`);
    };

    const rebaselineAll = () => {
      const records = [...tracked.values()].filter((record) => record.element.isConnected);
      for (const [element] of tracked) {
        if (!element.isConnected) tracked.delete(element);
      }
      if (!records.length) return;

      rootStyle.setProperty(offsetVariable, '0px');
      for (const record of records) restoreInlineSize(record);
      for (const record of records) {
        const computedSize = Number.parseFloat(window.getComputedStyle(record.element).fontSize);
        if (Number.isFinite(computedSize)) record.baseSize = computedSize;
      }
      for (const record of records) applyAccessibilityRule(record);
      rootStyle.setProperty(offsetVariable, `${offsetRef.current}px`);
    };

    register(collectTargets(document.body));

    const observer = new MutationObserver((mutations) => {
      const newTargets: HTMLElement[] = [];
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => newTargets.push(...collectTargets(node)));
      }
      register(newTargets);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const handleResize = () => {
      window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(rebaselineAll);
    };
    window.addEventListener('resize', handleResize);

    // Next.js may reuse portions of the DOM between routes. Re-scan once after
    // navigation so every module receives the same accessibility contract.
    const routeFrame = window.requestAnimationFrame(() => register(collectTargets(document.body)));

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      window.cancelAnimationFrame(resizeFrame);
      window.cancelAnimationFrame(routeFrame);
      for (const record of tracked.values()) restoreInlineSize(record);
      tracked.clear();
    };
  }, [loadedUserId, pathname, principal.userId]);

  const setTextSizeOffset = useCallback((value: number) => setOffsetState(normalizeTextSizeOffset(value)), []);
  const increaseTextSize = useCallback(() => setOffsetState((current) => normalizeTextSizeOffset(current + 1)), []);
  const decreaseTextSize = useCallback(() => setOffsetState((current) => normalizeTextSizeOffset(current - 1)), []);
  const resetTextSize = useCallback(() => setOffsetState(0), []);

  const value = useMemo<AccessibilityTextContextValue>(() => ({
    textSizeOffset,
    setTextSizeOffset,
    increaseTextSize,
    decreaseTextSize,
    resetTextSize,
  }), [decreaseTextSize, increaseTextSize, resetTextSize, setTextSizeOffset, textSizeOffset]);

  return <AccessibilityTextContext.Provider value={value}>{children}</AccessibilityTextContext.Provider>;
}

export function useAccessibilityText() {
  const context = useContext(AccessibilityTextContext);
  if (!context) throw new Error('useAccessibilityText must be used inside AccessibilityTextProvider.');
  return context;
}
