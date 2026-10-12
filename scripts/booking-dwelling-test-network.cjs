'use strict';
// Preload only in synthetic test processes, never in npm/gcloud or deployment.
const net = require('node:net');
const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const value = Array.isArray(args[0]) ? args[0][0] : args[0];
  const host = typeof value === 'object' ? value.host : typeof args[1] === 'string' ? args[1] : 'localhost';
  if (!['localhost', '127.0.0.1', '::1'].includes(host || 'localhost')) {
    throw new Error('Synthetic audit rejected a non-loopback connection');
  }
  return original.apply(this, args);
};
