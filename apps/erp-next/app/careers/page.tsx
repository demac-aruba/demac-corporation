import type { Metadata } from 'next';
import Link from 'next/link';
import { CareersPublic } from '@/components/careers/careers-public';
import { CareersPreview } from '@/components/careers/careers-preview';

export const metadata: Metadata = {
  title: 'Careers · DEMAC',
  description: 'Explore career opportunities at DEMAC Professional Cooling Solutions.',
  robots: { index: false, follow: false },
};

export default function CareersPage() {
  if (process.env.NEXT_PUBLIC_CAREERS_LIVE_ENABLED === 'true') return <CareersPublic />;
  // Evaluate the isolated design-review gate during static export.
  const allowed = process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development' || (process.env.CAREERS_PREVIEW_BUILD === '1' && process.env.VERCEL_ENV !== 'production');
  if (!allowed) return <main style={{ padding: '3rem', maxWidth: '48rem', margin: 'auto' }}><h1>Preview unavailable</h1><p>This review page is not enabled in production.</p><Link href="/">Back to DEMAC</Link></main>;
  return <CareersPreview />;
}
