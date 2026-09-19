'use client';

import { useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { loadFirebasePrincipal } from '@/lib/firebase/principal';
import { EDITOR_PATH, EDITOR_PROTOCOL, LAUNCH_TTL_MS, isEditorEnabled, isOwner } from '@/lib/website-editor/contract';

/** A one-use, source-window-bound launch grant. No persistent edit-mode flag,
 * auth token in a URL, or automatic activation from a signed-in public visit. */
export function WebsiteEditorLaunchButton() {
  const { principal, mode, status } = useAuth();
  const [error, setError] = useState('');
  if (!isEditorEnabled() || status !== 'ready' || !isOwner(principal, mode)) return null;
  function launch() {
    setError('');
    const nonce = crypto.randomUUID();
    const popup = window.open(`${EDITOR_PATH}#${nonce}`, `demac-edit-${nonce}`);
    if (!popup) { setError('Allow this site to open the editor in a new tab, then try again.'); return; }
    let settled = false;
    const timeout = window.setTimeout(cleanup, LAUNCH_TTL_MS);
    function cleanup() { settled = true; window.clearTimeout(timeout); window.removeEventListener('message', receive); }
    async function receive(event: MessageEvent) {
      if (settled || event.source !== popup || event.origin !== window.location.origin || event.data?.protocol !== EDITOR_PROTOCOL || event.data?.type !== 'request-launch' || event.data?.nonce !== nonce) return;
      cleanup();
      try {
        const current = await loadFirebasePrincipal();
        if (!current.active || current.role !== 'super_admin' || current.userId !== principal.userId) throw new Error('Owner / Super Admin access is required.');
        popup!.postMessage({ protocol: EDITOR_PROTOCOL, type: 'launch-granted', nonce, actorId: current.userId }, window.location.origin);
      } catch (cause) {
        popup!.postMessage({ protocol: EDITOR_PROTOCOL, type: 'launch-denied', nonce }, window.location.origin);
        setError(cause instanceof Error ? cause.message : 'Unable to authorize the editor.');
      }
    }
    window.addEventListener('message', receive);
  }
  return <div><button type="button" className="btn primary" onClick={launch}>✎ Edit Front End</button>{error ? <p role="alert">{error}</p> : null}</div>;
}
