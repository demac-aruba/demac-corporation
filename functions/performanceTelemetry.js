"use strict";

const { getAuth } = require('firebase-admin/auth');
const { Timestamp, getFirestore } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { createPerformanceTelemetryApi } = require('./performanceTelemetryService');
let api;
function defaultApi() {
  return api ||= createPerformanceTelemetryApi({
    db: getFirestore(), verifyIdToken: (token) => getAuth().verifyIdToken(token),
    timestamp: (ms) => Timestamp.fromMillis(ms),
    enabled: process.env.PERFORMANCE_TELEMETRY_ENABLED === 'true',
    environment: process.env.PERFORMANCE_ENVIRONMENT || 'production',
  });
}
const performanceTelemetry = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 30, maxInstances: 3 },
  async (request, response) => {
    response.set('Access-Control-Allow-Origin', '*');
    response.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.set('Cache-Control', 'no-store');
    const result = await defaultApi().handle(request);
    if (result.status === 204) return response.status(204).send('');
    return response.status(result.status).json(result.body);
  },
);
// Only deployable function exports. Test helpers do not enter the production bootstrap.
module.exports = { performanceTelemetry };
