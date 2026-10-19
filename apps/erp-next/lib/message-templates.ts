import type { CopyFields } from '../../../functions/messageCopy';
export { CATALOG, FIELDS, LIMITS, defaultsFor, validateFields, previewMessage } from '../../../functions/messageCopy';
export type { CopyFields, CopyDefinition } from '../../../functions/messageCopy';
export type MessageTemplateRecord = { id: string; language: string; revision: number; fields: CopyFields; updatedAt: string | null; updatedByName: string | null };
export type MessageTemplateHistory = Pick<MessageTemplateRecord, 'revision' | 'fields' | 'updatedAt' | 'updatedByName'>;
export type MessageTemplateSave = { action: 'save'; id: string; language: string; fields: CopyFields; expectedRevision: number; requestId: string };
export type MessageTemplateApi = {
  mode?: 'preview';
  ownerKey: string;
  list(): Promise<MessageTemplateRecord[]>;
  save(request: MessageTemplateSave): Promise<{ record: MessageTemplateRecord; savedRevision: number }>;
  history(id: string, language: string): Promise<MessageTemplateHistory[]>;
};
