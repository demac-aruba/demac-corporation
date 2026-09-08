import { CareersPreview } from '@/components/careers/careers-preview';
export const metadata = { title: 'Careers design preview · DEMAC', robots: { index: false, follow: false } };
export default function PreviewPage() {
  const allowed = process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development' || (process.env.CAREERS_PREVIEW_BUILD === '1' && process.env.VERCEL_ENV !== 'production');
  return allowed ? <CareersPreview /> : <main><h1>Preview unavailable</h1></main>;
}
