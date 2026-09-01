export type AvailabilityRequestToken = {
  revision: number;
  signature: string;
  signal: AbortSignal;
};

export type LatestAvailabilityRunResult = 'published' | 'rejected' | 'stale';

type LatestAvailabilityRun<TResult> = {
  signature: string;
  request: (signal: AbortSignal) => Promise<TResult>;
  currentSignature: () => string;
  publish: (result: TResult) => void;
  reject?: (error: unknown) => void;
  settle?: () => void;
};

export function createLatestAvailabilityGate() {
  let revision = 0;
  let active: { token: AvailabilityRequestToken; controller: AbortController } | null = null;

  const begin = (signature: string): AvailabilityRequestToken => {
    active?.controller.abort();
    const controller = new AbortController();
    const token = { revision: ++revision, signature, signal: controller.signal };
    active = { token, controller };
    return token;
  };

  const isCurrent = (token: AvailabilityRequestToken, signature: string) => Boolean(
    active
      && active.token.revision === token.revision
      && !token.signal.aborted
      && token.signature === signature,
  );

  const complete = (token: AvailabilityRequestToken) => {
    if (active?.token.revision === token.revision) active = null;
  };

  return {
    begin,
    invalidate() {
      revision += 1;
      active?.controller.abort();
      active = null;
    },
    isCurrent,
    complete,
    async runLatest<TResult>({
      signature,
      request,
      currentSignature,
      publish,
      reject,
      settle,
    }: LatestAvailabilityRun<TResult>): Promise<LatestAvailabilityRunResult> {
      const token = begin(signature);
      try {
        const result = await request(token.signal);
        if (!isCurrent(token, currentSignature())) return 'stale';
        publish(result);
        return 'published';
      } catch (error) {
        if (!isCurrent(token, currentSignature())) return 'stale';
        reject?.(error);
        return 'rejected';
      } finally {
        if (isCurrent(token, currentSignature())) settle?.();
        complete(token);
      }
    },
  };
}

export type BookingCommitCapture<T> = {
  value: T;
  release: () => void;
};

export function createBookingCommitGate() {
  let active = false;
  const release = () => {
    active = false;
  };

  return {
    tryAcquire() {
      if (active) return false;
      active = true;
      return true;
    },
    tryCapture<T>(capture: () => T | null | undefined): BookingCommitCapture<T> | null {
      if (active) return null;
      active = true;
      let value: T | null | undefined;
      try {
        value = capture();
      } catch (error) {
        release();
        throw error;
      }
      if (value == null) {
        release();
        return null;
      }
      let released = false;
      return {
        value,
        release() {
          if (released) return;
          released = true;
          release();
        },
      };
    },
    release,
    isActive() {
      return active;
    },
  };
}

type SignedExpiringOffer = {
  signature: string;
  offerExpiresAt?: string;
};

export type BookingOfferCommitCapture<T extends SignedExpiringOffer> =
  | { status: 'captured'; offer: T; release: () => void }
  | { status: 'busy' | 'missing' | 'stale' | 'expired' };

export function captureBookingOfferForCommit<T extends SignedExpiringOffer>(
  gate: ReturnType<typeof createBookingCommitGate>,
  offer: T | null,
  currentSignature: string,
  nowMs: number,
): BookingOfferCommitCapture<T> {
  if (gate.isActive()) return { status: 'busy' };
  if (!offer) return { status: 'missing' };
  if (offer.signature !== currentSignature) return { status: 'stale' };
  if (officeOfferIsExpired(offer.offerExpiresAt, nowMs)) return { status: 'expired' };
  const captured = gate.tryCapture(() => offer);
  return captured
    ? { status: 'captured', offer: captured.value, release: captured.release }
    : { status: 'busy' };
}

export function liveBookingTargetKey(target: { dateKey: string; vanId: string; start: string }, mode = 'standard') {
  return `${mode}|${target.dateKey}|${target.vanId}|${target.start}`;
}

export function officeOfferExpiresAtMs(expiresAt?: string) {
  if (!expiresAt) return Number.NaN;
  const parsed = Date.parse(expiresAt);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function officeOfferIsExpired(expiresAt: string | undefined, nowMs: number) {
  const expiresAtMs = officeOfferExpiresAtMs(expiresAt);
  return Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs;
}
