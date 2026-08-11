import { browserKeys, loadBrowserValue, saveBrowserValue } from './browser-store';
import type { DispatchAssignmentStage } from './browser-dispatch-operations';

export type BrowserDispatchEvent = {
  id: string;
  workOrderId: string;
  vanId: string;
  fromStage: DispatchAssignmentStage;
  toStage: DispatchAssignmentStage;
  occurredAt: string;
  actor: string;
  note?: string;
};

export function loadDispatchEvents() {
  return loadBrowserValue<BrowserDispatchEvent[]>(browserKeys.dispatchEvents, []);
}

export function recordDispatchEvent(args: {
  workOrderId: string;
  vanId: string;
  fromStage: DispatchAssignmentStage;
  toStage: DispatchAssignmentStage;
  actor?: string;
  note?: string;
}) {
  if (args.fromStage === args.toStage) return undefined;
  const event: BrowserDispatchEvent = {
    id: `DSP-${args.workOrderId}-${args.vanId}-${Date.now().toString().slice(-10)}`,
    workOrderId: args.workOrderId,
    vanId: args.vanId,
    fromStage: args.fromStage,
    toStage: args.toStage,
    occurredAt: new Date().toISOString(),
    actor: args.actor ?? 'Operations / Preview',
    note: args.note?.trim() || undefined,
  };
  saveBrowserValue(browserKeys.dispatchEvents, [event, ...loadDispatchEvents()]);
  return event;
}
