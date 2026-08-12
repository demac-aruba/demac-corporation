import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicSiteShell } from '@/components/public/public-site-shell';

export const metadata: Metadata = {
  title: 'Air Conditioning Projects in Aruba',
  description: 'Explore the types of residential, commercial, VRF, installation, maintenance and technical cooling projects handled by DEMAC in Aruba.',
  alternates: { canonical: '/projects' },
};

const galleries = [
  ['Residential Installations', 'Split-system installations and replacement projects for homes and villas across Aruba.'],
  ['Light Commercial', 'Cassette, floor-ceiling and central-air applications for offices, clinics, restaurants and professional spaces.'],
  ['Commercial Cooling', 'Larger-capacity cooling equipment and commercial service work for demanding operating environments.'],
  ['VRF Systems', 'Multi-zone system layouts, installations, technical assessments and specialized VRF work.'],
  ['Service & Maintenance', 'Before-and-after maintenance work, deep cleaning and equipment restoration.'],
  ['Diagnostics & Repairs', 'Technical investigations and corrective work for refrigeration, controls and A/C-related electrical issues.'],
];

export default function ProjectsPage() {
  return (
    <PublicSiteShell active="projects">
      <section className="public-page-hero">
        <div className="public-page-hero-inner">
          <div><span className="public-page-kicker">DEMAC projects</span><h1>Real work. Real equipment. Built for Aruba.</h1><p>Our project gallery is designed to show the quality of the work behind the brand—from clean residential installations to commercial systems, maintenance and VRF.</p></div>
          <div className="public-page-hero-panel" aria-hidden="true"><div className="public-page-panel-unit"/><div className="public-page-panel-air"/></div>
        </div>
      </section>
      <section className="public-page-body">
        <div className="public-page-intro"><h2>A gallery built around proof, not stock claims.</h2><p>This first visual foundation uses project categories instead of invented customer stories. As DEMAC’s real before-and-after and installation media is added, these cards become filterable galleries with actual project photos, system types and project details.</p></div>
        <div className="public-project-gallery">
          {galleries.map(([title,copy])=><article className="public-gallery-card" key={title}><div className="public-gallery-visual" aria-hidden="true"/><div className="public-gallery-copy"><span>Project category</span><h2>{title}</h2><p>{copy}</p></div></article>)}
        </div>
        <div className="public-page-band"><div><h2>Planning a cooling project?</h2><p>Residential, commercial or specialized—tell us what property and system you are working with and we can guide the next step.</p></div><Link href="/contact?request=project">Discuss your project →</Link></div>
      </section>
    </PublicSiteShell>
  );
}
