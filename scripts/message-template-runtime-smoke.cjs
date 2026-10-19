'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const http = require('node:http');
const source = path.resolve(process.argv[2]);
const target = process.argv[3] || 'officeBookingAuthority';
assert.ok(['officeBookingAuthority', 'queueAppointmentConfirmation', 'sendDailyAppointmentReminders', 'sendDailyTechnicianSchedules', 'notifyBookingReferenceUpdate', 'notifyTaskAssigneeOnCreate', 'processTaskDeadlineReminders', 'sendDailyTaskSummaries'].includes(target));
const load = createRequire(path.join(source, 'package.json'));
async function main() {
  const mod = load('./bootstrap.js');
  // Each archived bundle belongs to one deployed entry point. A historical
  // reminder bundle need not contain later, unrelated exported functions.
  assert.equal(typeof mod[target], 'function', 'Runtime export missing: ' + target);
  const checks = ['real bootstrap and ' + target];
  const declared = load('./package.json').dependencies;
  if (declared.sharp) {
    const sharp = load('sharp');
    for (const channels of [3, 4]) {
      const bytes = await sharp({ create: { width: 8, height: 8, channels, background: '#336699' } }).png().toBuffer();
      const resized = await sharp(bytes, { limitInputPixels: 32000000, animated: false }).rotate()
        .resize({ width: 4, height: 4, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
      assert.equal((await sharp(resized).metadata()).width, 4);
    }
    checks.push('native image codec');
  }
  if (declared.nodemailer) {
    const mail = load('nodemailer').createTransport({ jsonTransport: true });
    // JSON transport renders a synthetic payload locally; it has no SMTP socket.
    const rendered = await mail.sendMail({ from: 'sender@example.invalid', to: 'synthetic@example.invalid', subject: 'Synthetic audit', text: 'No delivery' });
    assert.equal(JSON.parse(rendered.message).subject, 'Synthetic audit'); mail.close();
    checks.push('local mail rendering');
  }
  if (target === 'officeBookingAuthority') {
    const express = load('express');
    const app = express(); app.use(express.json()); app.all('/office', mod.officeBookingAuthority);
    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const url = 'http://127.0.0.1:' + server.address().port + '/office';
      const headers = { Origin: 'https://demac-aruba.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' };
      assert.equal((await fetch(url, { method: 'OPTIONS', headers })).status, 204);
      const response = await fetch(url, { method: 'POST', headers: { Origin: headers.Origin, 'Content-Type': 'application/json' }, body: '{"action":"list_presets","data":{}}' });
      assert.equal(response.status, 401);
      checks.push('CORS and anonymous denial');
    } finally {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
  }
  const { ReferenceDb } = load('./test-support/referenceDb.cjs');
  const db = new ReferenceDb({ 'businessSettings/whatsapp/messageCopy/appointment_confirmation_en': { schemaVersion: 1, revision: 1, fields: { greeting: 'Welcome {name}', introduction: '', closing: 'Reply whenever you need help.' } } });
  if (['officeBookingAuthority','queueAppointmentConfirmation','sendDailyAppointmentReminders'].includes(target)) {
    const copy = load('./appointmentCommunicationRenderer').appointmentMessageCopy('appointment-confirmation', ['Example', 'date', 'time', 'address', 'service'], 'en', { addressLines: ['Example address', 'Apartment 1'] });
    await load('./whatsappTransactionalService').createWhatsAppTransactionalService({ db }).queueTransactionalMessage({ queueId: 'synthetic-copy', to: '2970000000', messageCopy: copy, text: 'default' });
    const row = db.records.get('whatsappOutboundQueue/synthetic-copy');
    assert.match(row.text, /^Welcome Example/); assert.match(row.text, /Address:\* Apartment 1/); assert.equal(row.messageTemplateRevision, 1);
    checks.push('saved customer copy in isolated queue');
  }
  if (['officeBookingAuthority','queueAppointmentConfirmation','sendDailyTechnicianSchedules','notifyBookingReferenceUpdate'].includes(target)) {
    db.records.set('businessSettings/whatsapp/messageCopy/van_work_order_es', { schemaVersion: 1, revision: 1, fields: { greeting: 'Hola {van}', introduction: '', closing: 'Gracias' } });
    await load('./whatsappTransactionalService').createWhatsAppTransactionalService({ db }).queueTransactionalMessage({ queueId: 'synthetic-van', to: '120363000000000000@g.us', text: 'Protected details', metadata: { notificationType: 'van-daily-work-order', vanName: 'Example van' } });
    assert.equal(db.records.get('whatsappOutboundQueue/synthetic-van').text, 'Hola Example van\n\nProtected details\n\nGracias');
    checks.push('saved technician copy in isolated queue');
  }
  if (target.includes('Task')) {
    const copy = { greeting: 'Welcome {name}', introduction: '', closing: 'Thanks, {name}' };
    const task = { id: 'example', taskNumber: 'TASK-EXAMPLE', title: 'Example work', dueAt: '2026-10-26T12:00:00Z', checkpoints: [] };
    const reminder = load('./taskReminderService');
    assert.match(reminder.reminderMessage(task, {}, 'Example', new Date('2026-10-25T12:00:00Z'), copy), /^Welcome Example/);
    assert.match(reminder.dailyClosingMessage(copy, 'Example'), /Thanks, Example$/);
    if (target === 'notifyTaskAssigneeOnCreate') assert.match(load('./taskAssignmentNotificationService').assignmentNotificationMessage(task, 'Example', copy), /^Welcome Example/);
    checks.push('custom task copy with protected task details');
  }
  const admin = load('firebase-admin/app'); await Promise.all(admin.getApps().map(admin.deleteApp));
  console.log('PASS: ' + checks.join('; '));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
