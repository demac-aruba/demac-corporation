'use strict';
const { onRequest } = require('firebase-functions/v2/https');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { getApps, initializeApp } = require('firebase-admin/app');
const { createMessageCopyHandler } = require('./messageCopySettingsHttp');
if (!getApps().length) initializeApp();
exports.messageCopySettings = onRequest({ region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, maxInstances: 5 },
  createMessageCopyHandler({ db: getFirestore(), verifyIdToken: (token, revoked) => getAuth().verifyIdToken(token, revoked) }));
