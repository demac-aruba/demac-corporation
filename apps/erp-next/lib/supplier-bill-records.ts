import type { BillDraft } from './supplier-bill-draft';

export type DraftActor = { uid: string; name: string };
export type SupplierDraftRecord = {
  schemaVersion: 1; id: string; version: number; status: 'draft'; draft: BillDraft;
  createdAt: string; updatedAt: string; createdBy: DraftActor; updatedBy: DraftActor;
  reason: string; catalogLinks: 'pending'; inventoryStatus: 'not-received'; accountingStatus: 'not-sent';
};
export type SupplierDraftSummary = Pick<SupplierDraftRecord, 'id' | 'version' | 'updatedAt' | 'updatedBy'> & {
  supplier: string; invoiceNumber: string; currency: string; lineCount: number;
};
export type SaveSupplierDraft = {
  action: 'save'; id: string; requestId: string; expectedVersion: number; draft: BillDraft; reason: string;
};
export type SupplierDraftReceipt = { accepted: true; id: string; version: number; replayed?: boolean } |
  { accepted: false; code: string; conflictId: string | null; replayed?: boolean };
export type SupplierDraftHistory = { version: number; at: string; actor: DraftActor; reason: string; supplier: string; invoiceNumber: string };
export type SupplierBillGateway = {
  status: () => Promise<{ enabled: boolean; canWrite: boolean }>;
  list: (after: string | null) => Promise<{ rows: SupplierDraftSummary[]; next: string | null; canWrite: boolean }>;
  read: (id: string) => Promise<{ record: SupplierDraftRecord; canWrite: boolean }>;
  history: (id: string, beforeVersion: number | null) => Promise<{ rows: SupplierDraftHistory[]; next: number | null }>;
  pending: () => Promise<SaveSupplierDraft[]>;
  save: (command: SaveSupplierDraft) => Promise<SupplierDraftReceipt>;
};
