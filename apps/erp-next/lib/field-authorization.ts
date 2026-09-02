import type { FieldAllowedAction } from './field-authority-contract';

export type { FieldAllowedAction } from './field-authority-contract';

/**
 * Server-projected action contract for Field UI.
 *
 * Field Operations Authority is the only component allowed to decide which actions a
 * principal may perform for a specific Work Order/Visit. The client must never infer
 * authority from role, Van, staff identity or responsibility. It may only render UX from
 * the `allowedActions` projection returned by the server; every future mutation is then
 * re-authorized server-side.
 */
export type FieldActionProjection = {
  allowedActions: readonly FieldAllowedAction[];
};

export function fieldActionAllowed(projection: FieldActionProjection, action: FieldAllowedAction): boolean {
  return projection.allowedActions.includes(action);
}
