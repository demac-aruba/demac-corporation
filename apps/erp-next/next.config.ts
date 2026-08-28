import type { NextConfig } from 'next';

// Firebase web-app configuration is public client configuration, not a service-account secret.
// Prefer Vercel environment variables when present. The DEMAC Firebase web-app defaults below
// keep ERP authentication available when this repository is deployed by either connected Vercel
// project, preventing one project from silently building an unauthenticated/locked client.
const firebaseDefaults = {
  apiKey: 'AIzaSyCo31zuo6d8RsgiLWGqUVOvRmHkisoF1DE',
  authDomain: 'demac-corporation.firebaseapp.com',
  projectId: 'demac-corporation',
  storageBucket: 'demac-corporation.firebasestorage.app',
  messagingSenderId: '1053571783393',
  appId: '1:1053571783393:web:f40e18627a16acf4df75a0',
  measurementId: 'G-XCWED77MLQ',
};

const firebasePublicEnv = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? firebaseDefaults.apiKey,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? firebaseDefaults.authDomain,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? firebaseDefaults.projectId,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? firebaseDefaults.storageBucket,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? firebaseDefaults.messagingSenderId,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? firebaseDefaults.appId,
  NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID ?? process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? firebaseDefaults.measurementId,
};

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'export',
  trailingSlash: true,
  experimental: {
    // Keep production validation inside worker threads on constrained Windows/CI hosts
    // where child-process creation is unavailable. This does not skip typechecking.
    workerThreads: true,
    cpus: 1,
  },
  env: firebasePublicEnv,
};

export default nextConfig;
