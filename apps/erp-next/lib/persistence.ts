import type { AuditFields, EntityId, ISODateTime } from './domain';
import type { AuthPrincipal } from './security';

export type SortDirection = 'asc' | 'desc';

export type PageRequest = {
  limit?: number;
  cursor?: string;
};

export type PageResult<T> = {
  items: T[];
  nextCursor?: string;
};

export type EntityPatch<T> = Partial<Omit<T, keyof AuditFields | 'id'>>;

export interface ReadRepository<T extends AuditFields> {
  getById(id: EntityId): Promise<T | null>;
  list(page?: PageRequest): Promise<PageResult<T>>;
}

export interface WriteRepository<T extends AuditFields> extends ReadRepository<T> {
  create(input: Omit<T, keyof AuditFields>): Promise<T>;
  update(id: EntityId, patch: EntityPatch<T>, expectedUpdatedAt?: ISODateTime): Promise<T>;
}

export interface ArchiveRepository<T extends AuditFields> extends WriteRepository<T> {
  archive(id: EntityId, reason: string): Promise<T>;
}

export interface UnitOfWork {
  run<T>(principal: AuthPrincipal, operation: (transaction: TransactionContext) => Promise<T>): Promise<T>;
}

export interface TransactionContext {
  readonly actor: AuthPrincipal;
  readonly correlationId: string;
  readonly startedAt: ISODateTime;
}

export interface Clock {
  now(): ISODateTime;
}

export interface IdFactory {
  create(prefix?: string): EntityId;
}

export type AuditEventInput = {
  actorId: EntityId;
  actorRole: string;
  action: string;
  entityType: string;
  entityId?: EntityId;
  module: string;
  correlationId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  occurredAt: ISODateTime;
};

export interface AuditWriter {
  append(event: AuditEventInput): Promise<void>;
}

export class SystemClock implements Clock {
  now(): ISODateTime { return new Date().toISOString(); }
}

export class CryptoIdFactory implements IdFactory {
  create(prefix = 'id'): EntityId {
    const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
    return `${prefix}_${random}`;
  }
}
