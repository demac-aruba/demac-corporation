/** Build-time consistency check, not a replacement for server isolation or UAT. */
export const FIELD_PREVIEW_BRANCH = 'feature/technician-app-20260923';
type Env = Readonly<Record<string, string | undefined>>;
type ProductionFirebase = { projectId: string; apiKey: string; messagingSenderId: string; appId: string };

export function assertFieldPreviewBuildSafety(env: Env, production: ProductionFirebase): void {
  // Preserve unrelated branches, production builds on main, and loopback CI.
  if (env.VERCEL !== '1' || env.VERCEL_GIT_COMMIT_REF !== FIELD_PREVIEW_BRANCH) return;
  const reject = (reason: string): never => { throw new Error(`Field preview build blocked: ${reason}`); };
  if (env.VERCEL_ENV !== 'preview') reject('this review branch may only target Vercel Preview.');
  const project = env.DEMAC_FIELD_PREVIEW_PROJECT_ID;
  if (!project || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)
      || project === production.projectId || project.startsWith('demo-')) {
    reject('configure a verified non-production Firebase project; emulator IDs are not hosted backends.');
  }
  if (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID !== project) reject('Firebase project must match the selected test project.');
  if (env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN !== `${project}.firebaseapp.com`) reject('Firebase Auth domain must belong to the test project.');
  if (![`${project}.appspot.com`, `${project}.firebasestorage.app`].includes(env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || '')) reject('Storage must belong to the test project.');
  const key = env.NEXT_PUBLIC_FIREBASE_API_KEY;
  if (!key || !key.trim() || key === 'demo-key' || key === production.apiKey) reject('supply the test Firebase app configuration, not production or emulator defaults.');
  const sender = env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID;
  if (!sender || !/^\d+$/.test(sender) || sender === production.messagingSenderId || /^0+$/.test(sender)) reject('supply the test Firebase project number.');
  const app = env.NEXT_PUBLIC_FIREBASE_APP_ID;
  if (!app || !new RegExp(`^1:${sender}:web:[A-Za-z0-9]+$`).test(app) || app === production.appId) reject('Firebase app ID must match the test project number.');
  if (env.NEXT_PUBLIC_ISOLATED_PREVIEW !== 'false') reject('the loopback emulator adapter is not a hosted Firebase backend.');
  if (env.NEXT_PUBLIC_PERFORMANCE_TELEMETRY_ENABLED !== 'false'
      || env.NEXT_PUBLIC_PERFORMANCE_ENVIRONMENT !== 'preview'
      || env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID !== '') reject('disable production telemetry and analytics for this review.');
}
