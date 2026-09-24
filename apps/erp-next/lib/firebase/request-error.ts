/** Typed transport failures. A programming error is never evidence of connectivity loss. */
export class FirebaseRequestError extends Error {
  constructor(message: string, public readonly status: number, public readonly code = '') {
    super(message);
    this.name = 'FirebaseRequestError';
  }
}

const invalidCredentials = new Set([
  'TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND', 'INVALID_REFRESH_TOKEN',
  'INVALID_ID_TOKEN', 'PROJECT_NUMBER_MISMATCH', 'INVALID_LOGIN_CREDENTIALS',
  'INVALID_PASSWORD', 'EMAIL_NOT_FOUND', 'PERMISSION_DENIED', 'UNAUTHENTICATED',
]);

export function isTransientFirebaseError(error: unknown): boolean {
  if (!(error instanceof FirebaseRequestError) || invalidCredentials.has(error.code)) return false;
  return error.status === 0 || error.status === 408 || error.status === 429
    || (error.status >= 500 && error.status <= 599);
}

export async function fetchFirebaseResponse(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    // Fetch rejects with TypeError on transport failure. Do not classify arbitrary
    // application exceptions by matching their English error-message text.
    if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) {
      throw new FirebaseRequestError('The connection could not be completed. Retry when connected.', 0);
    }
    throw error;
  }
}

export async function firebaseResponseError(response: Response, fallback: string): Promise<FirebaseRequestError> {
  let code = '';
  // Never reflect response bodies, URLs, credentials or HTML error pages to the UI/log.
  try {
    const value = await response.json();
    const raw = value?.error?.status ?? value?.error?.message;
    if (typeof raw === 'string') code = /^[A-Z][A-Z_]{2,79}(?=$|\s*:)/.exec(raw)?.[0] ?? '';
  } catch { /* The HTTP status is sufficient for a non-JSON gateway failure. */ }
  return new FirebaseRequestError(code || fallback, response.status, code);
}

/** A broken response stream is retryable; malformed application JSON is not. */
export async function readFirebaseJson<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) {
      throw new FirebaseRequestError('The response could not be completed. Retry when connected.', 0);
    }
    throw error;
  }
}
