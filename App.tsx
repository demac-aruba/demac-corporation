import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { AppShell } from './src/components/AppShell';
import { LoadingScreen } from './src/components/UI';
import { LoginScreen } from './src/screens/LoginScreen';
import { AppStateProvider, useAppState } from './src/state/AppState';

function AppContent() {
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
      <AppContent />
    </AppStateProvider>
  );
}
