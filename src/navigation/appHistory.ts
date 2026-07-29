import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

type DemacHistoryState = Record<string, unknown> & {
  __demacApp?: boolean;
  __demacScreen?: string;
  __demacLayer?: string;
  __demacViews?: Record<string, string>;
};

type BackLayer = {
  id: string;
  activeRef: { current: boolean };
  onBackRef: { current: () => void };
  entryActive: boolean;
};

type WebHistoryStateController = {
  back: (fallback?: () => void) => void;
  replace: (nextValue: string) => void;
};

const backLayers: BackLayer[] = [];
let layerSequence = 0;
let programmaticPopCount = 0;
let layerListenerInstalled = false;

function browserHistoryAvailable() {
  return Platform.OS === 'web'
    && typeof window !== 'undefined'
    && Boolean(window.history?.pushState);
}

function currentState(): DemacHistoryState {
  if (!browserHistoryAvailable()) return {};
  const state = window.history.state;
  return state && typeof state === 'object' ? { ...state } : {};
}

function historyStateForScreen(screen: string, resetViews: boolean): DemacHistoryState {
  const state = currentState();
  const changingScreen = state.__demacScreen !== screen;
  delete state.__demacLayer;
  return {
    ...state,
    __demacApp: true,
    __demacScreen: screen,
    __demacViews: resetViews || changingScreen ? {} : { ...(state.__demacViews ?? {}) },
  };
}

function historyStateForView(scope: string, value: string): DemacHistoryState {
  const state = currentState();
  delete state.__demacLayer;
  return {
    ...state,
    __demacApp: true,
    __demacViews: {
      ...(state.__demacViews ?? {}),
      [scope]: value,
    },
  };
}

function pushLayerEntry(id: string) {
  if (!browserHistoryAvailable()) return;
  window.history.pushState(
    {
      ...currentState(),
      __demacApp: true,
      __demacLayer: id,
    },
    '',
    window.location.href,
  );
}

function installLayerListener() {
  if (!browserHistoryAvailable() || layerListenerInstalled) return;
  layerListenerInstalled = true;

  window.addEventListener('popstate', () => {
    if (programmaticPopCount > 0) {
      programmaticPopCount -= 1;
      return;
    }

    const layer = backLayers[backLayers.length - 1];
    if (!layer) return;

    backLayers.pop();
    layer.entryActive = false;
    layer.onBackRef.current();

    // Some close handlers intentionally refuse to close while saving. If the
    // layer remains active, restore its history entry so the next Back press
    // still belongs to the application instead of leaving it.
    setTimeout(() => {
      if (!layer.activeRef.current || layer.entryActive) return;
      layer.entryActive = true;
      backLayers.push(layer);
      pushLayerEntry(layer.id);
    }, 0);
  });
}

function registerBackLayer(layer: BackLayer) {
  if (!browserHistoryAvailable()) return () => undefined;
  installLayerListener();
  layer.entryActive = true;
  backLayers.push(layer);
  pushLayerEntry(layer.id);

  return () => {
    const index = backLayers.findIndex((item) => item.id === layer.id);
    if (index >= 0) backLayers.splice(index, 1);

    const activeHistoryLayer = currentState().__demacLayer;
    if (!layer.entryActive || activeHistoryLayer !== layer.id) {
      layer.entryActive = false;
      return;
    }

    layer.entryActive = false;
    programmaticPopCount += 1;
    window.history.back();
  };
}

export function readHistoryScreen<T extends string>(allowed?: readonly T[]): T | undefined {
  if (!browserHistoryAvailable()) return undefined;
  const screen = currentState().__demacScreen;
  if (typeof screen !== 'string') return undefined;
  if (allowed && !allowed.includes(screen as T)) return undefined;
  return screen as T;
}

export function replaceHistoryScreen(screen: string) {
  if (!browserHistoryAvailable()) return;
  window.history.replaceState(historyStateForScreen(screen, false), '', window.location.href);
}

export function pushHistoryScreen(screen: string) {
  if (!browserHistoryAvailable()) return;
  window.history.pushState(historyStateForScreen(screen, true), '', window.location.href);
}

export function subscribeToScreenHistory(listener: (screen?: string) => void) {
  if (!browserHistoryAvailable()) return () => undefined;
  const handlePopState = (event: PopStateEvent) => {
    const state = event.state && typeof event.state === 'object'
      ? event.state as DemacHistoryState
      : undefined;
    listener(typeof state?.__demacScreen === 'string' ? state.__demacScreen : undefined);
  };
  window.addEventListener('popstate', handlePopState);
  return () => window.removeEventListener('popstate', handlePopState);
}

/**
 * Connects a multi-step in-app state machine to browser history. Each value
 * change creates a real history entry. Browser/mobile Back restores the exact
 * previous value, while buttons can call controller.back() to use the same
 * history stack instead of creating a contradictory forward entry.
 */
export function useWebHistoryState(
  scope: string,
  value: string,
  onRestore: (value: string) => void,
): WebHistoryStateController {
  const valueRef = useRef(value);
  const restoreRef = useRef(onRestore);
  const lastValueRef = useRef<string | undefined>(undefined);
  const pendingRestoreRef = useRef<string | null>(null);
  valueRef.current = value;
  restoreRef.current = onRestore;

  useEffect(() => {
    if (!browserHistoryAvailable()) return undefined;

    const storedValue = currentState().__demacViews?.[scope];
    if (typeof storedValue === 'string') {
      lastValueRef.current = storedValue;
      if (storedValue !== valueRef.current) {
        pendingRestoreRef.current = storedValue;
        restoreRef.current(storedValue);
      }
    } else {
      lastValueRef.current = valueRef.current;
      window.history.replaceState(historyStateForView(scope, valueRef.current), '', window.location.href);
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state && typeof event.state === 'object'
        ? event.state as DemacHistoryState
        : undefined;
      const restoredValue = state?.__demacViews?.[scope];
      if (typeof restoredValue !== 'string' || restoredValue === valueRef.current) return;
      lastValueRef.current = restoredValue;
      pendingRestoreRef.current = restoredValue;
      restoreRef.current(restoredValue);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [scope]);

  useEffect(() => {
    if (!browserHistoryAvailable()) return;

    const pendingRestore = pendingRestoreRef.current;
    if (pendingRestore !== null) {
      if (value === pendingRestore) {
        pendingRestoreRef.current = null;
        lastValueRef.current = value;
      }
      return;
    }

    if (lastValueRef.current === undefined) {
      lastValueRef.current = value;
      return;
    }
    if (lastValueRef.current === value) return;

    window.history.pushState(historyStateForView(scope, value), '', window.location.href);
    lastValueRef.current = value;
  }, [scope, value]);

  return {
    back: (fallback) => {
      if (browserHistoryAvailable() && typeof currentState().__demacViews?.[scope] === 'string') {
        window.history.back();
        return;
      }
      fallback?.();
    },
    replace: (nextValue) => {
      if (!browserHistoryAvailable()) return;
      pendingRestoreRef.current = null;
      lastValueRef.current = nextValue;
      window.history.replaceState(historyStateForView(scope, nextValue), '', window.location.href);
    },
  };
}

/**
 * Gives a modal or single nested in-app view its own browser-history entry.
 * Android Back, the browser Back button, and the PWA Back gesture then close
 * the active layer before the browser can leave the application.
 */
export function useWebBackLayer(active: boolean, onBack: () => void, name = 'layer') {
  const activeRef = useRef(active);
  const onBackRef = useRef(onBack);
  activeRef.current = active;
  onBackRef.current = onBack;

  useEffect(() => {
    if (!active || !browserHistoryAvailable()) return undefined;
    const layer: BackLayer = {
      id: `demac-${name}-${Date.now()}-${layerSequence += 1}`,
      activeRef,
      onBackRef,
      entryActive: false,
    };
    return registerBackLayer(layer);
  }, [active, name]);
}
