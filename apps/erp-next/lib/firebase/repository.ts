import type { AuditFields, EntityId, ISODateTime } from '../domain';
import type { EntityPatch, PageRequest, PageResult, WriteRepository } from '../persistence';
import { CryptoIdFactory, SystemClock } from '../persistence';
import type { AuthPrincipal } from '../security';
import { getFirestoreDocument, listFirestoreCollection, saveFirestoreDocument, updateFirestoreDocument } from './firestore-rest';

export type FirebaseRepositoryOptions = {
  collection: string;
  idPrefix: string;
  principal: () => AuthPrincipal;
};

export class FirebaseDocumentRepository<T extends AuditFields> implements WriteRepository<T> {
  private readonly clock = new SystemClock();
  private readonly ids = new CryptoIdFactory();

  constructor(private readonly options: FirebaseRepositoryOptions) {}

  async getById(id: EntityId): Promise<T | null> {
    return getFirestoreDocument<T>(this.options.collection, id);
  }

  async list(page: PageRequest = {}): Promise<PageResult<T>> {
    const limit = Math.max(1, Math.min(page.limit ?? 250, 500));
    // The REST adapter currently loads one controlled collection page-set and slices it.
    // Composite/indexed query repositories will replace this for high-volume collections.
    const items = await listFirestoreCollection<T>(this.options.collection, limit);
    const offset = page.cursor ? Math.max(0, Number(page.cursor) || 0) : 0;
    const window = items.slice(offset, offset + limit);
    const nextOffset = offset + window.length;
    return {
      items: window,
      nextCursor: nextOffset < items.length ? String(nextOffset) : undefined,
    };
  }

  async create(input: Omit<T, keyof AuditFields>): Promise<T> {
    const principal = this.options.principal();
    const now = this.clock.now();
    const document = {
      ...input,
      id: this.ids.create(this.options.idPrefix),
      createdAt: now,
      updatedAt: now,
      createdBy: principal.userId,
      updatedBy: principal.userId,
    } as T;
    return saveFirestoreDocument(this.options.collection, document);
  }

  async update(id: EntityId, patch: EntityPatch<T>, expectedUpdatedAt?: ISODateTime): Promise<T> {
    const principal = this.options.principal();
    if (expectedUpdatedAt) {
      const current = await this.getById(id);
      if (!current) throw new Error(`${this.options.collection}/${id} does not exist.`);
      if (current.updatedAt !== expectedUpdatedAt) throw new Error('This record changed after it was opened. Reload before saving again.');
    }
    return updateFirestoreDocument<T>(this.options.collection, id, {
      ...patch,
      updatedAt: this.clock.now(),
      updatedBy: principal.userId,
    });
  }
}
