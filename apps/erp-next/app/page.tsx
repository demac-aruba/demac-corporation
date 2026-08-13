import type { Metadata } from 'next';
import { PublicFooter, PublicHeader } from '@/components/public/public-site-shell';
import { PublicHeroSlider } from '@/components/public/public-hero-slider';
import { PublicHomeSections } from '@/components/public/public-home-sections';
import { loadPublishedWebsiteContent } from '@/lib/public-website-public';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata: Metadata = {
  title: { absolute: 'DEMAC Professional Cooling Solutions | Air Conditioning Aruba' },
  description: 'Professional air conditioning sales, installation, service, maintenance, diagnostics, repairs, commercial cooling and VRF solutions across Aruba.',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  keywords: ['air conditioning Aruba','airco Aruba','AC service Aruba','AC installation Aruba','commercial air conditioning Aruba','VRF Aruba','DEMAC Professional Cooling Solutions'],
  openGraph: {
    title: 'DEMAC Professional Cooling Solutions | Aruba',
    description: 'Premium residential, light-commercial, commercial and VRF cooling solutions in Aruba.',
    url: 'https://demac-aruba.com',
    siteName: 'DEMAC Professional Cooling Solutions',
    locale: 'en_AW',
    type: 'website',
  },
};

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'HVACBusiness',
  name: 'DEMAC Professional Cooling Solutions',
  url: 'https://demac-aruba.com',
  address: { '@type': 'PostalAddress', streetAddress: 'Santa Cruz 54 C', addressLocality: 'Santa Cruz', addressCountry: 'AW' },
  areaServed: 'Aruba',
  description: 'Professional residential, commercial and VRF air conditioning solutions in Aruba.',
};

export default async function HomePage() {
  const publishedContent = await loadPublishedWebsiteContent();

  return (
    <main className="public-site public-home-approved">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <PublicHeader active="home" />
      <PublicHeroSlider initialContent={publishedContent} />
      <PublicHomeSections />
      <PublicFooter />
    </main>
  );
}
