"use strict";

// Standalone deployment entry. Never import the operational Functions bootstrap:
// publishing observability must not load or redeploy Booking, WhatsApp or Field.
const { initializeApp, getApps } = require('firebase-admin/app');
if (!getApps().length) initializeApp();
module.exports = require('./performanceTelemetry');
