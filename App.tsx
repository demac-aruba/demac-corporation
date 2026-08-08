import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { Platform } from 'react-native';
import { AppShell } from './src/components/AppShell';
import { LoadingScreen } from './src/components/UI';
import { LoginScreen } from './src/screens/LoginScreen';
import { TechnicianEquipmentProfileScreen } from './src/screens/TechnicianEquipmentProfileScreen';
import { TechnicianInterventionReportScreen } from './src/screens/TechnicianInterventionReportScreen';
import { TechnicianPortalEquipmentTestScreen } from './src/screens/TechnicianPortalEquipmentTestScreen';
import { TechnicianPortalPersistenceTestScreen } from './src/screens/TechnicianPortalPersistenceTestScreen';
import { TechnicianPortalPreviewScreen } from './src/screens/TechnicianPortalPreviewScreen';
import { AppStateProvider, useAppState } from './src/state/AppState';
import { CalendarStateProvider } from './src/state/CalendarState';
import { TeamStateProvider } from './src/state/TeamState';
import { TechnicianPortalStateProvider } from './src/state/TechnicianPortalState';
import { VanHalfDayStateProvider } from './src/state/VanHalfDayState';

const DEMAC_PUBLIC_URL = 'https://www.demac-aruba.com/';
const DEMAC_PUBLIC_TITLE = 'Air Conditioning Aruba | DEMAC Professional Cooling Solutions';
const DEMAC_PUBLIC_DESCRIPTION = 'DEMAC Professional Cooling Solutions provides air conditioning sales, installation, service, maintenance, repairs and VRF solutions across Aruba. Legal business: DEMAC COOLING SOLUTIONS VBA.';

function upsertMeta(attribute: 'name' | 'property', key: string, content: string) {
  let meta = document.head.querySelector(`meta[${attribute}="${key}"]`) as HTMLMetaElement | null;
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute(attribute, key);
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function upsertLink(rel: string, href: string) {
  let link = document.head.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
}

function upsertBusinessStructuredData() {
  let script = document.getElementById('demac-local-business-jsonld') as HTMLScriptElement | null;
  if (!script) {
    script = document.createElement('script');
    script.id = 'demac-local-business-jsonld';
    script.type = 'application/ld+json';
    document.head.appendChild(script);
  }

  script.text = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    '@id': `${DEMAC_PUBLIC_URL}#business`,
    name: 'DEMAC Professional Cooling Solutions',
    legalName: 'DEMAC COOLING SOLUTIONS VBA',
    alternateName: 'DEMAC COOLING SOLUTIONS',
    description: DEMAC_PUBLIC_DESCRIPTION,
    url: DEMAC_PUBLIC_URL,
    logo: `${DEMAC_PUBLIC_URL}demac-icon.svg`,
    telephone: '+2975642625',
    address: {
      '@type': 'PostalAddress',
      streetAddress: 'Santa Cruz 54 C, Lokaal 1, Papilon',
      addressLocality: 'Santa Cruz',
      addressRegion: 'Santa Cruz',
      addressCountry: 'AW',
    },
    areaServed: {
      '@type': 'Country',
      name: 'Aruba',
    },
    sameAs: ['https://www.facebook.com/DEMACARUBA'],
    knowsAbout: [
      'Air conditioning in Aruba',
      'Air conditioning installation',
      'Air conditioning service and maintenance',
      'Air conditioning repair',
      'VRF air conditioning systems',
    ],
  });
}

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

    document.title = DEMAC_PUBLIC_TITLE;
    upsertMeta('name', 'description', DEMAC_PUBLIC_DESCRIPTION);
    upsertMeta('name', 'robots', 'index, follow, max-image-preview:large');
    upsertMeta('property', 'og:type', 'website');
    upsertMeta('property', 'og:site_name', 'DEMAC Professional Cooling Solutions');
    upsertMeta('property', 'og:title', DEMAC_PUBLIC_TITLE);
    upsertMeta('property', 'og:description', DEMAC_PUBLIC_DESCRIPTION);
    upsertMeta('property', 'og:url', DEMAC_PUBLIC_URL);
    upsertMeta('name', 'twitter:card', 'summary');
    upsertMeta('name', 'twitter:title', DEMAC_PUBLIC_TITLE);
    upsertMeta('name', 'twitter:description', DEMAC_PUBLIC_DESCRIPTION);
    upsertLink('canonical', DEMAC_PUBLIC_URL);
    upsertBusinessStructuredData();

    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.warn('No se pudo registrar la aplicación instalable DEMAC:', error);
      });
    }

    return undefined;
  }, []);
}

function technicianPortalRoute() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return 'app';
  const params = new URLSearchParams(window.location.search);
  if (params.get('technicianPortalReport') === '1') return 'report';
  if (params.get('technicianPortalIntervention') === '1') return 'intervention';
  if (params.get('technicianPortalEquipment') === '1') return 'equipment';
  if (params.get('technicianPortalPersistence') === '1') return 'persistence';
  if (params.get('technicianPortalV2') === '1') return 'preview';
  return 'app';
}

function AppContent() {
  usePwaRegistration();
  const { currentUser, hydrated } = useAppState();
  const route = technicianPortalRoute();
  if (!hydrated) return <LoadingScreen />;
  return (
    <>
      <StatusBar style={currentUser ? 'dark' : 'light'} />
      {currentUser
        ? route === 'report'
          ? <TechnicianInterventionReportScreen />
          : route === 'intervention'
            ? <TechnicianEquipmentProfileScreen />
            : route === 'equipment'
              ? <TechnicianPortalEquipmentTestScreen />
              : route === 'persistence'
                ? <TechnicianPortalPersistenceTestScreen />
                : route === 'preview'
                  ? <TechnicianPortalPreviewScreen />
                  : <AppShell />
        : <LoginScreen />}
    </>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <TeamStateProvider>
        <TechnicianPortalStateProvider>
          <CalendarStateProvider>
            <VanHalfDayStateProvider>
              <AppContent />
            </VanHalfDayStateProvider>
          </CalendarStateProvider>
        </TechnicianPortalStateProvider>
      </TeamStateProvider>
    </AppStateProvider>
  );
}
