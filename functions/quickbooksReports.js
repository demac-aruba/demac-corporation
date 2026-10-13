'use strict';
// Dedicated read-only entry; never discovered with operational ERP functions.
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { createReportsHttpHandler } = require('./quickbooksReportsHttp');
const { RETURN, CALLBACK } = require('./quickbooksConnectionService');
const clientId = defineSecret('QBO_PRODUCTION_CLIENT_ID');
const clientSecret = defineSecret('QBO_PRODUCTION_CLIENT_SECRET');
const tokenKey = defineSecret('QBO_PRODUCTION_TOKEN_KEY');
let handler;
exports.quickbooksReports = onRequest({ region: 'us-central1', timeoutSeconds: 60, maxInstances: 3,
  secrets: [clientId, clientSecret, tokenKey] }, (request, response) => {
  if (!handler) {
    if (!getApps().length) initializeApp();
    handler = createReportsHttpHandler({ db: getFirestore(), verifyIdToken: token => getAuth().verifyIdToken(token, true),
      getConfig: () => {
        const enabled = process.env.QBO_PRODUCTION_REPORTS_ENABLED === 'true';
        return { enabled, ownerUid: process.env.QBO_PRODUCTION_OWNER_UID, realmId: process.env.QBO_PRODUCTION_REALM_ID,
          ...(enabled ? { clientId: clientId.value(), clientSecret: clientSecret.value(), encryptionKey: tokenKey.value() } : {}),
          redirectUri: CALLBACK, returnUrl: RETURN };
      }, log: event => logger.warn('QuickBooks report diagnostic', event) });
  }
  return handler(request, response);
});
