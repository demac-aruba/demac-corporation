import type { VrfCard } from './public-vrf-content';
import { defaults, imageUrl, normalizeIndoor } from '../../../functions/websiteEditorialContract';

/** Native-size owner-approved concept renders. One catalogue is shared by
 * the public page, Website Manager and the protected editorial service. */
export const defaultVrfIndoorUnits: VrfCard[] = defaults.indoorUnits as VrfCard[];
export function safeIndoorImageUrl(value: unknown, fallback = ''): string { return imageUrl(value, fallback); }
export function normalizeVrfIndoorUnits(value: unknown): VrfCard[] { return normalizeIndoor(value) as VrfCard[]; }
