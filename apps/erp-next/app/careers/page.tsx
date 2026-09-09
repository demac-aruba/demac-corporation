import type { Metadata } from 'next';
import { CareersPublic } from '@/components/careers/careers-public';
import { CareersPreview } from '@/components/careers/careers-preview';
import { CareersAvailability } from '@/components/careers/careers-availability';

export const metadata: Metadata = {
  title: 'Careers · DEMAC',
  description: 'Explore career opportunities at DEMAC Professional Cooling Solutions.',
  robots: { index: false, follow: false },
};

export default function CareersPage() {
  if (process.env.NEXT_PUBLIC_CAREERS_LIVE_ENABLED === 'true') return <CareersPublic />;
  // Evaluate the isolated design-review gate during static export.
  const allowed = process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development' || (process.env.CAREERS_PREVIEW_BUILD === '1' && process.env.VERCEL_ENV !== 'production');
  // Public navigation must not expose internal preview tools or accept applications
  // while the live intake remains disabled. This screen makes no Careers API calls.
  if (!allowed) return <CareersAvailability />;
  return <CareersPreview />;
}
