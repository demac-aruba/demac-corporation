import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

type InstallChoice = { outcome: 'accepted' | 'dismissed'; platform?: string };

type DeferredInstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
};

function detectStandalone() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches || navigatorWithStandalone.standalone === true;
}

export function usePwaStatus() {
  const [online, setOnline] = useState(() => Platform.OS !== 'web' || typeof navigator === 'undefined' ? true : navigator.onLine);
  const [standalone, setStandalone] = useState(detectStandalone);
  const [installPrompt, setInstallPrompt] = useState<DeferredInstallPrompt | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return undefined;

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as DeferredInstallPrompt);
    };
    const handleInstalled = () => {
      setStandalone(true);
      setInstallPrompt(null);
    };
    const displayMode = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayMode = () => setStandalone(detectStandalone());

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    displayMode?.addEventListener?.('change', handleDisplayMode);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
      displayMode?.removeEventListener?.('change', handleDisplayMode);
    };
  }, []);

  const install = useCallback(async () => {
    if (!installPrompt) return false;
    setInstalling(true);
    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') setInstallPrompt(null);
      return choice.outcome === 'accepted';
    } finally {
      setInstalling(false);
    }
  }, [installPrompt]);

  return useMemo(() => ({
    online,
    standalone,
    canInstall: Boolean(installPrompt) && !standalone,
    installing,
    install,
  }), [online, standalone, installPrompt, installing, install]);
}
