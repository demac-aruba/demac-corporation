import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PublicSiteShell } from '@/components/public/public-site-shell';

export const metadata: Metadata = {
  title: 'VRF Systems in Aruba',
  description: 'DEMAC VRF assessment, design coordination, installation, commissioning, diagnostics, preventive maintenance and controls support for Aruba properties.',
  alternates: { canonical: '/services/vrf-systems' },
  openGraph: {
    title: 'VRF Systems in Aruba | DEMAC',
    description: 'Smarter zoning, efficient operation and end-to-end VRF support for commercial properties in Aruba.',
    type: 'website',
    url: '/services/vrf-systems',
  },
};

type IconName =
  | 'home'
  | 'store'
  | 'building'
  | 'zones'
  | 'temperature'
  | 'leaf'
  | 'layout'
  | 'monitor'
  | 'search'
  | 'plan'
  | 'install'
  | 'shield'
  | 'headset'
  | 'wrench'
  | 'maintenance'
  | 'controls'
  | 'check'
  | 'hotel'
  | 'office'
  | 'clinic';

function VrfIcon({ name }: { name: IconName }) {
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
    temperature: <><path {...common} d="M10 14.8V5a2 2 0 1 1 4 0v9.8a4 4 0 1 1-4 0Z"/><path {...common} d="M12 8v8"/></>,
    leaf: <><path {...common} d="M20 4C12 4 6 7.7 6 14c0 3.2 2.3 5 5.1 5C17 19 20 11 20 4Z"/><path {...common} d="M5 20c2.5-5.3 6.1-8.4 11-10"/></>,
    layout: <><path {...common} d="M4 5h16v14H4zM4 10h16M10 10v9"/></>,
    monitor: <><rect {...common} x="3" y="4" width="18" height="13" rx="2"/><path {...common} d="M8 21h8M12 17v4M7 8h4M7 12h2M14 8h3M14 12h3"/></>,
    search: <><circle {...common} cx="10.5" cy="10.5" r="6.5"/><path {...common} d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5"/></>,
    plan: <><path {...common} d="M4 5h16v14H4zM8 5v14M4 10h4M12 9h4M12 13h4M12 17h2"/></>,
    install: <><path {...common} d="m5 19 8.7-8.7M15.2 4.1a4 4 0 0 0-4.6 5.2L4 15.9 8.1 20l6.6-6.6a4 4 0 0 0 5.2-4.6l-2.6 2.6-3-3 2.6-2.6Z"/></>,
    shield: <><path {...common} d="M12 3 19 6v5.2c0 4.6-2.8 7.8-7 9.8-4.2-2-7-5.2-7-9.8V6l7-3Z"/><path {...common} d="m8.5 12 2.2 2.2 4.8-5"/></>,
    headset: <><path {...common} d="M4 13v-1a8 8 0 0 1 16 0v1M4 13h3v6H5a1 1 0 0 1-1-1v-5ZM20 13h-3v6h2a1 1 0 0 0 1-1v-5ZM17 19c0 1.5-1.2 2-3 2"/></>,
    wrench: <><path {...common} d="M15.5 4.5a4.2 4.2 0 0 0-5 5L4 16l4 4 6.5-6.5a4.2 4.2 0 0 0 5-5L17 11l-4-4 2.5-2.5Z"/></>,
    maintenance: <><circle {...common} cx="12" cy="12" r="3"/><path {...common} d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1"/></>,
    controls: <><path {...common} d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6"/><circle {...common} cx="14" cy="7" r="2"/><circle {...common} cx="8" cy="17" r="2"/></>,
    check: <path {...common} d="m5 12 4 4L19 6"/>,
    hotel: <><path {...common} d="M4 20V6h16v14M7 9h3v3H7zM14 9h3v3h-3zM7 15h3v3H7zM14 15h3v3h-3z"/></>,
    office: <><path {...common} d="M4 20h16M6 20V5h8v15M14 9h4v11M9 8h2M9 11h2M9 14h2M9 17h2"/></>,
    clinic: <><path {...common} d="M5 8h14v12H5zM9 8V4h6v4M12 11v6M9 14h6"/></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>;
}

const segments = [
  { href: '/services', icon: 'home' as const, title: 'Residential', copy: 'Comfort solutions for your home.' },
  { href: '/services', icon: 'store' as const, title: 'Light Commercial', copy: 'Efficient systems for small businesses.' },
  { href: '/services/commercial', icon: 'building' as const, title: 'Commercial', copy: 'Powerful cooling for larger spaces.' },
  { href: '/services/vrf-systems', icon: 'zones' as const, title: 'VRF Systems', copy: 'Advanced zoning and efficiency.', active: true },
];

const outcomes = [
  { icon: 'temperature' as const, title: 'Zoned Comfort', copy: 'Individual temperature control for every occupied area—only where and when it is needed.' },
  { icon: 'leaf' as const, title: 'Energy Efficiency', copy: 'Variable-capacity operation follows real demand instead of running every zone at full output.' },
  { icon: 'layout' as const, title: 'Flexible Design', copy: 'Long piping runs and multiple indoor-unit styles support complex layouts and future changes.' },
  { icon: 'monitor' as const, title: 'Centralized Control', copy: 'Smart controls provide scheduling, operating visibility and easier performance oversight.' },
];

const process = [
  { icon: 'search' as const, title: 'Assessment', copy: 'We evaluate occupancy, usage, heat load, access and operating priorities.' },
  { icon: 'plan' as const, title: 'Design & Coordination', copy: 'System architecture is coordinated with the property, trades and project requirements.' },
  { icon: 'install' as const, title: 'Installation', copy: 'Certified technicians execute piping, wiring, indoor units and outdoor equipment.' },
  { icon: 'shield' as const, title: 'Commissioning', copy: 'Vacuum, testing, addressing and system validation confirm correct operation.' },
  { icon: 'headset' as const, title: 'Ongoing Support', copy: 'Preventive maintenance, diagnostics and service protect long-term performance.' },
];

const capabilities = [
  {
    className: 'is-design',
    icon: 'plan' as const,
    title: 'VRF Assessment & Design',
    copy: 'Property review, load planning, equipment selection and a coordinated system concept before execution.',
    image: 'https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=84',
  },
  {
    className: 'is-install',
    icon: 'install' as const,
    title: 'Installation & Commissioning',
    copy: 'Precision installation followed by evacuation, startup, addressing and performance verification.',
    image: 'https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=900&q=84',
  },
  {
    className: 'is-diagnostics',
    icon: 'wrench' as const,
    title: 'Diagnostics & Repair',
    copy: 'Structured troubleshooting for refrigeration, electrical, communication and control faults.',
    image: 'https://images.unsplash.com/photo-1581092160562-40aa08e78837?auto=format&fit=crop&w=900&q=84',
  },
  {
    className: 'is-maintenance',
    icon: 'maintenance' as const,
    title: 'Preventive Maintenance',
    copy: 'Scheduled care for coils, filters, drains, refrigerant performance and operating condition.',
    image: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=900&q=84',
  },
  {
    className: 'is-controls',
    icon: 'controls' as const,
    title: 'Controls & Integration',
    copy: 'Central controllers, schedules, operating modes and integration-ready system planning.',
    image: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=900&q=84',
  },
];

const applications = [
  {
    type: 'Hospitality',
    title: 'Guest rooms & common areas',
    copy: 'Independent zones, quiet indoor units and centralized oversight for hospitality operations.',
    image: 'https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?auto=format&fit=crop&w=1000&q=84',
  },
  {
    type: 'Professional Offices',
    title: 'Multi-tenant office floors',
    copy: 'Flexible zoning for meeting rooms, open offices and spaces with different operating hours.',
    image: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1000&q=84',
  },
  {
    type: 'Mixed-use Properties',
    title: 'Retail, office & residential zones',
    copy: 'One coordinated architecture serving areas with different schedules and comfort requirements.',
    image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1000&q=84',
  },
  {
    type: 'Healthcare & Clinics',
    title: 'Controlled professional environments',
    copy: 'Stable comfort, operational visibility and service planning around occupied facilities.',
    image: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1000&q=84',
  },
];

const zones = [
  { type: 'Wall-mounted', name: 'Zone 01', temperature: '22°C', className: 'zone-wall' },
  { type: 'Ducted', name: 'Zone 02', temperature: '24°C', className: 'zone-ducted' },
  { type: 'Cassette', name: 'Zone 03', temperature: '23°C', className: 'zone-cassette' },
  { type: 'Controller', name: 'Zone 04', temperature: '21°C', className: 'zone-control' },
];

export default function VrfSystemsPage() {
  return (
    <PublicSiteShell active="services">
      <article className="vrf-segment-page">
        <section className="vrf-hero">
          <div className="vrf-hero-media" aria-hidden="true">
            <div className="vrf-hero-image" />
            <div className="vrf-hero-wash" />
            <div className="vrf-hero-visual">
              <div className="vrf-temperature-orb"><strong>23°C</strong><span>Zone 04</span></div>
              <div className="vrf-outdoor-system"><i /><i /><i /><span>VRF</span></div>
              <div className="vrf-building-model">
                {Array.from({ length: 12 }).map((_, index) => <span key={index} />)}
              </div>
              <svg className="vrf-flow-network" viewBox="0 0 720 390" preserveAspectRatio="none">
                <path d="M565 120 C510 150 510 220 410 236 S300 248 250 290" />
                <path d="M565 120 C505 90 470 55 405 52" />
                <path d="M565 120 C610 175 625 238 660 286" />
                <circle cx="565" cy="120" r="6" />
                <circle cx="410" cy="236" r="6" />
                <circle cx="250" cy="290" r="6" />
                <circle cx="405" cy="52" r="6" />
                <circle cx="660" cy="286" r="6" />
              </svg>
              <div className="vrf-status-card">
                <strong>System Status</strong>
                <span><i /> Cooling</span>
                <span><i /> Efficient</span>
                <span><i /> All zones online</span>
              </div>
            </div>
          </div>

          <div className="vrf-hero-inner">
            <nav className="vrf-breadcrumb" aria-label="Breadcrumb">
              <Link href="/">Home</Link><span>›</span><Link href="/services">Services</Link><span>›</span><strong>VRF Systems</strong>
            </nav>
            <div className="vrf-hero-copy">
              <span className="vrf-kicker">VRF systems in Aruba</span>
              <h1>Smarter comfort.<br />Maximum efficiency.<br /><em>Engineered for Aruba.</em></h1>
              <p>Variable Refrigerant Flow systems deliver precise zoning, high efficiency and powerful performance for today’s commercial buildings. DEMAC designs, installs and supports complete VRF solutions tailored to your property and goals.</p>
              <div className="vrf-hero-actions">
                <Link className="public-button public-button-whatsapp vrf-button" href="/contact?channel=whatsapp&service=vrf">◉ WhatsApp Us</Link>
                <Link className="public-button public-button-primary vrf-button" href="/contact?request=vrf-consultation">Request a VRF Consultation</Link>
              </div>
              <div className="vrf-trust-row">
                <span><b>✓</b> Aruba-based expertise</span>
                <span><b>✓</b> Project coordination</span>
                <span><b>✓</b> Island-wide support</span>
              </div>
            </div>
          </div>
        </section>

        <nav className="vrf-segment-nav" aria-label="Cooling solution segments">
          {segments.map((segment) => (
            <Link className={segment.active ? 'is-active' : ''} href={segment.href} key={segment.title} aria-current={segment.active ? 'page' : undefined}>
              <span className="vrf-segment-icon"><VrfIcon name={segment.icon} /></span>
              <span><strong>{segment.title}</strong><small>{segment.copy}</small></span>
              <b aria-hidden="true">→</b>
            </Link>
          ))}
        </nav>

        <section className="vrf-section vrf-outcomes-section">
          <header className="vrf-section-heading">
            <span>Why choose VRF?</span>
            <h2>Advanced technology. <em>Better outcomes.</em></h2>
          </header>
          <div className="vrf-outcome-rail">
            {outcomes.map((outcome) => (
              <article key={outcome.title}>
                <span className="vrf-round-icon"><VrfIcon name={outcome.icon} /></span>
                <div><h3>{outcome.title}</h3><p>{outcome.copy}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="vrf-section vrf-process-section">
          <header className="vrf-section-heading">
            <span>Our process</span>
            <h2>How DEMAC delivers <em>VRF projects</em></h2>
          </header>
          <ol className="vrf-process-timeline">
            {process.map((step, index) => (
              <li key={step.title}>
                <span className="vrf-step-number">{index + 1}</span>
                <span className="vrf-step-icon"><VrfIcon name={step.icon} /></span>
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="vrf-section vrf-capabilities-section">
          <header className="vrf-section-heading vrf-heading-row">
            <div><span>Our VRF solutions</span><h2>Full-service <em>VRF capabilities</em></h2></div>
            <Link href="/services">View all related services →</Link>
          </header>
          <div className="vrf-capability-bento">
            {capabilities.map((capability) => (
              <Link className={`vrf-capability-card ${capability.className}`} href="/contact?request=vrf-consultation" key={capability.title}>
                <img src={capability.image} alt="" loading="lazy" />
                <span className="vrf-capability-shade" />
                <span className="vrf-capability-copy">
                  <i><VrfIcon name={capability.icon} /></i>
                  <strong>{capability.title}</strong>
                  <small>{capability.copy}</small>
                  <b aria-hidden="true">→</b>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="vrf-section vrf-applications-section">
          <header className="vrf-section-heading vrf-heading-row">
            <div><span>VRF project profiles</span><h2>Built for comfort. Designed to perform.</h2></div>
            <Link href="/project-gallery">View project gallery →</Link>
          </header>
          <div className="vrf-application-grid">
            {applications.map((application) => (
              <Link className="vrf-application-card" href="/project-gallery" key={application.title}>
                <span className="vrf-application-image"><img src={application.image} alt="" loading="lazy" /></span>
                <span className="vrf-application-copy">
                  <small>{application.type}</small>
                  <strong>{application.title}</strong>
                  <p>{application.copy}</p>
                  <b>Explore application →</b>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="vrf-section vrf-system-section">
          <div className="vrf-system-board">
            <div className="vrf-system-intro">
              <span>How VRF works</span>
              <h2>One system.<br />Multiple zones.</h2>
              <p>Outdoor capacity is distributed through refrigerant piping to multiple indoor units, allowing each zone to operate around its own comfort requirement.</p>
              <Link href="/contact?request=vrf-consultation">Plan your system →</Link>
            </div>
            <div className="vrf-outdoor-unit" aria-hidden="true"><i /><i /><i /><strong>VRF</strong></div>
            <div className="vrf-zone-network">
              <span className="vrf-main-pipe" aria-hidden="true" />
              {zones.map((zone) => (
                <article className={zone.className} key={zone.name}>
                  <span className="vrf-zone-unit" aria-hidden="true"><i /><i /></span>
                  <small>{zone.type}</small>
                  <strong>{zone.name}</strong>
                  <b>{zone.temperature}</b>
                  <span className="vrf-zone-drop" aria-hidden="true" />
                </article>
              ))}
            </div>
          </div>
          <aside className="vrf-partner-card">
            <span>Why partner with DEMAC?</span>
            <h2>Local expertise.<br />Long-term performance.</h2>
            <ul>
              <li><i><VrfIcon name="building" /></i><div><strong>Aruba-based team</strong><small>Local understanding of climate, access and operating realities.</small></div></li>
              <li><i><VrfIcon name="plan" /></i><div><strong>Professional coordination</strong><small>Structured collaboration with owners, contractors and project teams.</small></div></li>
              <li><i><VrfIcon name="shield" /></i><div><strong>Precision commissioning</strong><small>Documented testing and validation before handover.</small></div></li>
              <li><i><VrfIcon name="headset" /></i><div><strong>Island-wide service</strong><small>Responsive support and maintenance after installation.</small></div></li>
            </ul>
          </aside>
        </section>

        <section className="vrf-final-cta">
          <div className="vrf-final-icon"><VrfIcon name="clinic" /></div>
          <div><span>Ready to optimize your building?</span><h2>Let’s assess your comfort, efficiency and zoning requirements.</h2><p>Start with a structured property and system review, then move forward with a clear technical recommendation.</p></div>
          <div className="vrf-final-actions">
            <Link className="public-button public-button-whatsapp vrf-button" href="/contact?channel=whatsapp&service=vrf">◉ WhatsApp Us</Link>
            <Link className="public-button public-button-primary vrf-button" href="/contact?request=vrf-consultation">Request a VRF Consultation</Link>
          </div>
        </section>
      </article>
    </PublicSiteShell>
  );
}
