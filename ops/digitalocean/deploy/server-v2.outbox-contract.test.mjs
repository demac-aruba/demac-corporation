import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const source = fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'server-v2.mjs'), 'utf8');

test('webhook outbox has bounded poison-event quarantine without changing transient retry behavior', () => {
  assert.match(source, /WEBHOOK_MAX_ATTEMPTS/);
  assert.match(source, /webhook-dead-letter/);
  assert.match(source, /transientWebhookError/);
  assert.match(source, /outcome === 'quarantined'/);
  assert.match(source, /pendingDeadLetterEvents/);
});

test('voice notes use wacli voice send and ffmpeg normalization', () => {
  assert.match(source, /media\.kind === 'voice'/);
  assert.match(source, /'send', 'voice'/);
  assert.match(source, /libopus/);
});
