'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
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

const targetSelector = 'p,small,em,time,span,b,button,label,input,select,textarea,strong,a,li,td,th,kbd';

type TrackedTextElement = {
  element: HTMLElement;
  baseSize: number;
  originalInlineSize: string;
};

function canScale(element: HTMLElement) {
  if (element.closest('h1,h2,h3')) return false;
  if (element.closest('[data-demac-text-scale="ignore"]')) return false;
  return true;
}

function collectTargets(root: ParentNode) {
  const targets: HTMLElement[] = [];
  if (root instanceof HTMLElement && root.matches(targetSelector) && canScale(root)) targets.push(root);
  root.querySelectorAll<HTMLElement>(targetSelector).forEach((element) => {
    if (canScale(element)) targets.push(element);
  });
  return targets;
}

export function AccessibilityTextProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const { principal } = useAuth();
  const [textSizeOffset, setOffsetState] = useState<TextSizeOffset>(0);
  const [loadedUserId, setLoadedUserId] = useState<string | null>(null);
  const trackedRef = useRef<Map<HTMLElement, TrackedTextElement>>(new Map());

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
  }, [loadedUserId, principal.userId, textSizeOffset]);

  useEffect(() => {
    if (loadedUserId !== principal.userId) return;

    const tracked = trackedRef.current;
    for (const record of tracked.values()) record.element.style.fontSize = record.originalInlineSize;
    tracked.clear();

    const register = (elements: HTMLElement[]) => {
      const fresh: TrackedTextElement[] = [];
      for (const element of elements) {
        if (tracked.has(element)) continue;
        const originalInlineSize = element.style.fontSize;
        const computedSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
        if (!Number.isFinite(computedSize)) continue;

        let baseSize = computedSize;
        if (textSizeOffset > 0 && !originalInlineSize && element.parentElement) {
          const parentRecord = tracked.get(element.parentElement);
          if (parentRecord && Math.abs(computedSize - (parentRecord.baseSize + textSizeOffset)) < 0.15) {
            baseSize = Math.max(1, computedSize - textSizeOffset);
          }
        }
        const record = { element, baseSize, originalInlineSize };
        tracked.set(element, record);
        fresh.push(record);
      }
      if (textSizeOffset > 0) {
        for (const record of fresh) record.element.style.fontSize = `${record.baseSize + textSizeOffset}px`;
      }
    };

    // Capture every baseline before applying the user's offset so nested text does not compound.
    const initialElements = collectTargets(document.body);
    const initialRecords: TrackedTextElement[] = [];
    for (const element of initialElements) {
      const originalInlineSize = element.style.fontSize;
      const computedSize = Number.parseFloat(window.getComputedStyle(element).fontSize);
      if (!Number.isFinite(computedSize)) continue;
      const record = { element, baseSize: computedSize, originalInlineSize };
      tracked.set(element, record);
      initialRecords.push(record);
    }
    if (textSizeOffset > 0) {
      for (const record of initialRecords) record.element.style.fontSize = `${record.baseSize + textSizeOffset}px`;
    }

    const observer = new MutationObserver((mutations) => {
      const newElements: HTMLElement[] = [];
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) newElements.push(...collectTargets(node));
        });
      }
      if (newElements.length) register(newElements);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      for (const record of tracked.values()) record.element.style.fontSize = record.originalInlineSize;
      tracked.clear();
    };
  }, [loadedUserId, principal.userId, textSizeOffset]);

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
