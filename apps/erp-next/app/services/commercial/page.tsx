import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CommercialSystemPhotoGuide } from '@/components/public/commercial-system-photo-guide';
import { PublicSiteShell } from '@/components/public/public-site-shell';

export const metadata: Metadata = {
  title: 'Commercial Cooling Solutions in Aruba',
  description:
    'Commercial air conditioning sales, assessment, installation, replacement, maintenance, diagnostics and repairs for Aruba businesses and properties.',
  alternates: { canonical: '/services/commercial' },
  openGraph: {
    title: 'Commercial Cooling Solutions in Aruba | DEMAC',
    description:
      'Commercial cooling planned around uptime, comfort, efficiency and long-term service support for Aruba properties.',
    type: 'website',
    url: '/services/commercial',
  },
};

type IconName =
  | 'home'
  | 'store'
  | 'building'
  | 'zones'
  | 'cart'
  | 'plan'
  | 'install'
  | 'service'
  | 'uptime'
  | 'comfort'
  | 'efficiency'
  | 'support'
  | 'replacement'
  | 'diagnostic'
  | 'electrical'
  | 'shield'
  | 'report'
  | 'calendar'
  | 'check'
  | 'hotel'
  | 'restaurant'
  | 'office'
  | 'clinic'
  | 'retail'
  | 'warehouse'
  | 'cassette'
  | 'ducted'
  | 'rooftop'
  | 'airhandler'
  | 'arrow';

function CommercialIcon({ name }: { name: IconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const icons: Record<IconName, ReactNode> = {
    home: <><path {...common} d="M3.5 11.2 12 4l8.5 7.2"/><path {...common} d="M5.5 10.2V20h13v-9.8M9.5 20v-6h5v6"/></>,
    store: <><path {...common} d="M4 9h16l-1.3-5H5.3L4 9Z"/><path {...common} d="M5 9v11h14V9M8 20v-6h4v6M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0"/></>,
    building: <><path {...common} d="M5 20V5h9v15M14 9h5v11M8 8h3M8 11h3M8 14h3M8 17h3M16.5 12h1M16.5 15h1M16.5 18h1"/></>,
    zones: <><rect {...common} x="4" y="4" width="6" height="6" rx="1"/><rect {...common} x="14" y="4" width="6" height="6" rx="1"/><rect {...common} x="4" y="14" width="6" height="6" rx="1"/><rect {...common} x="14" y="14" width="6" height="6" rx="1"/></>,
    cart: <><path {...common} d="M3 5h2l2.2 9.2h9.9L20 8H6"/><circle {...common} cx="9" cy="19" r="1"/><circle {...common} cx="17" cy="19" r="1"/></>,
    plan: <><path {...common} d="M4 4h16v16H4zM8 4v16M4 9h4M12 8h5M12 12h5M12 16h3"/></>,
    install: <path {...common} d="m5 19 8.7-8.7M15.2 4.1a4 4 0 0 0-4.6 5.2L4 15.9 8.1 20l6.6-6.6a4 4 0 0 0 5.2-4.6l-2.6 2.6-3-3 2.6-2.6Z"/>,
    service: <><circle {...common} cx="12" cy="12" r="3"/><path {...common} d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
    uptime: <><circle {...common} cx="12" cy="12" r="8"/><path {...common} d="M12 7v5l3 2M5 4l2 2M19 4l-2 2"/></>,
    comfort: <><path {...common} d="M10 14.8V5a2 2 0 1 1 4 0v9.8a4 4 0 1 1-4 0Z"/><path {...common} d="M12 8v8"/></>,
    efficiency: <><path {...common} d="M20 4C12 4 6 7.7 6 14c0 3.2 2.3 5 5.1 5C17 19 20 11 20 4Z"/><path {...common} d="M5 20c2.5-5.3 6.1-8.4 11-10"/></>,
    support: <path {...common} d="M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v6H5a1 1 0 0 1-1-1v-5ZM20 13h-3v6h2a1 1 0 0 0 1-1v-5ZM17 19c0 1.5-1.2 2-3 2"/>,
    replacement: <><path {...common} d="M4 7h12M13 4l3 3-3 3M20 17H8M11 14l-3 3 3 3"/><rect {...common} x="5" y="10" width="5" height="4" rx="1"/><rect {...common} x="14" y="10" width="5" height="4" rx="1"/></>,
    diagnostic: <><circle {...common} cx="10.5" cy="10.5" r="6.5"/><path {...common} d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5"/></>,
    electrical: <path {...common} d="m13 2-7 11h6l-1 9 7-12h-6l1-8Z"/>,
    shield: <><path {...common} d="M12 3 19 6v5.2c0 4.6-2.8 7.8-7 9.8-4.2-2-7-5.2-7-9.8V6l7-3Z"/><path {...common} d="m8.5 12 2.2 2.2 4.8-5"/></>,
    report: <><path {...common} d="M6 3h9l3 3v15H6zM15 3v4h4M9 11h6M9 15h6M9 19h4"/></>,
    calendar: <><rect {...common} x="3" y="5" width="18" height="16" rx="2"/><path {...common} d="M7 3v4M17 3v4M3 10h18M8 14h3M13 14h3M8 18h3"/></>,
    check: <path {...common} d="m5 12 4 4L19 6"/>,
    hotel: <><path {...common} d="M4 20V6h16v14M7 9h3v3H7zM14 9h3v3h-3zM7 15h3v3H7zM14 15h3v3h-3z"/></>,
    restaurant: <><path {...common} d="M6 3v7M9 3v7M6 7h3M7.5 10v11M16 3v18M16 3c3 2 4 5 4 8h-4"/></>,
    office: <><path {...common} d="M4 20h16M6 20V5h8v15M14 9h4v11M9 8h2M9 11h2M9 14h2M9 17h2"/></>,
    clinic: <><path {...common} d="M5 8h14v12H5zM9 8V4h6v4M12 11v6M9 14h6"/></>,
    retail: <><path {...common} d="M4 9h16l-1-5H5L4 9ZM5 9v11h14V9M8 20v-6h8v6"/><path {...common} d="M4 9c0 2 3 2 4 0 1 2 3 2 4 0 1 2 3 2 4 0 1 2 4 2 4 0"/></>,
    warehouse: <><path {...common} d="m3 9 9-5 9 5v11H3zM7 20v-7h10v7M8 9h8"/></>,
    cassette: <><rect {...common} x="5" y="5" width="14" height="14" rx="2"/><circle {...common} cx="12" cy="12" r="3"/><path {...common} d="M12 5v4M19 12h-4M12 19v-4M5 12h4"/></>,
    ducted: <><rect {...common} x="3" y="7" width="12" height="10" rx="2"/><path {...common} d="M15 10h4l2 2-2 2h-4M7 10h4M7 14h4"/></>,
    rooftop: <><path {...common} d="M3 19h18M5 19V9h14v10M8 9V5h8v4M8 13h8"/></>,
    airhandler: <><rect {...common} x="4" y="5" width="16" height="14" rx="2"/><circle {...common} cx="10" cy="12" r="4"/><path {...common} d="M14 9h3M14 12h3M14 15h3"/></>,
    arrow: <path {...common} d="M5 12h14M14 7l5 5-5 5"/>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>;
}

const segments = [
  { href: '/services', icon: 'home' as const, title: 'Residential', copy: 'Comfort solutions for your home.' },
  { href: '/services', icon: 'store' as const, title: 'Light Commercial', copy: 'Efficient systems for small businesses.' },
  { href: '/services/commercial', icon: 'building' as const, title: 'Commercial', copy: 'Cooling for demanding operations.', active: true },
  { href: '/services/vrf-systems', icon: 'zones' as const, title: 'VRF Systems', copy: 'Advanced zoning and efficiency.' },
];

const startingPoints = [
  {
    icon: 'cart' as const,
    label: 'Equipment & replacement',
    title: 'Buy or replace a commercial system',
    copy: 'Compare practical options for capacity, application, efficiency, placement and future service access.',
    link: '/contact?request=commercial-equipment',
    cta: 'Discuss equipment needs',
  },
  {
    icon: 'install' as const,
    label: 'Installation project',
    title: 'Plan a new installation or upgrade',
    copy: 'Coordinate the system, electrical readiness, supports, access, scheduling and commissioning as one scope.',
    link: '/contact?request=commercial-installation',
    cta: 'Plan an installation',
  },
  {
    icon: 'service' as const,
    label: 'Existing equipment',
    title: 'Request service, maintenance or repair',
    copy: 'Start with the current symptoms, equipment type and operational priority so the right team can respond.',
    link: '/contact?request=commercial-service',
    cta: 'Request commercial service',
  },
];

const outcomes = [
  { icon: 'uptime' as const, title: 'Operational Reliability', copy: 'Cooling planned and serviced with business continuity, priority areas and operating hours in mind.' },
  { icon: 'comfort' as const, title: 'Consistent Comfort', copy: 'Stable conditions for guests, customers, staff and occupied spaces across the property.' },
  { icon: 'efficiency' as const, title: 'Efficient Operation', copy: 'Equipment selection, controls and maintenance aligned with actual load instead of guesswork.' },
  { icon: 'support' as const, title: 'Long-Term Support', copy: 'Clear documentation, preventive care and a local service team available after project completion.' },
];

const capabilities = [
  {
    className: 'is-assessment',
    icon: 'plan' as const,
    title: 'Commercial Assessment & System Planning',
    copy: 'We review the property, occupied areas, current equipment, operating schedule, access, electrical conditions and project goals before recommending the next step.',
    image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1300&q=86',
    link: '/contact?request=commercial-assessment',
  },
  {
    className: 'is-equipment',
    icon: 'replacement' as const,
    title: 'Equipment Sales & Replacement',
    copy: 'Commercial equipment options selected around the application, capacity, installation conditions and serviceability.',
    image: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=900&q=84',
    link: '/contact?request=commercial-equipment',
  },
  {
    className: 'is-installation',
    icon: 'install' as const,
    title: 'Installation & Commissioning',
    copy: 'Professional execution, coordination, testing and a documented handover for new systems and replacements.',
    image: 'https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=900&q=84',
    link: '/contact?request=commercial-installation',
  },
  {
    className: 'is-maintenance',
    icon: 'calendar' as const,
    title: 'Preventive Maintenance Programs',
    copy: 'Planned visits, condition checks and reporting structured around the equipment and operating needs of the property.',
    image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=84',
    link: '/contact?request=commercial-maintenance',
  },
  {
    className: 'is-diagnostics',
    icon: 'diagnostic' as const,
    title: 'Diagnostics & Corrective Repairs',
    copy: 'Systematic troubleshooting of refrigeration, electrical, drainage, airflow, communication and control issues.',
    image: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=900&q=84',
    link: '/contact?request=commercial-diagnostics',
  },
  {
    className: 'is-protection',
    icon: 'shield' as const,
    title: 'Electrical, Controls & Coastal Protection',
    copy: 'A/C-related electrical diagnostics, controls support, custom brackets and anti-corrosive options for exposed equipment.',
    image: 'https://images.unsplash.com/photo-1558002038-1055907df827?auto=format&fit=crop&w=900&q=84',
    link: '/contact?request=commercial-support',
  },
];

const process = [
  { icon: 'diagnostic' as const, title: 'Assess', copy: 'Understand the building, equipment, symptoms, priorities and operating constraints.' },
  { icon: 'plan' as const, title: 'Recommend', copy: 'Define the right service scope, system approach or replacement path with clear assumptions.' },
  { icon: 'calendar' as const, title: 'Coordinate', copy: 'Plan access, materials, work areas, schedule and communication around the property’s operation.' },
  { icon: 'install' as const, title: 'Execute', copy: 'Complete installation, maintenance or corrective work with professional field control.' },
  { icon: 'report' as const, title: 'Test & Document', copy: 'Verify operation and provide findings, attention items or commissioning information after the work.' },
];

const environments = [
  {
    icon: 'hotel' as const,
    type: 'Hotels & Hospitality',
    title: 'Comfort across guest and operational spaces',
    copy: 'Plan around occupied areas, different schedules, guest expectations and property access.',
    image: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1000&q=84',
  },
  {
    icon: 'restaurant' as const,
    type: 'Restaurants & Food Service',
    title: 'Cooling for heat-intensive, customer-facing environments',
    copy: 'Address dining areas, kitchens, airflow, long operating hours and service timing.',
    image: 'https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1000&q=84',
  },
  {
    icon: 'office' as const,
    type: 'Offices & Professional Buildings',
    title: 'Reliable comfort for teams and clients',
    copy: 'Support meeting rooms, workspaces, reception areas and different occupancy patterns.',
    image: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1000&q=84',
  },
  {
    icon: 'clinic' as const,
    type: 'Clinics & Healthcare',
    title: 'Structured service around occupied facilities',
    copy: 'Coordinate comfort, access, cleanliness and work timing around patients and staff.',
    image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1000&q=84',
  },
  {
    icon: 'retail' as const,
    type: 'Retail & Mixed-Use',
    title: 'Cooling matched to different spaces and schedules',
    copy: 'Serve customer areas, offices, tenants and support zones with a coordinated plan.',
    image: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=1000&q=84',
  },
  {
    icon: 'warehouse' as const,
    type: 'Warehouses & Commercial Properties',
    title: 'Practical solutions for larger operating environments',
    copy: 'Consider volume, load, equipment placement, access and maintainability from the start.',
    image: 'https://images.unsplash.com/photo-1553413077-190dd305871c?auto=format&fit=crop&w=1000&q=84',
  },
];

const arubaFactors = [
  { title: 'Year-round cooling demand', copy: 'Capacity and service planning should reflect sustained warm-weather operation and long business hours.' },
  { title: 'Coastal exposure', copy: 'Outdoor equipment may benefit from placement review, protection options and closer condition monitoring.' },
  { title: 'Access & structural coordination', copy: 'Rooftops, exterior walls, lifting paths, brackets and work zones must be considered before execution.' },
  { title: 'Occupied-property scheduling', copy: 'Commercial work should be sequenced to reduce disruption to customers, guests, staff and tenants.' },
];

const maintenanceChecks = [
  'Filters, coils, blowers and airflow condition',
  'Drainage, condensate and water-leak risks',
  'Electrical connections and operating observations',
  'Refrigerant performance and visible piping condition',
  'Controls, thermostats and error history when available',
  'Technical findings and attention items after service',
];

const diagnosticSteps = [
  'Document the symptoms and affected areas',
  'Inspect the complete operating system—not only one component',
  'Identify the likely root cause and corrective scope',
  'Separate approved work from additional findings',
  'Test operation after the repair or adjustment',
  'Provide a clear summary for property management',
];

export default function CommercialCoolingPage() {
  const serviceSchema = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: 'Commercial Cooling Solutions',
    serviceType: 'Commercial air conditioning sales, installation, maintenance, diagnostics and repairs',
    areaServed: { '@type': 'Country', name: 'Aruba' },
    provider: {
      '@type': 'HVACBusiness',
      name: 'DEMAC Professional Cooling Solutions',
      url: 'https://demac-aruba.com',
    },
  };

  return (
    <PublicSiteShell active="services">
      <article className="commercial-segment-page">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }} />

        <section className="commercial-hero">
          <div className="commercial-hero-media" aria-hidden="true">
            <div className="commercial-hero-image" />
            <div className="commercial-hero-wash" />
            <div className="commercial-hero-visual">
              <div className="commercial-operations-card">
                <span>Building comfort</span>
                <strong>Stable</strong>
                <small><i /> Priority areas online</small>
              </div>
              <div className="commercial-building-map">
                {Array.from({ length: 15 }).map((_, index) => <span key={index}><i /></span>)}
              </div>
              <svg className="commercial-flow-lines" viewBox="0 0 720 410" preserveAspectRatio="none">
                <path d="M612 97 C548 130 506 174 438 198 S306 216 252 280" />
                <path d="M610 98 C535 80 470 64 390 75 S290 110 226 155" />
                <path d="M438 198 C505 240 552 278 629 312" />
                <circle cx="612" cy="97" r="6" />
                <circle cx="438" cy="198" r="6" />
                <circle cx="252" cy="280" r="6" />
                <circle cx="226" cy="155" r="6" />
                <circle cx="629" cy="312" r="6" />
              </svg>
              <div className="commercial-priority-card">
                <small>Service priority</small>
                <strong>Operation first</strong>
                <span>Access · timing · uptime</span>
              </div>
            </div>
          </div>

          <div className="commercial-hero-inner">
            <nav className="commercial-breadcrumb" aria-label="Breadcrumb">
              <Link href="/">Home</Link><span>›</span><Link href="/services">Services</Link><span>›</span><strong>Commercial</strong>
            </nav>
            <div className="commercial-hero-copy">
              <span className="commercial-kicker">Commercial cooling in Aruba</span>
              <h1>Cooling that keeps<br/>business moving.<br/><em>Built around your operation.</em></h1>
              <p>
                From equipment sales and new installations to preventive maintenance, diagnostics and repairs, DEMAC helps commercial properties make the right cooling decision and keep systems performing.
              </p>
              <div className="commercial-hero-actions">
                <Link className="public-button public-button-whatsapp commercial-button" href="/contact?channel=whatsapp&service=commercial">◉ WhatsApp Us</Link>
                <Link className="public-button public-button-primary commercial-button" href="/contact?request=commercial-assessment">Request a Commercial Assessment</Link>
              </div>
              <div className="commercial-trust-row">
                <span><b>✓</b> Aruba-based team</span>
                <span><b>✓</b> Planned around operations</span>
                <span><b>✓</b> Technical reporting</span>
              </div>
            </div>
          </div>
        </section>

        <nav className="commercial-segment-nav" aria-label="Cooling solution segments">
          {segments.map((segment) => (
            <Link className={segment.active ? 'is-active' : ''} href={segment.href} key={segment.title} aria-current={segment.active ? 'page' : undefined}>
              <span className="commercial-segment-icon"><CommercialIcon name={segment.icon} /></span>
              <span><strong>{segment.title}</strong><small>{segment.copy}</small></span>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </nav>

        <section className="commercial-section commercial-start-section">
          <header className="commercial-section-heading commercial-heading-row">
            <div><span>Start with what you need</span><h2>One commercial partner. <em>Three clear paths.</em></h2></div>
            <p>Choose the situation that best matches your property today.</p>
          </header>
          <div className="commercial-start-grid">
            {startingPoints.map((item, index) => (
              <Link className={`commercial-start-card is-${index + 1}`} href={item.link} key={item.title}>
                <span className="commercial-start-number">0{index + 1}</span>
                <span className="commercial-start-icon"><CommercialIcon name={item.icon} /></span>
                <small>{item.label}</small>
                <strong>{item.title}</strong>
                <p>{item.copy}</p>
                <b>{item.cta} <i><CommercialIcon name="arrow" /></i></b>
              </Link>
            ))}
          </div>
        </section>

        <section className="commercial-section commercial-outcomes-section">
          <header className="commercial-section-heading"><span>Commercial priorities</span><h2>Performance measured beyond temperature.</h2></header>
          <div className="commercial-outcome-grid">
            {outcomes.map((item) => (
              <article key={item.title}>
                <span className="commercial-round-icon"><CommercialIcon name={item.icon} /></span>
                <div><h3>{item.title}</h3><p>{item.copy}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="commercial-section commercial-capabilities-section">
          <header className="commercial-section-heading commercial-heading-row">
            <div><span>Complete commercial support</span><h2>From first assessment to long-term service.</h2></div>
            <Link href="/contact?request=commercial-assessment">Discuss your property →</Link>
          </header>
          <div className="commercial-capability-bento">
            {capabilities.map((item) => (
              <Link className={`commercial-capability-card ${item.className}`} href={item.link} key={item.title}>
                <img src={item.image} alt="" loading="lazy" />
                <span className="commercial-capability-shade" />
                <span className="commercial-capability-copy">
                  <i><CommercialIcon name={item.icon} /></i>
                  <strong>{item.title}</strong>
                  <small>{item.copy}</small>
                  <b aria-hidden="true">→</b>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="commercial-section commercial-process-section">
          <header className="commercial-section-heading"><span>Our delivery process</span><h2>A controlled path from request to verified result.</h2></header>
          <ol className="commercial-process-timeline">
            {process.map((item, index) => (
              <li key={item.title}>
                <span className="commercial-step-number">{index + 1}</span>
                <span className="commercial-step-icon"><CommercialIcon name={item.icon} /></span>
                <div><h3>{item.title}</h3><p>{item.copy}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <section className="commercial-section commercial-systems-section">
          <div className="commercial-systems-intro">
            <span>System applications</span>
            <h2>Match the cooling approach to the building—not the other way around.</h2>
            <p>Commercial properties can require different equipment types across the same site. DEMAC evaluates the application, capacity, airflow, access, controls and future service needs before defining the scope.</p>
            <Link href="/contact?request=commercial-assessment">Request a system review →</Link>
          </div>
          <CommercialSystemPhotoGuide />
        </section>

        <section className="commercial-aruba-section">
          <div className="commercial-aruba-visual" aria-hidden="true">
            <span className="commercial-sun-disc" />
            <span className="commercial-wind-line is-one" />
            <span className="commercial-wind-line is-two" />
            <span className="commercial-wind-line is-three" />
            <div className="commercial-rooftop-unit"><i /><i /><strong>Commercial A/C</strong></div>
          </div>
          <div className="commercial-aruba-content">
            <span>Designed for Aruba realities</span>
            <h2>Cooling decisions should reflect the property, the climate and the operation.</h2>
            <div className="commercial-aruba-grid">
              {arubaFactors.map((factor, index) => (
                <article key={factor.title}><b>0{index + 1}</b><div><strong>{factor.title}</strong><p>{factor.copy}</p></div></article>
              ))}
            </div>
          </div>
        </section>

        <section className="commercial-section commercial-environments-section">
          <header className="commercial-section-heading commercial-heading-row">
            <div><span>Commercial environments</span><h2>Built for spaces where comfort supports the business.</h2></div>
            <Link href="/project-gallery">View project gallery →</Link>
          </header>
          <div className="commercial-environment-rail">
            {environments.map((item) => (
              <article className="commercial-environment-card" key={item.type}>
                <span className="commercial-environment-image"><img src={item.image} alt="" loading="lazy" /></span>
                <span className="commercial-environment-copy">
                  <i><CommercialIcon name={item.icon} /></i>
                  <small>{item.type}</small>
                  <strong>{item.title}</strong>
                  <p>{item.copy}</p>
                </span>
              </article>
            ))}
          </div>
          <p className="commercial-image-note">Application images are illustrative. Verified DEMAC case studies will be added as project media is approved for public use.</p>
        </section>

        <section className="commercial-section commercial-lifecycle-section">
          <header className="commercial-section-heading"><span>Protect performance over time</span><h2>Preventive care when possible. Structured diagnostics when needed.</h2></header>
          <div className="commercial-lifecycle-grid">
            <article className="commercial-lifecycle-card is-maintenance">
              <div className="commercial-lifecycle-head">
                <span><CommercialIcon name="calendar" /></span>
                <div><small>Planned care</small><h3>Commercial preventive maintenance</h3></div>
              </div>
              <p>Maintenance visits can be structured around equipment type, operating hours, property priorities and recurring condition risks.</p>
              <ul>{maintenanceChecks.map((item) => <li key={item}><i><CommercialIcon name="check" /></i>{item}</li>)}</ul>
              <Link href="/contact?request=commercial-maintenance">Request a maintenance proposal →</Link>
            </article>

            <article className="commercial-lifecycle-card is-diagnostics">
              <div className="commercial-lifecycle-head">
                <span><CommercialIcon name="diagnostic" /></span>
                <div><small>Corrective support</small><h3>Commercial diagnostics & repair</h3></div>
              </div>
              <p>When a system fails or underperforms, the objective is to isolate the real cause, define the corrective scope and restore reliable operation.</p>
              <ul>{diagnosticSteps.map((item) => <li key={item}><i><CommercialIcon name="check" /></i>{item}</li>)}</ul>
              <Link href="/contact?request=commercial-diagnostics">Request a diagnostic visit →</Link>
            </article>
          </div>
        </section>

        <section className="commercial-final-cta">
          <div className="commercial-final-icon"><CommercialIcon name="building" /></div>
          <div>
            <span>Ready to move your project forward?</span>
            <h2>Tell us what your property needs—equipment, installation, maintenance or repair.</h2>
            <p>DEMAC will help organize the request and define the right technical next step.</p>
          </div>
          <div className="commercial-final-actions">
            <Link className="public-button public-button-whatsapp commercial-button" href="/contact?channel=whatsapp&service=commercial">◉ WhatsApp Us</Link>
            <Link className="public-button public-button-primary commercial-button" href="/contact?request=commercial-assessment">Request a Commercial Assessment</Link>
          </div>
        </section>
      </article>
    </PublicSiteShell>
  );
}
