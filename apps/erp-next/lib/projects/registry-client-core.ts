import type { RegistryCommand } from './registry-types';

export class RegistryRequestError extends Error {
  constructor(public code: string, message: string, public uncertain = false, public status = 0) {
    super(message);
    this.name = 'RegistryRequestError';
  }
}

export type RegistryIdentity = { uid: string; idToken: string; expiresAt: number };
export type IntentJournal = {
  read: () => RegistryCommand | null;
  write: (command: RegistryCommand) => void;
  clear: () => void;
};
type TransportOptions = {
  endpoint: string;
  identity: () => RegistryIdentity | null;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  clock?: () => number;
};
export type RegistryRequest = <T>(command: RegistryCommand, signal?: AbortSignal) => Promise<T>;

/** One transport, no business data cache, auth mutation, polling or implicit retries. */
export function createRegistryTransport({ endpoint, identity, fetcher = fetch, timeoutMs = 20000, clock = Date.now }: TransportOptions): RegistryRequest {
  const url = new URL(endpoint);
  const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('Projects requires HTTPS.');
  if (url.username || url.password || url.search || url.hash) throw new Error('Invalid Projects endpoint.');

  return async function request<T>(command: RegistryCommand, signal?: AbortSignal): Promise<T> {
    const actor = identity();
    if (!actor?.uid || !actor.idToken || actor.expiresAt <= clock()) {
      throw new RegistryRequestError('unauthenticated', 'Your session has expired. Sign in again; no new request was sent.');
    }
    const body = JSON.stringify(command);
    if (new TextEncoder().encode(body).length > 128 * 1024) {
      throw new RegistryRequestError('payload_too_large', 'The selected project exceeds the request size limit.');
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw new RegistryRequestError('cancelled', 'Request cancelled before sending.');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, timeoutMs);
    try {
      const response = await fetcher(url.href, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${actor.idToken}` },
        body,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        signal: controller.signal,
      });
      const text = await response.text();
      if (new TextEncoder().encode(text).length > 4 * 1024 * 1024) {
        throw new RegistryRequestError('invalid_response', 'The response is too large. Its outcome could not be verified.', true);
      }
      const payload = JSON.parse(text);
      if (identity()?.uid !== actor.uid) {
        throw new RegistryRequestError('session_changed', 'Your account changed. The previous response was discarded.', true);
      }
      if (!response.ok || payload?.success !== true) {
        const error = payload?.error;
        const known = error && typeof error.code === 'string' && typeof error.message === 'string'
          && ['rejected', 'unknown'].includes(error.outcome);
        throw new RegistryRequestError(
          known ? error.code : 'unavailable',
          known ? error.message : 'The result could not be verified. Retry the same request.',
          !known || error.outcome === 'unknown',
          response.status,
        );
      }
      if (!payload.data || typeof payload.data !== 'object') {
        throw new RegistryRequestError('invalid_response', 'No verified result was returned.', true);
      }
      return payload.data as T;
    } catch (cause) {
      if (cause instanceof RegistryRequestError) throw cause;
      throw new RegistryRequestError('connection_unknown', 'Connection interrupted. The operation may have completed. Retry the same request, not a replacement.', true);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  };
}

const WRITE_ACTIONS = new Set([
  'create_plan', 'edit_metadata', 'set_phases', 'revise_estimate',
  'attach_existing_appointment', 'import_legacy_plan', 'approve_phase_completion', 'reopen_phase',
]);
function intentText(command: RegistryCommand) {
  if (!WRITE_ACTIONS.has(command?.action) || typeof command.requestId !== 'string'
      || !/^[A-Za-z0-9_-]{8,160}$/.test(command.requestId)
      || !command.data || typeof command.data !== 'object' || Array.isArray(command.data)
      || Object.keys(command).some(key => !['action', 'requestId', 'data'].includes(key))) {
    throw new RegistryRequestError('invalid_pending_request', 'Pending request data needs manual review. No operation was sent.');
  }
  const text = JSON.stringify(command);
  if (new TextEncoder().encode(text).length > 128 * 1024) {
    throw new RegistryRequestError('payload_too_large', 'The pending request exceeds the Projects size limit.');
  }
  return text;
}
function requireMutationAcknowledgement(value: unknown, command: RegistryCommand): void {
  const result = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
  if (!result || result.success !== true || typeof result.projectId !== 'string'
      || !result.projectId || result.projectId.length > 180 || result.projectId.trim() !== result.projectId
      || /[\/\x00-\x1f]/.test(result.projectId)
      || !Number.isSafeInteger(result.version) || (result.version as number) < 1
      || typeof result.changed !== 'boolean' || typeof result.replayed !== 'boolean'
      || (typeof command.data.projectId === 'string' && result.projectId !== command.data.projectId)) {
    throw new RegistryRequestError('invalid_acknowledgement', 'The server response does not confirm this exact project operation. Recovery evidence was retained; retry the same request.', true);
  }
}

/** A token-free session journal is pending intent, never authoritative Project data. */
export function createIntentJournal(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, uid: string): IntentJournal {
  if (!uid || uid.length > 180) throw new Error('A current user identity is required.');
  const key = `demac.projects.pending.v1:${uid}`;
  return {
    read() {
      const raw = storage.getItem(key);
      if (raw === null) return null;
      try {
        if (raw.length > 140 * 1024) throw new Error();
        const envelope = JSON.parse(raw);
        if (envelope.version !== 1 || envelope.uid !== uid) throw new Error();
        return JSON.parse(intentText(envelope.command)) as RegistryCommand;
      } catch {
        throw new RegistryRequestError('invalid_pending_request', 'A saved pending operation needs review. It was not deleted or resubmitted.');
      }
    },
    write(command) {
      storage.setItem(key, JSON.stringify({ version: 1, uid, command: JSON.parse(intentText(command)) }));
    },
    clear() {
      storage.removeItem(key);
    },
  };
}

/** Serial write intent survives a lost response/reload; only explicit same-request retry. */
export function createRegistryWriter(request: RegistryRequest, makeId = () => crypto.randomUUID(), journal?: IntentJournal) {
  const restored = journal?.read();
  let pendingText: string | null = restored ? intentText(restored) : null;
  let running = false;
  let ambiguous = Boolean(restored);
  const clear = () => {
    journal?.clear();
    pendingText = null;
    ambiguous = false;
  };
  async function execute<T>(): Promise<T> {
    if (!pendingText || running) throw new RegistryRequestError('write_busy', 'Resolve the current operation first.');
    running = true;
    try {
      const command = JSON.parse(pendingText) as RegistryCommand;
      const result = await request<T>(command);
      requireMutationAcknowledgement(result, command);
      try {
        clear();
      } catch {
        throw new RegistryRequestError('journal_cleanup', 'The server replied successfully, but local recovery state could not be cleared. Retry the same request.', true);
      }
      return result;
    } catch (error) {
      ambiguous = ambiguous || !(error instanceof RegistryRequestError) || error.uncertain;
      if (!ambiguous) {
        try { clear(); } catch { ambiguous = true; }
      }
      throw error;
    } finally {
      running = false;
    }
  }
  return {
    hasPending: () => pendingText !== null,
    isRunning: () => running,
    pendingSummary: () => {
      if (!pendingText) return null;
      const command = JSON.parse(pendingText) as RegistryCommand;
      return { requestId: command.requestId!, action: command.action };
    },
    async start<T>(action: string, data: Record<string, unknown>): Promise<T> {
      if (pendingText || running) throw new RegistryRequestError('write_busy', 'Resolve the previous operation before sending another.');
      const text = intentText({ action, data, requestId: `projects-${makeId()}` });
      try {
        journal?.write(JSON.parse(text) as RegistryCommand);
      } catch {
        throw new RegistryRequestError('journal_unavailable', 'Pending-request protection is unavailable. No operation was sent.');
      }
      pendingText = text;
      return execute<T>();
    },
    retry: <T>() => execute<T>(),
  };
}
export function minutesLabel(minutes: number | null | undefined): string {
  return typeof minutes === 'number' && Number.isFinite(minutes)
    ? `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(minutes / 60)}h`
    : 'Not reconciled';
}
