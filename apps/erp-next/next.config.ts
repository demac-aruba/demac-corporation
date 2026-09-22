import type { NextConfig } from 'next';

// Public Firebase application configuration, not service-account credentials.
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
const publicBuildEnv = {
  // Review builds are browser-local. Production remains disabled until the
  // protected publishing service and rules have passed the release checklist.
  NEXT_PUBLIC_WEBSITE_EDITOR_MODE: process.env.WEBSITE_EDITOR_MODE === 'live' && process.env.VERCEL_ENV === 'production' ? 'live' : process.env.VERCEL_ENV === 'production' ? 'disabled' : 'review',
  NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'unknown',
  // Preview/local collection is off unless an isolated test explicitly enables it.
  NEXT_PUBLIC_PERFORMANCE_ENVIRONMENT: process.env.NEXT_PUBLIC_PERFORMANCE_ENVIRONMENT ?? (process.env.VERCEL_ENV === 'production' ? 'production' : 'preview'),
  NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED: process.env.NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED ?? (process.env.VERCEL_ENV === 'production' ? 'true' : 'false'),
};
const nextConfig: NextConfig = {
  reactStrictMode: true, poweredByHeader: false, output: 'export', trailingSlash: true,
  experimental: { workerThreads: true, cpus: 1 },
  env: { ...firebasePublicEnv, ...publicBuildEnv },
};
export default nextConfig;
