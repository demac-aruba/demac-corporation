import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicFooter, PublicHeader } from '@/components/public/public-site-shell';

export const metadata: Metadata = {
  title: { absolute: 'DEMAC Professional Cooling Solutions | Air Conditioning Aruba' },
  description:
    'Professional air conditioning sales, installation, service, maintenance, diagnostics, repairs, commercial cooling and VRF solutions across Aruba.',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  keywords: [
    'air conditioning Aruba',
    'airco Aruba',
    'AC service Aruba',
    'AC installation Aruba',
    'commercial air conditioning Aruba',
    'VRF Aruba',
    'DEMAC Professional Cooling Solutions',
  ],
  openGraph: {
    title: 'DEMAC Professional Cooling Solutions | Aruba',
    description:
      'Premium residential, light-commercial, commercial and VRF cooling solutions in Aruba.',
    url: 'https://demac-aruba.com',
    siteName: 'DEMAC Professional Cooling Solutions',
    locale: 'en_AW',
    type: 'website',
  },
};

type IconName =
  | 'home'
  | 'store'
  | 'building'
  | 'vrf'
  | 'sales'
  | 'tools'
  | 'service'
  | 'diagnostic'
  | 'shield'
  | 'bracket'
  | 'electric'
  | 'air'
  | 'restaurant'
  | 'clinic'
  | 'office'
  | 'hotel';

function LineIcon({ name }: { name: IconName }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const shapes: Record<IconName, React.ReactNode> = {
    home: <><path {...common} d="M3.5 11.2 12 4l8.5 7.2"/><path {...common} d="M5.5 10.2V20h13v-9.8M9.5 20v-6h5v6"/></>,
    store: <><path {...common} d="M4 9h16l-1.3-5H5.3L4 9Z"/><path {...common} d="M5 9v11h14V9M8 20v-6h4v6M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0"/></>,
    building: <><path {...common} d="M5 20V5h9v15M14 9h5v11M8 8h3M8 11h3M8 14h3M8 17h3M16.5 12h1M16.5 15h1M16.5 18h1"/></>,
    vrf: <><rect {...common} x="4" y="4" width="6" height="6" rx="1"/><rect {...common} x="14" y="4" width="6" height="6" rx="1"/><rect {...common} x="4" y="14" width="6" height="6" rx="1"/><rect {...common} x="14" y="14" width="6" height="6" rx="1"/></>,
    sales: <><path {...common} d="M3 5h2l2.2 9.2h9.9L20 8H6"/><circle {...common} cx="9" cy="19" r="1"/><circle {...common} cx="17" cy="19" r="1"/></>,
    tools: <><path {...common} d="m5 19 8.7-8.7M15.2 4.1a4 4 0 0 0-4.6 5.2L4 15.9 8.1 20l6.6-6.6a4 4 0 0 0 5.2-4.6l-2.6 2.6-3-3 2.6-2.6Z"/></>,
    service: <><circle {...common} cx="12" cy="12" r="3"/><path {...common} d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
    diagnostic: <><circle {...common} cx="10.5" cy="10.5" r="6.5"/><path {...common} d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5"/></>,
    shield: <><path {...common} d="M12 3 19 6v5.2c0 4.6-2.8 7.8-7 9.8-4.2-2-7-5.2-7-9.8V6l7-3Z"/><path {...common} d="m8.5 12 2.2 2.2 4.8-5"/></>,
    bracket: <><path {...common} d="M5 4h14v4H9v12H5V4Z"/><path {...common} d="M9 8 5 12M14 4l4 4"/></>,
    electric: <><path {...common} d="m13 2-7 11h6l-1 9 7-12h-6l1-8Z"/></>,
    air: <><path {...common} d="M3 8h10c3 0 3-4 0-4-1.4 0-2.2.8-2.5 1.7M3 12h16c3 0 3 4 0 4-1.4 0-2.2-.8-2.5-1.7M3 16h8"/></>,
    restaurant: <><path {...common} d="M6 3v7M9 3v7M6 7h3M7.5 10v11M16 3v18M16 3c3 2 4 5 4 8h-4"/></>,
    clinic: <><path {...common} d="M5 8h14v12H5zM9 8V4h6v4M12 11v6M9 14h6"/></>,
    office: <><path {...common} d="M4 20h16M6 20V5h8v15M14 9h4v11M9 8h2M9 11h2M9 14h2M9 17h2"/></>,
    hotel: <><path {...common} d="M4 20V6h16v14M7 9h3v3H7zM14 9h3v3h-3zM7 15h3v3H7zM14 15h3v3h-3z"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{shapes[name]}</svg>;
}

const solutionGroups: Array<{ icon: IconName; title: string; subtitle: string; detail: string }> = [
  { icon: 'home', title: 'Residential', subtitle: 'Homes & villas', detail: 'Comfort, efficiency and dependable service for everyday living.' },
  { icon: 'store', title: 'Light Commercial', subtitle: 'Up to 5 tons', detail: 'Cassette, floor-ceiling and central solutions for smaller commercial spaces.' },
  { icon: 'building', title: 'Commercial', subtitle: 'Above 5 tons', detail: 'Higher-capacity cooling solutions for demanding business environments.' },
  { icon: 'vrf', title: 'VRF Systems', subtitle: 'Advanced systems', detail: 'Flexible multi-zone technology for larger and more complex properties.' },
];

const services: Array<{ icon: IconName; title: string; description: string }> = [
  { icon: 'sales', title: 'A/C Sales', description: 'Residential, light-commercial, commercial and special-order cooling equipment.' },
  { icon: 'tools', title: 'Installations', description: 'Professional installation focused on performance, reliability and a clean finish.' },
  { icon: 'service', title: 'Service & Maintenance', description: 'Preventive and corrective care to keep air conditioning systems operating efficiently.' },
  { icon: 'diagnostic', title: 'Diagnostics & Repairs', description: 'Systematic troubleshooting and dependable repair solutions for cooling problems.' },
  { icon: 'shield', title: 'Anti-Corrosive Treatment', description: 'Protective treatment for outdoor condensers exposed to Aruba’s coastal environment.' },
  { icon: 'bracket', title: 'Custom Brackets & Metal Fabrication', description: 'Special iron brackets and custom mounting solutions fabricated for the job.' },
  { icon: 'electric', title: 'A/C Electrical Diagnostics', description: 'Specialized electrical diagnostics for power and supply issues related to air conditioning.' },
  { icon: 'air', title: 'UMA / Chilled-Water Air Handlers', description: 'Service and maintenance for internal chilled-water air-handling units and UMAs.' },
];

const industries: Array<{ icon: IconName; title: string }> = [
  { icon: 'home', title: 'Homes & Villas' },
  { icon: 'restaurant', title: 'Restaurants' },
  { icon: 'clinic', title: 'Clinics & Consultorios' },
  { icon: 'office', title: 'Offices & Professionals' },
  { icon: 'hotel', title: 'Hotels & Hospitality' },
  { icon: 'building', title: 'Commercial Properties' },
];

const projectTypes = [
  ['Residential installation', 'Comfort designed around the property.'],
  ['Commercial systems', 'Capacity for demanding operating environments.'],
  ['Service & restoration', 'Detailed maintenance and problem solving.'],
  ['VRF & specialized work', 'Advanced multi-zone cooling expertise.'],
];

const structuredData = {
  '@context': 'https://schema.org',
  '@type': 'HVACBusiness',
  name: 'DEMAC Professional Cooling Solutions',
  url: 'https://demac-aruba.com',
  address: {
    '@type': 'PostalAddress',
    streetAddress: 'Santa Cruz 54 C',
    addressLocality: 'Santa Cruz',
    addressCountry: 'AW',
  },
  areaServed: 'Aruba',
  description: 'Professional residential, commercial and VRF air conditioning solutions in Aruba.',
};

export default function HomePage() {
  return (
    <main className="public-site">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <PublicHeader active="home" />

      <section className="public-hero" id="home">
        <div className="public-hero-inner">
          <div className="public-hero-copy">
            <span className="public-eyebrow">Premium air conditioning solutions · Aruba</span>
            <h1>Cooling comfort for <span>homes & businesses</span> in <em>Aruba.</em></h1>
            <p>Sales, professional installation, service, maintenance, diagnostics and repairs—from residential comfort to commercial and VRF systems.</p>
            <div className="public-hero-actions">
              <Link className="public-button public-button-primary public-button-large" href="/contact?request=estimate">Request Estimate <span>→</span></Link>
              <Link className="public-button public-button-whatsapp public-button-large" href="/contact?channel=whatsapp"><span aria-hidden="true">◉</span> WhatsApp Us</Link>
            </div>
            <div className="public-proof-points">
              <span><b>✓</b> Aruba-based team</span>
              <span><b>✓</b> Residential to commercial</span>
              <span><b>✓</b> Island-wide service</span>
            </div>
          </div>

          <div className="public-hero-scene" aria-label="Premium cooling illustration">
            <div className="public-sky"><i /><i /><i /></div>
            <div className="public-ocean" />
            <div className="public-window-frame"><i /><i /></div>
            <div className="public-palm"><i /><i /><i /><i /><i /></div>
            <div className="public-wall-unit"><span>DEMAC</span><b>24°</b><i /><div className="public-vent" /></div>
            <div className="public-airflow"><i /><i /><i /><i /></div>
            <div className="public-sofa"><i /><i /><i /></div>
            <div className="public-table"><i /></div>
            <div className="public-plant"><i /><i /><i /></div>
          </div>
        </div>
      </section>

      <section className="public-solution-wrap" id="solutions">
        <div className="public-solution-grid">
          {solutionGroups.map((group) => (
            <article className="public-solution-card" key={group.title}>
              <span className="public-icon"><LineIcon name={group.icon} /></span>
              <div><h2>{group.title}</h2><small>{group.subtitle}</small><p>{group.detail}</p></div>
              <b aria-hidden="true">→</b>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section public-services" id="services">
        <div className="public-section-heading">
          <div><span>What we do</span><h2>Complete cooling solutions.<br />One professional team.</h2></div>
          <p>From the first equipment recommendation to ongoing maintenance and specialized diagnostics, DEMAC supports the full life of your cooling system.</p>
        </div>
        <div className="public-service-grid">
          {services.map((service) => (
            <article className="public-service-card" key={service.title}>
              <span className="public-service-icon"><LineIcon name={service.icon} /></span>
              <h3>{service.title}</h3>
              <p>{service.description}</p>
              <Link href="/services" aria-label={`Learn more about ${service.title}`}>Learn more <span>→</span></Link>
            </article>
          ))}
        </div>
      </section>

      <section className="public-industries" id="industries">
        <div className="public-industries-copy">
          <span className="public-eyebrow">Built for Aruba</span>
          <h2>Cooling expertise for every kind of property.</h2>
          <p>Our work ranges from a single residential split unit to specialized commercial systems and multi-zone VRF projects.</p>
          <div className="public-industry-grid">
            {industries.map((industry) => <div key={industry.title}><LineIcon name={industry.icon} /><span>{industry.title}</span></div>)}
          </div>
        </div>
        <div className="public-system-stack" aria-hidden="true">
          <div className="public-condenser condenser-one"><i /><span>Residential</span></div>
          <div className="public-condenser condenser-two"><i /><span>Commercial</span></div>
          <div className="public-vrf-tower"><i /><i /><i /><span>VRF</span></div>
          <div className="public-system-floor" />
        </div>
      </section>

      <section className="public-social-proof" aria-label="DEMAC community and reviews">
        <div className="public-stat"><span className="facebook-mark">f</span><div><strong>7,000+</strong><small>Facebook followers</small></div></div>
        <div className="public-stat"><span className="review-star">★</span><div><strong>60+</strong><small>Customer reviews</small></div></div>
        <div className="public-trust-message"><span>Trusted across Aruba</span><strong>Homes · Restaurants · Clinics · Offices · Hotels · Businesses</strong></div>
        <div className="public-stars" aria-label="Customer review presence"><span>★★★★★</span><small>Real customer feedback helps tell our story.</small></div>
      </section>

      <section className="public-section public-projects" id="projects">
        <div className="public-project-head"><div><span>Our work</span><h2>Recent project categories</h2></div><Link href="/project-gallery">View project gallery →</Link></div>
        <div className="public-project-grid">
          {projectTypes.map(([title, copy], index) => (
            <article className={`public-project-card project-${index + 1}`} key={title}>
              <div className="public-project-art" aria-hidden="true"><span className="project-unit"/><span className="project-building"/><span className="project-air"/></div>
              <div><span>DEMAC PROJECTS</span><h3>{title}</h3><p>{copy}</p></div>
            </article>
          ))}
        </div>
        <p className="public-project-note">Real before-and-after photos and completed-project galleries can be connected here as the media library is added.</p>
      </section>

      <section className="public-contact" id="contact">
        <div className="public-contact-copy">
          <span className="public-eyebrow">Ready when you are</span>
          <h2>Need reliable cooling solutions?</h2>
          <p>Tell us what you need and our team can help you determine the right next step—from a service appointment to a new installation or commercial project.</p>
          <div className="public-contact-actions">
            <Link className="public-button public-button-light" href="/contact">Contact DEMAC</Link>
            <Link className="public-button public-button-outline-light" href="/services">Review services</Link>
          </div>
        </div>
        <div className="public-contact-card" id="contact-details">
          <span>DEMAC OFFICE</span>
          <strong>Santa Cruz 54 C</strong>
          <p>Santa Cruz, Aruba</p>
          <hr />
          <small>WhatsApp sales · Estimates · Service requests · Commercial inquiries</small>
          <em>Customer contact channels are being connected to this new website experience.</em>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
