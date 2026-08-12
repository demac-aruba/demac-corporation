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
    description: 'Premium residential, light-commercial, commercial and VRF cooling solutions in Aruba.',
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
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

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

const solutionGroups: Array<{ icon: IconName; title: string; subtitle: string }> = [
  { icon: 'home', title: 'Residential', subtitle: 'Comfort solutions for your home.' },
  { icon: 'store', title: 'Light Commercial', subtitle: 'Efficient systems for small businesses.' },
  { icon: 'building', title: 'Commercial', subtitle: 'Powerful cooling for medium & large spaces.' },
  { icon: 'vrf', title: 'VRF Systems', subtitle: 'Advanced technology for maximum efficiency.' },
];

const services: Array<{ icon: IconName; title: string; description: string }> = [
  { icon: 'sales', title: 'A/C Sales', description: 'Quality cooling equipment for residential and commercial needs.' },
  { icon: 'tools', title: 'Installation', description: 'Professional installation focused on performance and a clean finish.' },
  { icon: 'service', title: 'Service & Maintenance', description: 'Preventive care that keeps your system operating efficiently.' },
  { icon: 'tools', title: 'Repairs', description: 'Reliable corrective work when your cooling system needs attention.' },
  { icon: 'diagnostic', title: 'Diagnostics', description: 'Systematic troubleshooting to identify the real cause of a problem.' },
  { icon: 'shield', title: 'Anti-Corrosive Treatment', description: 'Protection for outdoor equipment exposed to Aruba’s coastal climate.' },
  { icon: 'bracket', title: 'Custom Brackets & Metal Fabrication', description: 'Custom mounting and fabrication solutions built for the job.' },
  { icon: 'electric', title: 'A/C Electrical Diagnostics', description: 'Specialized electrical troubleshooting related to A/C systems.' },
  { icon: 'air', title: 'UMA / Chilled-Water Air Handler Service', description: 'Service and maintenance for internal chilled-water air handlers.' },
];

const industries: Array<{ icon: IconName; title: string }> = [
  { icon: 'home', title: 'Homes' },
  { icon: 'restaurant', title: 'Restaurants' },
  { icon: 'clinic', title: 'Clinics' },
  { icon: 'office', title: 'Professional Offices' },
  { icon: 'hotel', title: 'Hotels' },
  { icon: 'building', title: 'Commercial Properties' },
];

const projectTypes = [
  {
    title: 'Residential Cooling',
    copy: 'Comfort-focused installation and replacement applications.',
    image: 'https://images.unsplash.com/photo-1761330440311-16e160cad236?auto=format&fit=crop&w=1000&q=82',
  },
  {
    title: 'Outdoor Equipment',
    copy: 'Condensers and mechanical equipment for residential and commercial properties.',
    image: 'https://images.unsplash.com/photo-1776860153678-b204dccd0f65?auto=format&fit=crop&w=1000&q=82',
  },
  {
    title: 'Commercial Systems',
    copy: 'Larger-capacity cooling applications for demanding operating environments.',
    image: 'https://images.unsplash.com/photo-1775359647433-e2d7935b8b54?auto=format&fit=crop&w=1000&q=82',
  },
  {
    title: 'Rooftop & Exterior',
    copy: 'Outdoor installations planned around access, airflow and the property.',
    image: 'https://images.unsplash.com/photo-1775508131358-6cfae3729de4?auto=format&fit=crop&w=1000&q=82',
  },
  {
    title: 'Hospitality & Properties',
    copy: 'Cooling applications for hotels, hospitality and larger customer properties.',
    image: 'https://images.unsplash.com/photo-1545065053-56b6948e260a?auto=format&fit=crop&w=1000&q=82',
  },
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
    <main className="public-site public-home-approved">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      <PublicHeader active="home" />

      <section className="approved-hero" id="home">
        <div className="approved-hero-photo" aria-hidden="true" />
        <div className="approved-hero-fade" aria-hidden="true" />
        <div className="approved-hero-inner">
          <div className="approved-hero-copy">
            <span className="approved-kicker">Premium air conditioning solutions</span>
            <h1>Cooling Comfort for <span>Homes & Businesses</span> in <em>Aruba.</em></h1>
            <p>Premium air conditioning solutions built for Aruba’s climate. Sales, professional installations, expert service and reliable repairs.</p>
            <div className="approved-hero-actions">
              <Link className="public-button public-button-primary approved-main-button" href="/contact?request=estimate">▣ Request Estimate</Link>
              <Link className="public-button public-button-whatsapp approved-main-button" href="/contact?channel=whatsapp">◉ WhatsApp Us</Link>
            </div>
            <div className="approved-trust-row">
              <span><b>✓</b> Aruba-based team</span>
              <span><b>⚙</b> Fast & reliable service</span>
              <span><b>◇</b> Residential to commercial</span>
              <span><b>✓</b> Island-wide service</span>
            </div>
          </div>
        </div>
      </section>

      <section className="approved-solutions" id="solutions">
        {solutionGroups.map((group) => (
          <Link className="approved-solution" href="/services" key={group.title}>
            <span className="approved-solution-icon"><LineIcon name={group.icon} /></span>
            <span><strong>{group.title}</strong><small>{group.subtitle}</small></span>
            <b aria-hidden="true">→</b>
          </Link>
        ))}
      </section>

      <section className="approved-services" id="services">
        <div className="approved-section-title">
          <div><span>Our Services</span><h2>Complete cooling solutions.</h2></div>
          <Link href="/services">View all services →</Link>
        </div>
        <div className="approved-service-grid">
          {services.map((service) => (
            <Link className="approved-service-card" href="/services" key={service.title}>
              <span className="approved-service-icon"><LineIcon name={service.icon} /></span>
              <strong>{service.title}</strong>
              <small>{service.description}</small>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </div>
      </section>

      <section className="approved-industries" id="industries">
        <span className="approved-industries-label">Industries we serve</span>
        <div className="approved-industry-list">
          {industries.map((industry) => (
            <span key={industry.title}><i><LineIcon name={industry.icon} /></i>{industry.title}</span>
          ))}
        </div>
      </section>

      <section className="approved-proof" aria-label="DEMAC community and customer feedback">
        <div className="approved-proof-stat"><span className="approved-facebook">f</span><div><strong>7,000+</strong><small>Facebook followers</small></div></div>
        <div className="approved-proof-stat"><span className="approved-star">★</span><div><strong>60+</strong><small>Customer reviews</small></div></div>
        <div className="approved-proof-copy"><span>Trusted across Aruba</span><strong>Homes · Restaurants · Clinics · Offices · Hotels · Businesses</strong></div>
        <div className="approved-proof-rating"><span>★★★★★</span><small>Customer feedback helps tell our story.</small></div>
      </section>

      <section className="approved-projects" id="projects">
        <div className="approved-section-title">
          <div><span>Our Work</span><h2>Cooling applications & project gallery</h2></div>
          <Link href="/project-gallery">View gallery →</Link>
        </div>
        <div className="approved-project-grid">
          {projectTypes.map((project) => (
            <Link className="approved-project-card" href="/project-gallery" key={project.title}>
              <span className="approved-project-image" style={{ backgroundImage: `url(${project.image})` }} aria-hidden="true" />
              <span className="approved-project-copy"><small>PROJECT CATEGORY</small><strong>{project.title}</strong><p>{project.copy}</p></span>
            </Link>
          ))}
        </div>
      </section>

      <section className="approved-cta" id="contact">
        <div className="approved-cta-copy">
          <span>Ready for reliable cooling comfort?</span>
          <h2>Let DEMAC help you plan the right next step.</h2>
          <p>From routine service to a new installation or commercial project, tell us what you need and we’ll guide the request.</p>
        </div>
        <div className="approved-cta-actions">
          <Link className="public-button public-button-whatsapp approved-main-button" href="/contact?channel=whatsapp">◉ WhatsApp Us</Link>
          <Link className="public-button public-button-primary approved-main-button" href="/contact?request=estimate">▣ Request Estimate</Link>
        </div>
      </section>

      <PublicFooter />
    </main>
  );
}
