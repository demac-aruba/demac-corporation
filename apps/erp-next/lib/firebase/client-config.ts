export type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
};

export const firebaseClientConfig: FirebaseClientConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? '',
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? '',
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? '',
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID || undefined,
};

export const isFirebaseClientConfigured = Boolean(
  firebaseClientConfig.apiKey
  && firebaseClientConfig.authDomain
  && firebaseClientConfig.projectId
  && firebaseClientConfig.storageBucket
  && firebaseClientConfig.messagingSenderId
  && firebaseClientConfig.appId,
);

export function firebaseConfigurationSummary() {
  return {
    configured: isFirebaseClientConfigured,
    projectId: firebaseClientConfig.projectId || undefined,
    authDomain: firebaseClientConfig.authDomain || undefined,
    storageBucket: firebaseClientConfig.storageBucket || undefined,
  };
}
