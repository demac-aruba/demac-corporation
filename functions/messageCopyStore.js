'use strict';
const { validateFields, defaultsFor } = require('./messageCopy');
const COLLECTION = 'businessSettings/whatsapp/messageCopy';
function copyRef(db, id, language) {
  defaultsFor(id, language);
  return db.collection(COLLECTION).doc(id + '_' + language);
}
async function loadMessageCopy(db, id, language) {
  try {
    const snapshot = await copyRef(db, id, language).get();
    if (!snapshot.exists) return { fields: null, revision: 0 };
    const data = snapshot.data();
    if (data.schemaVersion !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('invalid-message-copy');
    return { fields: validateFields(id, language, data.fields), revision: data.revision };
  } catch {
    // Copy configuration must not stop an otherwise eligible notification.
    // Never log customer details or the authored text.
    require('firebase-functions/logger').warn('Message copy unavailable; using built-in copy.', { templateId: id, language });
    return { fields: null, revision: 0, fallback: true };
  }
}
module.exports = { COLLECTION, copyRef, loadMessageCopy };
