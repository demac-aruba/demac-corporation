import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { AppShell } from './src/components/AppShell';
import { LoadingScreen } from './src/components/UI';
import { LoginScreen } from './src/screens/LoginScreen';
import { AppStateProvider, useAppState } from './src/state/AppState';
import { CalendarStateProvider } from './src/state/CalendarState';
import { TeamStateProvider } from './src/state/TeamState';
import { VanHalfDayStateProvider } from './src/state/VanHalfDayState';

function usePwaRegistration() {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;

    let manifest = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (!manifest) {
      manifest = document.createElement('link');
      manifest.rel = 'manifest';
      manifest.href = '/manifest.json';
      document.head.appendChild(manifest);
    }

    let theme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null;
    if (!theme) {
      theme = document.createElement('meta');
      theme.name = 'theme-color';
      theme.content = '#0957C3';
      document.head.appendChild(theme);
    }

    let appleCapable = document.querySelector('meta[name="apple-mobile-web-app-capable"]') as HTMLMetaElement | null;
    if (!appleCapable) {
      appleCapable = document.createElement('meta');
      appleCapable.name = 'apple-mobile-web-app-capable';
      appleCapable.content = 'yes';
      document.head.appendChild(appleCapable);
    }

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('No se pudo registrar la aplicación instalable DEMAC:', error);
      });
    }

    return undefined;
  }, []);
}

function AppContent() {
  usePwaRegistration();
  const { currentUser, hydrated } = useAppState();
  if (!hydrated) return <LoadingScreen />;
  return (
    <>
      <StatusBar style={currentUser ? 'dark' : 'light'} />
      {currentUser ? <AppShell /> : <LoginScreen />}
    </>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <TeamStateProvider>
        <CalendarStateProvider>
          <VanHalfDayStateProvider>
            <AppContent />
          </VanHalfDayStateProvider>
        </CalendarStateProvider>
      </TeamStateProvider>
    </AppStateProvider>
  );
}
