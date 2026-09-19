'use strict';
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const { onRequest } = require('firebase-functions/v2/https');
const { createWebsiteContentService } = require('./websiteContentService');
const { createWebsiteContentFirebase } = require('./websiteContentFirebase');
const { createWebsiteContentHttp } = require('./websiteContentHttp');

// Only the dedicated website-content codebase exports this endpoint.
// Operational bootstrap, functions, configuration and rules remain unchanged.
if (!getApps().length) initializeApp();
const auth = getAuth();
const service = createWebsiteContentService(createWebsiteContentFirebase({
  db: getFirestore(), bucket: getStorage().bucket(), deleteField: () => FieldValue.delete(),
  deploymentEnabled: () => process.env.WEBSITE_EDITOR_ENABLED === 'true',
}));
const origins = ['https://demac-aruba.com', 'https://www.demac-aruba.com', ...(process.env.WEBSITE_EDITOR_ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean)];
for (const origin of origins) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.origin !== origin || origin.includes('*')) throw new Error('Website editor requires exact HTTPS origins.');
}
exports.websiteContentApi = onRequest({ region: 'us-central1', timeoutSeconds: 60, memory: '256MiB', maxInstances: 3 }, createWebsiteContentHttp({
  service, verifyToken: (token, revoked) => auth.verifyIdToken(token, revoked), allowedOrigins: origins,
}));
