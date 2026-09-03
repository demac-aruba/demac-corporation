import type { MetadataRoute } from 'next';

export const dynamic = 'force-static';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://demac-aruba.com';
  return [
    { url: base, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/services`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/services/commercial`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/services/vrf-systems`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/project-gallery`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/contact`, changeFrequency: 'monthly', priority: 0.9 },
  ];
}
