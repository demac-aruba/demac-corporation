'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { callOfficeBookingAuthority } from '../../lib/office-booking-authority';

type Lease = { held: boolean; mine: boolean; ownerName: string; expiresAt: string | null; serverTime: string; ttlMs: number; token?: string };
type Controller = { appointmentId: string; sessionId: string; token: string; alive: boolean; owned: boolean; deadline: number; running: boolean; retry?: () => void; timer?: number; expiry?: number };
type State = { controller: Controller | null; owned: boolean; loading: boolean; message: string };

// Never acquires during the drawer's background prefetch. Each activation gets
// a distinct session, so delayed cleanup cannot release a later activation.
export function useChargeEditSession(appointmentId: string, enabled: boolean) {
  const current = useRef<Controller | null>(null);
  const [state, setState] = useState<State>({ controller: null, owned: false, loading: false, message: '' });
  const retry = useCallback(() => current.current?.retry?.(), []);
  useEffect(() => {
    if (!enabled) { current.current = null; return; }
    const owner: Controller = { appointmentId, sessionId: crypto.randomUUID(), token: '', alive: true, owned: false, deadline: 0, running: false };
    current.current = owner;
    setState({ controller: owner, owned: false, loading: true, message: 'Comprobando acceso de edición…' });
    const payload = () => ({ appointmentId, editSessionId: owner.sessionId, editToken: owner.token });
    const release = () => {
      if (owner.token) void callOfficeBookingAuthority('release_appointment_charge_edit', payload()).catch(() => { /* Server expiry is the recovery path. */ });
    };
    const failClosed = (message: string) => {
      owner.owned = false;
      if (owner.alive) setState({ controller: owner, owned: false, loading: false, message });
    };
    const request = async (renew: boolean) => {
      if (!owner.alive || owner.running) return;
      owner.running = true;
      if (!renew) setState({ controller: owner, owned: false, loading: true, message: 'Comprobando acceso de edición…' });
      const started = performance.now();
      try {
        const result = await callOfficeBookingAuthority<{ success: true; edit: Lease }>(renew ? 'renew_appointment_charge_edit' : 'acquire_appointment_charge_edit', payload());
        const edit = result.edit;
        if (!edit || !Number.isFinite(Date.parse(edit.serverTime))) throw Error('Actualiza el ERP: el servidor no confirmó la protección de edición.');
        if (edit.mine && edit.token) owner.token = edit.token;
        if (!owner.alive) { release(); return; }
        if (!edit.mine || !edit.token || !edit.expiresAt) {
          failClosed(`${edit.ownerName || 'Otro operador'} está editando los importes y pagos de esta cita. Puedes consultar los datos; tu borrador se conserva.`);
          return;
        }
        // Subtract round-trip time rather than trusting the workstation clock.
        const expiryTime = Date.parse(edit.expiresAt);
        if (!Number.isFinite(expiryTime)) throw Error('El servidor no confirmó el vencimiento del acceso de edición.');
        owner.deadline = started + expiryTime - Date.parse(edit.serverTime) - 1000;
        if (owner.deadline <= performance.now()) throw Error('No se pudo renovar a tiempo el acceso de edición.');
        owner.owned = true;
        setState({ controller: owner, owned: true, loading: false, message: 'Edición reservada para ti en esta cita.' });
        window.clearTimeout(owner.expiry);
        owner.expiry = window.setTimeout(() => failClosed('La sesión de edición venció. Tu borrador se conserva; recupera el acceso antes de guardar.'), owner.deadline - performance.now());
        owner.timer = window.setTimeout(() => { if (document.visibilityState !== 'hidden') void request(true); }, 25_000);
      } catch (cause) {
        failClosed(cause instanceof Error ? cause.message : 'No se confirmó el acceso de edición. Tu borrador se conserva.');
      } finally { owner.running = false; }
    };
    // Reuse this activation's identity after an unknown acquire outcome; acquiring
    // again recovers its own token instead of racing an asynchronous release.
    owner.retry = () => { window.clearTimeout(owner.timer); void request(false); };
    const focus = () => {
      if (document.visibilityState === 'hidden' || !owner.owned) return;
      if (owner.deadline <= performance.now()) failClosed('La sesión de edición venció. Recupera el acceso y revisa los datos actuales.');
      else { window.clearTimeout(owner.timer); void request(true); }
    };
    // Cancels the first development StrictMode mount before making a request.
    owner.timer = window.setTimeout(() => void request(false), 0);
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', focus);
    return () => {
      owner.alive = false; owner.owned = false;
      window.clearTimeout(owner.timer); window.clearTimeout(owner.expiry);
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus);
      if (current.current === owner) current.current = null;
      release();
    };
  }, [appointmentId, enabled]);
  const credentials = useCallback(() => {
    const owner = current.current;
    if (!owner || !owner.alive || !owner.owned || owner.deadline <= performance.now()) return null;
    return { editSessionId: owner.sessionId, editToken: owner.token };
  }, []);
  const valid = enabled && state.controller === current.current && state.controller?.appointmentId === appointmentId;
  return { owned: Boolean(valid && state.owned), loading: enabled && (!valid || state.loading),
    message: valid ? state.message : enabled ? 'Comprobando acceso de edición…' : '', credentials, retry };
}
