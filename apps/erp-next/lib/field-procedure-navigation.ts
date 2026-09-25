// A browser-local navigation guard, not an authorization boundary. Durable pending
// captures may be left; only uncommitted edits/recording are protected from an app click.
const blockers = new Set<() => boolean>();
export function registerProcedureExitGuard(blocked: () => boolean) {
  blockers.add(blocked); return () => { blockers.delete(blocked); };
}
export function requestProcedureExit(): boolean {
  const blocked = [...blockers].some(check => check());
  if (blocked && typeof window !== 'undefined') window.dispatchEvent(new Event('demac-procedure-unsaved'));
  return !blocked;
}
