const PROJECT = 'demo-demac-dwellings';
function assertIsolated() {
  if (process.env.GCLOUD_PROJECT !== PROJECT || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8297'
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9297' || process.env.FIREBASE_STORAGE_EMULATOR_HOST !== '127.0.0.1:9397'
    || process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Preview requires the exact loopback demo project with no Google credentials.');
}
module.exports = { PROJECT, assertIsolated };
