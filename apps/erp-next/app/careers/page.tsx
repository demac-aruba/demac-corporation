import type { Metadata } from 'next';
import Link from 'next/link';
import { CareersPreview } from '@/components/careers/careers-preview';

export const metadata: Metadata = {
  title: 'Careers · DEMAC preview',
  description: 'Integrated Careers review in the DEMAC website. Test applications only.',
  robots: { index: false, follow: false },
};

export default function CareersPage() {
  // Static export: evaluate the review gate during BUILD, never in client configuration.
  const allowed = process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development' || (process.env.CAREERS_PREVIEW_BUILD === '1' && process.env.VERCEL_ENV !== 'production');
  if (!allowed) return <main style={{ padding: '3rem', maxWidth: '48rem', margin: 'auto' }}><h1>Preview unavailable</h1><p>This review page is not enabled in production.</p><Link href="/">Back to DEMAC</Link></main>;
  return <CareersPreview />;
}
