import { CareersPreview } from '@/components/careers/careers-preview';

export const metadata = {
  title: 'Careers live review · DEMAC',
  description: 'Synthetic-data Careers review route for DEMAC owner acceptance.',
  robots: { index: false, follow: false },
};

/**
 * Owner live-review route.
 * Intentionally isolated from CareersPublic: it uses synthetic in-tab data only,
 * makes no Careers authority calls and sends no email. It is not linked from the
 * public navigation and can remain available while real intake stays disabled.
 */
export default function PreviewPage() {
  return <CareersPreview />;
}
