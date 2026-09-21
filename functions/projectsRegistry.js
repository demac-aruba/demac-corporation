'use strict';

const { getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { onRequest } = require('firebase-functions/v2/https');
const { createProjectRegistryService } = require('./projects/registry-service');
const { createProjectRegistryHttp } = require('./projects/registry-http');

let handler;
function defaultHandler() {
  if (handler) return handler;
  // This new origin configuration is empty by default. It is not an activation
  // switch and never accepts a wildcard, URL path, or implicit preview domain.
  const allowedOrigins = (process.env.PROJECTS_ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean);
  let service;
  handler = createProjectRegistryHttp({
    allowedOrigins,
    service: {
      execute(input) {
        // Initialize only after transport checks; preflight never needs Firebase.
        if (!service) {
          if (!getApps().some((app) => app.name === '[DEFAULT]')) initializeApp();
          service = createProjectRegistryService({
            db: getFirestore(),
            verifyIdToken: (token, checkRevoked) => getAuth().verifyIdToken(token, checkRevoked),
            enabled: process.env.PROJECTS_REGISTRY_ENABLED === 'true',
            // Existing import capability remains closed in the deployment entry.
            // Real import needs the separately authorized backup/recovery gate.
            allowLegacyImport: false,
          });
        }
        return service.execute(input);
      },
    },
  });
  return handler;
}

const projectsRegistry = onRequest(
  { region: 'us-central1', memory: '256MiB', timeoutSeconds: 60, maxInstances: 3, cors: false },
  async (request, response) => {
    let handle;
    try { handle = defaultHandler(); }
    catch {
      // Invalid configuration cannot break bootstrap discovery or leak its value.
      response.set({ 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' });
      return response.status(503).json({ success: false, error: { code: 'projects_configuration_invalid', message: 'Central Projects configuration requires review.', outcome: 'rejected' } });
    }
    const result = await handle(request);
    response.set(result.headers);
    if (result.status === 204) return response.status(204).send('');
    return response.status(result.status).json(result.body);
  },
);

// Only the deployable endpoint enters the shared production bootstrap.
module.exports = { projectsRegistry };
