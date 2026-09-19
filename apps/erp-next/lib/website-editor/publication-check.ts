import { readPublishedVrfContent } from '@/lib/public-vrf-public';
import { values } from './contract';
import type { PublicVrfContent } from '@/lib/public-vrf-content';

/** Verify the exact source used by the public renderer, without privileged auth. */
export async function verifyPublishedWebsiteVersion(result: { publicationId?: string; content: PublicVrfContent }, read: () => Promise<PublicVrfContent | null> = readPublishedVrfContent): Promise<void> {
  if (!result.publicationId || !result.content?.hero) throw new Error('Invalid publication acknowledgement. Reload to recover.');
  const visible = await read();
  const fingerprint = (content: PublicVrfContent) => JSON.stringify([
    Object.entries(values(content)).sort(([a], [b]) => a.localeCompare(b)),
    content.hero.primaryCta, content.hero.secondaryCta, content.finalCta.primaryCta, content.finalCta.secondaryCta,
  ]);
  if (!visible || visible.publicationId !== result.publicationId || fingerprint(visible) !== fingerprint(result.content)) {
    throw new Error('The visitor version has not confirmed this publication. Retry the same publication to verify it; no new version is required.');
  }
}
