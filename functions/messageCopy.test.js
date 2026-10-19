const assert = require('node:assert/strict');
const test = require('node:test');
const { CATALOG, LIMITS, defaultsFor, validateFields, renderMessageCopy, previewMessage } = require('./messageCopy');
const { COLLECTION, loadMessageCopy } = require('./messageCopyStore');
const { createMessageCopySettings } = require('./messageCopySettings');
const { createMessageCopyHandler } = require('./messageCopySettingsHttp');
const { createWhatsAppTransactionalService } = require('./whatsappTransactionalService');
const { appointmentMessageCopy, renderAppointmentText } = require('./appointmentCommunicationRenderer');
const { reminderMessage, dailyGreetingMessage, dailyTaskReminderMessage, dailyClosingMessage } = require('./taskReminderService');
const { assignmentNotificationMessage } = require('./taskAssignmentNotificationService');
const { ReferenceDb, response } = require('./test-support/referenceDb.cjs');

const id = 'appointment_confirmation', language = 'en', path = `${COLLECTION}/${id}_${language}`;
const stamp = '2026-10-19T12:00:00.000Z';
const fields = { greeting: 'Welcome {name}!', introduction: 'Thank you for choosing {company}.', closing: 'Reply whenever you need us.' };
const request = (changes = {}) => ({ action: 'save', id, language, fields, expectedRevision: 0, requestId: 'synthetic-request-0001', ...changes });
const seeded = (role = 'admin', active = true) => new ReferenceDb({ 'users/owner': { name: 'Example administrator', role, active } });
const service = db => createMessageCopySettings({ db, now: () => new Date(stamp) });
const saved = (copy = fields, revision = 1) => ({ schemaVersion: 1, revision, fields: copy, updatedAt: stamp, updatedByName: 'Example administrator' });

test('every catalog locale is valid and preview uses the exact operational composition', () => {
  assert.equal(CATALOG.length, 14);
  assert.equal(new Set(CATALOG.map(item => item.id)).size, CATALOG.length);
  for (const item of CATALOG) for (const lang of item.languages) {
    const defaults = defaultsFor(item.id, lang);
    assert.deepEqual(validateFields(item.id, lang, defaults), defaults);
    const preview = previewMessage(item.id, lang, defaults);
    assert.ok(preview.trim());
    assert.ok(!/[{}]/.test(preview));
    assert.ok(preview.includes(item.sampleDetails[lang]));
  }
});

test('reject unsupported templates, fields, placeholders, markup, control characters and oversized input', () => {
  for (const bad of [null, [], {}, { ...fields, details: 'tampered address' }, { ...fields, greeting: '{address}' }, { ...fields, greeting: '{{name}}' }, { ...fields, closing: '<script>alert(1)</script>' }, { ...fields, closing: '\u0001' }, { ...fields, greeting: 'x'.repeat(LIMITS.greeting + 1) }]) {
    assert.throws(() => validateFields(id, language, bad), error => error.status === 400);
  }
  assert.throws(() => defaultsFor('../users', 'en'));
  assert.throws(() => defaultsFor('van_work_order', 'en'));
  assert.throws(() => validateFields('task_daily_closing', 'en', { greeting: '', introduction: '', closing: '' }), { code: 'empty-message' });
  assert.equal(validateFields(id, language, { ...fields, closing: '  Line 1\r\nLine 2  ' }).closing, 'Line 1\nLine 2');
});

test('variables are substituted once and never replace protected operational details', () => {
  const details = '*Address:* Wayaca Residence 217\n*Address:* Apartment 1';
  const text = renderMessageCopy(id, language, { name: '{company}', company: 'DEMAC' }, details, fields);
  assert.ok(text.startsWith('Welcome {company}!'));
  assert.ok(text.includes(details));
});

test('list defaults, save atomically, audit and replay the same operation without a second revision', async () => {
  const db = seeded(), api = service(db);
  const before = await api.execute('owner', { action: 'list' });
  assert.equal(before.records.length, CATALOG.reduce((n, item) => n + item.languages.length, 0));
  assert.ok(before.records.every(row => row.revision === 0));
  const first = await api.execute('owner', request());
  assert.equal(first.record.revision, 1);
  assert.deepEqual(first.record.fields, fields);
  assert.equal(db.records.get(`${path}/history/0000000001`).updatedById, 'owner');
  const count = db.records.size;
  assert.equal((await api.execute('owner', request())).replayed, true);
  assert.equal(db.records.size, count);
  assert.deepEqual((await loadMessageCopy(db, id, language)).fields, fields);
});

test('stale writes and reused request IDs cannot overwrite a saved edit', async () => {
  const db = seeded(), api = service(db);
  await api.execute('owner', request());
  await assert.rejects(api.execute('owner', request({ requestId: 'synthetic-request-0002' })), { code: 'revision-conflict' });
  await assert.rejects(api.execute('owner', request({ fields: { ...fields, closing: 'Other text' } })), { code: 'request-conflict' });
  assert.equal(db.records.get(path).revision, 1);
  await api.execute('owner', request({ requestId: 'synthetic-request-0002', expectedRevision: 1, fields: { ...fields, closing: 'Updated closing' } }));
  const retry = await api.execute('owner', request());
  assert.equal(retry.savedRevision, 1);
  assert.equal(retry.record.revision, 2);
  assert.equal(retry.record.fields.closing, 'Updated closing');
});

test('history returns saved versions and restoring one creates a new version', async () => {
  const db = seeded(), originalCollection = db.collection.bind(db);
  db.collection = name => {
    const collection = originalCollection(name);
    collection.orderBy = (field, direction) => {
      assert.equal(field, 'revision'); assert.equal(direction, 'desc');
      return { limit: count => ({ get: async () => ({ docs: (await collection.get()).docs.sort((a, b) => b.data().revision - a.data().revision).slice(0, count) }) }) };
    };
    return collection;
  };
  const api = service(db);
  await api.execute('owner', request());
  await api.execute('owner', request({ expectedRevision: 1, requestId: 'synthetic-request-0002', fields: defaultsFor(id, language) }));
  const history = await api.execute('owner', { action: 'history', id, language });
  assert.deepEqual(history.records.map(row => row.revision), [2, 1]);
  await api.execute('owner', request({ expectedRevision: 2, requestId: 'synthetic-request-0003', fields: history.records[1].fields }));
  assert.equal(db.records.get(path).revision, 3);
  assert.deepEqual(db.records.get(path).fields, fields);
});

test('missing, inactive and non-admin profiles deny read and write; role is rechecked inside the write transaction', async () => {
  for (const [role, active] of [['technician', true], ['office', true], ['admin', false]]) {
    const db = seeded(role, active), api = service(db);
    for (const action of [{ action: 'list' }, { action: 'history', id, language }, request()]) await assert.rejects(api.execute('owner', action), { code: 'admin-required' });
    assert.equal(db.records.size, 1);
  }
  await assert.rejects(service(new ReferenceDb()).execute('owner', request()), { code: 'admin-required' });
  const db = seeded(), transact = db.runTransaction.bind(db);
  db.runTransaction = async callback => { db.records.set('users/owner', { role: 'admin', active: false }); return transact(callback); };
  await assert.rejects(service(db).execute('owner', request()), { code: 'admin-required' });
  assert.equal(db.records.has(path), false);
});

test('invalid saved config fails closed in editor, falls back only in message producer', async () => {
  const db = seeded(); db.records.set(path, { schemaVersion: 99, revision: 1 });
  await assert.rejects(service(db).execute('owner', { action: 'list' }), { code: 'invalid-saved-template' });
  await assert.rejects(service(db).execute('owner', request()), { code: 'invalid-saved-template' });
  assert.equal((await loadMessageCopy(db, id, language)).fallback, true);
  db.records.set(path, saved({ ...fields, greeting: '{not_supported}' }));
  await assert.rejects(service(db).execute('owner', request()), { code: 'invalid-saved-template' });
  assert.equal((await loadMessageCopy({ collection() { throw new Error('offline'); } }, id, language)).fallback, true);
});

test('HTTP verifies revoked tokens, fresh admin, JSON contract, origin and bounded input', async () => {
  const db = seeded(), verified = [];
  const handler = createMessageCopyHandler({ db, verifyIdToken: async (...args) => { verified.push(args); if (args[0] === 'bad') throw new Error('revoked'); return { uid: 'owner' }; } });
  const call = async (headers = {}, method = 'POST', body = { action: 'list' }) => {
    const all = { origin: 'https://demac-aruba.com', authorization: 'Bearer synthetic-token', 'content-type': 'application/json', ...headers };
    const res = response(); await handler({ method, body, get: name => all[name] }, res); return res;
  };
  assert.equal((await call()).statusCode, 200);
  assert.deepEqual(verified[0], ['synthetic-token', true]);
  assert.equal((await call({ authorization: '' })).statusCode, 401);
  assert.equal((await call({ authorization: 'Bearer bad' })).statusCode, 401);
  assert.equal((await call({ origin: 'https://untrusted.example' })).statusCode, 403);
  assert.equal((await call({}, 'GET')).statusCode, 405);
  assert.equal((await call({}, 'OPTIONS')).statusCode, 204);
  assert.equal((await call({ 'content-type': 'text/plain' })).statusCode, 400);
  assert.equal((await call({}, 'POST', { action: 'list', huge: 'x'.repeat(12000) })).statusCode, 400);
  assert.equal((await call()).headers['Cache-Control'], 'private, no-store');
});

test('customer composition reaches the existing queue; retries never rewrite already queued copy', async () => {
  const db = seeded(); db.records.set(path, saved());
  const queue = createWhatsAppTransactionalService({ db });
  const descriptor = appointmentMessageCopy('appointment-confirmation', ['Example client', 'October 26', '08:30', 'Wayaca Residence 217', 'Standard Service'], 'en', { addressLines: ['Wayaca Residence 217', 'Apartment 1'] });
  const input = { queueId: 'synthetic-customer', to: '2970000000', messageCopy: descriptor, text: 'default' };
  await queue.queueTransactionalMessage(input);
  const row = db.records.get('whatsappOutboundQueue/synthetic-customer');
  assert.ok(row.text.startsWith('Welcome Example client!'));
  assert.ok(row.text.includes('*Address:* Wayaca Residence 217\n*Address:* Apartment 1'));
  assert.equal(row.messageTemplateRevision, 1);
  db.records.set(path, saved({ ...fields, greeting: 'New {name}' }, 2));
  assert.equal((await queue.queueTransactionalMessage(input)).created, false);
  assert.deepEqual(db.records.get('whatsappOutboundQueue/synthetic-customer'), row);
  await queue.queueTransactionalMessage({ ...input, queueId: 'synthetic-new' });
  assert.ok(db.records.get('whatsappOutboundQueue/synthetic-new').text.startsWith('New Example client'));
});

test('all seven technician types use their own copy and preserve reference attachments', async () => {
  const variants = [
    ['van_work_order', { notificationType: 'van-daily-work-order' }],
    ['van_references_updated', { notificationType: 'van-daily-work-order', reason: 'visit-references-updated' }],
    ['van_same_day_change', { notificationType: 'van-same-day-schedule-change' }],
    ['van_support_assigned', { notificationType: 'van-adhoc-support-change', supportNotificationRole: 'primary' }],
    ['van_support_requested', { notificationType: 'van-adhoc-support-change', supportNotificationRole: 'support' }],
    ['van_lunch', { notificationType: 'van-daily-lunch-break' }],
    ['van_pending', { notificationType: 'van-daily-pending-period' }],
  ];
  const db = seeded(), queue = createWhatsAppTransactionalService({ db });
  for (const [template, metadata] of variants) {
    db.records.set(`${COLLECTION}/${template}_es`, saved({ greeting: 'Hola {van}', introduction: '', closing: 'Gracias, equipo.' }));
    const attachment = { type: 'image', storagePath: 'synthetic/private/reference', caption: 'Keep this caption' };
    await queue.queueTransactionalMessage({ queueId: template, to: '120363000000000000@g.us', text: 'Protected work details', messages: [{ type: 'text', text: 'Protected work details' }, attachment], metadata: { ...metadata, vanName: 'Van 2' } });
    const row = db.records.get(`whatsappOutboundQueue/${template}`);
    assert.equal(row.text, 'Hola Van 2\n\nProtected work details\n\nGracias, equipo.');
    assert.deepEqual(row.messages[1], attachment);
    assert.equal(row.messageTemplateId, template);
  }
});

test('Meta approved templates and unknown text producers are not rewritten', async () => {
  const db = seeded(); db.records.set(path, saved());
  const queue = createWhatsAppTransactionalService({ db });
  await queue.queueTransactionalMessage({ queueId: 'unrelated', to: '2970000000', text: 'Keep original text' });
  assert.equal(db.records.get('whatsappOutboundQueue/unrelated').text, 'Keep original text');
  db.records.set('businessSettings/whatsapp', { transactionalProvider: 'meta', phoneNumberId: '1234567890' });
  await queue.queueTransactionalMessage({ queueId: 'meta', to: '2970000000', text: 'Old text', messageCopy: { id, language }, templateName: 'appointment_confirmation', bodyParameters: ['Example client', 'date', 'time', 'address', 'service'] });
  assert.equal(db.records.get('whatsappOutboundQueue/meta').provider, 'meta');
  assert.equal(db.records.get('whatsappOutboundQueue/meta').messageTemplateRevision, undefined);
});

test('all task producers personalize saved copy while preserving task details and deadline', () => {
  const task = { id: 'synthetic-task', taskNumber: 'TASK-TEST', title: 'Example task', dueAt: '2026-10-20T16:00:00.000Z', checkpoints: [] };
  const now = new Date(stamp), custom = { greeting: 'Welcome {name}!', introduction: '', closing: 'Thanks, {name}.' };
  const rendered = [assignmentNotificationMessage(task, 'Example colleague', custom), reminderMessage(task, { kind: 'pre_deadline_24h' }, 'Example colleague', now, custom), dailyTaskReminderMessage(task, now, custom, 'Example colleague')];
  for (const text of rendered) {
    assert.ok(text.startsWith('Welcome Example colleague!'));
    assert.ok(text.includes('TASK-TEST')); assert.ok(text.includes('Example task'));
    assert.ok(text.endsWith('Thanks, Example colleague.'));
    assert.ok(!text.includes('Hi Example colleague,'));
  }
  assert.ok(dailyGreetingMessage('Example colleague', custom).startsWith('Welcome Example colleague!'));
  assert.ok(dailyClosingMessage(custom, 'Example colleague').endsWith('Thanks, Example colleague.'));
});

test('unconfigured customer messages keep the previous default text in every supported language', () => {
  const expected = {
    en: ['Hello Example,', 'Your appointment with *DEMAC Professional Cooling Solutions* has been confirmed.', 'This is a reminder for your appointment with *DEMAC Professional Cooling Solutions*.', '*Date:* date\n*Time:* time\n*Address:* address\n*Service:* service', 'If you have any questions or need to make a change to your appointment, please feel free to reply to this message. We’re happy to help!'],
    es: ['Hola Example,', 'Tu cita con *DEMAC Professional Cooling Solutions* ha sido confirmada.', 'Este es un recordatorio de tu cita con *DEMAC Professional Cooling Solutions*.', '*Fecha:* date\n*Hora:* time\n*Dirección:* address\n*Servicio:* service', 'Si necesitas hacer algún cambio, responde a este mensaje.'],
    nl: ['Hallo Example,', 'Uw afspraak met *DEMAC Professional Cooling Solutions* is bevestigd.', 'Dit is een herinnering voor uw afspraak met *DEMAC Professional Cooling Solutions*.', '*Datum:* date\n*Tijd:* time\n*Adres:* address\n*Service:* service', 'Als u iets wilt wijzigen, kunt u op dit bericht reageren.'],
    pap: ['Bon dia Example,', 'Nos ta confirma bo cita cu *DEMAC Professional Cooling Solutions*.', 'Esaki ta un recordatorio pa bo cita cu *DEMAC Professional Cooling Solutions*.', '*Fecha:* date\n*Ora:* time\n*Adres:* address\n*Servicio:* service', 'Si bo mester haci algun cambio, contesta e mensahe aki.'],
  };
  for (const lang of ['en', 'es', 'nl', 'pap']) for (const type of ['appointment-confirmation', 'appointment-reminder']) {
    const params = ['Example', 'date', 'time', 'address', 'service'];
    const [greeting, confirmation, reminder, details, closing] = expected[lang];
    assert.equal(renderAppointmentText(type, params, lang, { now: new Date(stamp) }), [greeting, type.endsWith('reminder') ? reminder : confirmation, details, closing].join('\n\n'));
  }
});
