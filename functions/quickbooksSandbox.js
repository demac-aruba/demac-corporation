'use strict';

const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { createSandboxHttpHandler } = require('./quickbooksSandboxHttp');

const clientId = defineSecret('QBO_SANDBOX_CLIENT_ID');
const clientSecret = defineSecret('QBO_SANDBOX_CLIENT_SECRET');
const tokenKey = defineSecret('QBO_SANDBOX_TOKEN_KEY');
let handler;

exports.quickbooksSandbox = onRequest({ region: 'us-central1', timeoutSeconds: 60, maxInstances: 10,
  secrets: [clientId, clientSecret, tokenKey] }, (request, response) => {
  if (!handler) {
    if (!getApps().length) initializeApp();
    handler = createSandboxHttpHandler({ db: getFirestore(), verifyIdToken: token => getAuth().verifyIdToken(token, true),
      getConfig: () => ({ enabled: process.env.QBO_SANDBOX_ENABLED === 'true',
        clientId: clientId.value(), clientSecret: clientSecret.value(), encryptionKey: tokenKey.value(),
        realmId: process.env.QBO_SANDBOX_REALM_ID,
        redirectUri: `https://us-central1-${process.env.GCLOUD_PROJECT}.cloudfunctions.net/quickbooksSandbox/callback`,
        returnUrl: process.env.QBO_SANDBOX_RETURN_URL }),
      log: event => logger.warn('QuickBooks sandbox request failed', event) });
  }
  return handler(request, response);
});
