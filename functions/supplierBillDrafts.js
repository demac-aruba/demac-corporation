'use strict';
const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const { createSupplierBillDraftsHandler } = require('./supplierBillDraftsHttp');
if (!getApps().length) initializeApp();
exports.supplierBillDrafts = onRequest({ region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, maxInstances: 5 },
  createSupplierBillDraftsHandler({ db: getFirestore(), verifyIdToken: (token, revoked) => getAuth().verifyIdToken(token, revoked),
    enabled: process.env.SUPPLIER_BILL_DRAFTS_ENABLED === 'true', log: entry => logger.warn('supplier-draft', entry) }));
