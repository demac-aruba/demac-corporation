import type { Metadata } from 'next';
import { VrfPageRuntime } from '@/components/public/vrf-page-runtime';
import { loadPublishedVrfContent } from '@/lib/public-vrf-public';

export const metadata: Metadata = {
  title: 'VRF Systems in Aruba',
  description: 'Large VRF, modular VRF and mini VRF design, installation, commissioning, service and maintenance in Aruba.',
  alternates: { canonical: '/services/vrf-systems' },
  openGraph: {
    title: 'VRF Systems in Aruba | DEMAC',
    description: 'Smarter zoning, energy efficiency and end-to-end VRF support for buildings across Aruba.',
    type: 'website',
    url: '/services/vrf-systems',
  },
};

export default async function VrfSystemsPage() {
  return <VrfPageRuntime initialContent={await loadPublishedVrfContent()} />;
}
