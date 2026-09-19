export { PAGE, descriptors, values, applyChanges, imageUrl } from '../../../../functions/websiteEditorialContract';
export type { EditorialField, EditorialChange } from '../../../../functions/websiteEditorialContract';

export const EDITOR_PROTOCOL = 'demac-website-editor-v1';
export const EDITOR_PATH = '/website-editor/';
export const LAUNCH_TTL_MS = 60_000;
export const SESSION_TTL_MS = 30 * 60_000;
export function isOwner(principal: { active: boolean; role: string }, mode: string) {
  return mode === 'firebase' && principal.active && principal.role === 'super_admin';
}
export function isReviewBuild() { return process.env.NEXT_PUBLIC_WEBSITE_EDITOR_MODE === 'review'; }
export function isEditorEnabled() { return ['review', 'live'].includes(process.env.NEXT_PUBLIC_WEBSITE_EDITOR_MODE ?? ''); }
export function sameMessage(event: MessageEvent, source: Window | null, channel: string) {
  return event.origin === window.location.origin && event.source === source && event.data?.protocol === EDITOR_PROTOCOL && event.data?.channel === channel;
}

export function isPublicWebsiteRoute(pathname: string) {
  const path = pathname.replace(/\/$/, '') || '/';
  return ['/', '/about', '/services', '/services/commercial', '/services/vrf-systems', '/careers', '/contact', '/project-gallery'].includes(path)
    || /^\/project-gallery\/[a-z0-9_-]+$/i.test(path);
}

/** Typed host commands keep navigation and content messages in agreement. */
export type EditorFrameCommand =
  | { type: 'initialize' }
  | { type: 'state'; pageId: 'vrf'; changes: import('../../../../functions/websiteEditorialContract').EditorialChange[]; editing: boolean }
  | { type: 'navigate'; path: string }
  | { type: 'locate'; key: string }
  | { type: 'stop' };
