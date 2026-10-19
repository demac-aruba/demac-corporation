import { firebaseClientConfig } from './client-config';
import { loadFirebaseWebSession, requireFirebaseWebSession } from './session';
import { firebaseTransportUrl } from './isolated-preview';
import { CATALOG, FIELDS, validateFields, type MessageTemplateApi, type MessageTemplateRecord, type MessageTemplateHistory, type MessageTemplateSave } from '../message-templates';
const errors: Record<string, string> = {
  'admin-required': 'Only an active administrator can manage these messages.',
  'sign-in-required': 'Sign in again to continue.',
  'revision-conflict': 'Someone changed this message. Your draft is still here. Reload the latest version before saving again.',
  'request-conflict': 'This save request needs technical review. Keep this page open; it has not been replaced.',
  'invalid-variable': 'Use only the available placeholders shown below the editor.',
  'invalid-text': 'Review the text length and remove HTML or unsupported characters.',
  'empty-message': 'This message needs some text.',
  'invalid-saved-template': 'This saved message needs technical review. It has not been overwritten.',
};
export class MessageTemplateError extends Error { constructor(public code: string) { super(errors[code] || 'The result could not be confirmed. Use “Check save” to safely retry the same change.'); } }
function current(uid: string) { if (loadFirebaseWebSession()?.uid !== uid) throw new MessageTemplateError('sign-in-required'); }
export function messageTemplateApi(uid: string): MessageTemplateApi {
  async function request(body: object) {
    const session = await requireFirebaseWebSession(); current(uid);
    let response: Response;
    try { response = await fetch(firebaseTransportUrl(`https://us-central1-${firebaseClientConfig.projectId}.cloudfunctions.net/messageCopySettings`), {
      method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(35000),
      headers: { Authorization: `Bearer ${session.idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }); } catch { current(uid); throw new MessageTemplateError('result-unknown'); }
    const data = await response.json().catch(() => null); current(uid);
    if (!response.ok) throw new MessageTemplateError(data?.error || 'result-unknown');
    if (!data || typeof data !== 'object') throw new MessageTemplateError('result-unknown');
    return data;
  }
  function checked(record: MessageTemplateRecord) {
    if (!record || !Number.isSafeInteger(record.revision) || record.revision < 0 || (record.updatedAt !== null && (typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt)))) || (record.updatedByName !== null && typeof record.updatedByName !== 'string')) throw new MessageTemplateError('result-unknown');
    try { validateFields(record.id, record.language, record.fields); } catch { throw new MessageTemplateError('result-unknown'); } return record;
  }
  return {
    ownerKey: uid,
    async list() {
      const data = await request({ action: 'list' });
      const expected = new Set(CATALOG.flatMap(item => item.languages.map(language => `${item.id}_${language}`)));
      if (!Array.isArray(data.records) || data.records.length !== expected.size) throw new MessageTemplateError('result-unknown');
      return data.records.map((row: MessageTemplateRecord) => {
        const record = checked(row);
        if (!expected.delete(`${record.id}_${record.language}`)) throw new MessageTemplateError('result-unknown');
        return record;
      });
    },
    async save(input: MessageTemplateSave) {
      const data = await request(input), record = checked(data.record);
      if (data.savedRevision !== input.expectedRevision + 1 || record.id !== input.id || record.language !== input.language || record.revision < data.savedRevision || (record.revision === data.savedRevision && FIELDS.some(field => record.fields[field] !== input.fields[field]))) throw new MessageTemplateError('result-unknown');
      return { record, savedRevision: data.savedRevision };
    },
    async history(id: string, language: string) { const data = await request({ action: 'history', id, language }); if (!Array.isArray(data.records)) throw new MessageTemplateError('result-unknown'); return data.records.map((record: MessageTemplateHistory) => checked({ ...record, id, language })); },
  };
}
