import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicSiteShell } from '@/components/public/public-site-shell';

export const metadata: Metadata = {
  title: 'About DEMAC Professional Cooling Solutions',
  description: 'Learn about DEMAC Professional Cooling Solutions, an Aruba-based air-conditioning company serving residential, commercial and specialized cooling needs.',
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <PublicSiteShell active="about">
      <section className="public-page-hero">
        <div className="public-page-hero-inner">
          <div><span className="public-page-kicker">About DEMAC</span><h1>Professional cooling solutions with Aruba at the center.</h1><p>DEMAC serves homeowners, businesses and specialized properties with a practical combination of equipment, field experience, technical diagnostics and ongoing service.</p></div>
          <div className="public-page-hero-panel" aria-hidden="true"><div className="public-page-panel-unit"/><div className="public-page-panel-air"/></div>
        </div>
      </section>
      <section className="public-page-body">
        <div className="public-page-intro"><h2>More than an A/C sales company.</h2><p>Our work spans the full cooling lifecycle: selection, sales, installation, maintenance, diagnostics, repair and specialized commercial support. The goal is simple—give each property a solution that makes technical and operational sense.</p></div>
        <div className="public-about-grid">
          <article className="public-about-card"><h2>Residential to Commercial</h2><p>DEMAC works with individual homeowners as well as restaurants, clinics, offices, professional practices, hotels and commercial facilities. That range helps us approach each system according to its actual operating needs rather than forcing every customer into the same solution.</p></article>
          <article className="public-about-card"><h2>Advanced Cooling Capability</h2><p>Beyond residential splits, our work includes light-commercial equipment, larger commercial systems, VRF solutions and service for internal chilled-water air-handling units. Specialized requirements can be assessed before the right path is recommended.</p></article>
          <article className="public-about-card"><h2>Technical Problem Solving</h2><p>Diagnostics are treated as their own professional step. When an A/C problem involves refrigerant, controls, equipment condition or the electrical supply feeding the air conditioner, the team can investigate the cause before proposing corrective work.</p></article>
          <article className="public-about-card"><h2>Built for Aruba</h2><p>Coastal exposure, heat, access conditions and the way properties are built in Aruba affect how equipment should be selected, installed and maintained. Anti-corrosive treatment, custom brackets and site-specific solutions are part of that local operating reality.</p></article>
        </div>
        <div className="public-page-band"><div><h2>See what DEMAC can do for your property.</h2><p>Start with your building type, equipment and what you need to accomplish. We can help identify the right service or project path.</p></div><Link href="/contact">Contact our team →</Link></div>
      </section>
    </PublicSiteShell>
  );
}
