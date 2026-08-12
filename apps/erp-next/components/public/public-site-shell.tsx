import Link from 'next/link';
import type { ReactNode } from 'react';

type PublicSiteShellProps = {
  children: ReactNode;
  active?: 'home' | 'services' | 'projects' | 'about' | 'contact';
};

const primaryLinks = [
  ['home', '/', 'Home'],
  ['about', '/about', 'About Us'],
  ['services', '/services', 'Services'],
  ['projects', '/project-gallery', 'Projects'],
  ['industries', '/#industries', 'Industries We Serve'],
  ['contact', '/contact', 'Contact'],
] as const;

const footerServices = [
  'A/C Sales',
  'Installation',
  'Service & Maintenance',
  'Diagnostics & Repairs',
  'Commercial / VRF',
  'Anti-Corrosive Treatment',
] as const;

export function PublicBrand() {
  return (
    <Link className="public-brand" href="/" aria-label="DEMAC home">
      <span className="public-snow" aria-hidden="true">❄</span>
      <span><strong>DEMAC</strong><small>Professional Cooling Solutions</small></span>
    </Link>
  );
}

export function PublicHeader({ active }: { active?: PublicSiteShellProps['active'] }) {
  return (
    <header className="public-header">
      <div className="public-header-inner">
        <PublicBrand />
        <nav className="public-nav" aria-label="Main navigation">
          {primaryLinks.map(([id, href, label]) => (
            <Link className={active === id ? 'is-active' : ''} href={href} key={id}>{label}</Link>
          ))}
        </nav>
        <div className="public-header-actions">
          <Link className="public-button public-button-whatsapp" href="/contact?channel=whatsapp"><span aria-hidden="true">◉</span> WhatsApp Us</Link>
          <Link className="public-button public-button-primary" href="/contact?request=estimate">▣ Request Estimate</Link>
        </div>
        <details className="public-mobile-menu">
          <summary aria-label="Open navigation"><span /><span /><span /></summary>
          <div>
            {primaryLinks.map(([id, href, label]) => <Link href={href} key={id}>{label}</Link>)}
            <Link href="/login">Staff Login</Link>
          </div>
        </details>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="premium-public-footer">
      <section className="premium-footer-quick">
        <div className="premium-footer-quick-inner">
          <div className="premium-footer-whatsapp-mark" aria-hidden="true">◉</div>
          <div className="premium-footer-quick-copy">
            <span>Need cooling solutions fast?</span>
            <strong>Talk with the DEMAC team.</strong>
            <small>Service requests, estimates, installations and commercial inquiries.</small>
          </div>
          <div className="premium-footer-benefits" aria-label="DEMAC customer benefits">
            <span><b>↗</b><i>Fast Response</i><small>Quick follow-up</small></span>
            <span><b>◇</b><i>Expert Advice</i><small>Right next step</small></span>
            <span><b>✓</b><i>Island-wide</i><small>Across Aruba</small></span>
          </div>
          <Link className="premium-footer-whatsapp-button" href="/contact?channel=whatsapp">WhatsApp Us <span>→</span></Link>
        </div>
      </section>

      <div className="premium-footer-main">
        <div className="premium-footer-grid">
          <section className="premium-footer-brand-block">
            <div className="premium-footer-logo">
              <span className="public-snow" aria-hidden="true">❄</span>
              <span><strong>DEMAC</strong><small>Professional Cooling Solutions</small></span>
            </div>
            <p>Professional residential, light-commercial, commercial and VRF cooling solutions across Aruba.</p>
            <div className="premium-footer-badges">
              <span>Aruba-based</span><span>Island-wide service</span>
            </div>
          </section>

          <nav className="premium-footer-column" aria-label="Footer quick links">
            <strong>Quick Links</strong>
            <Link href="/">Home</Link>
            <Link href="/about">About Us</Link>
            <Link href="/services">Services</Link>
            <Link href="/project-gallery">Projects</Link>
            <Link href="/#industries">Industries We Serve</Link>
            <Link href="/contact">Contact</Link>
          </nav>

          <nav className="premium-footer-column" aria-label="Footer services">
            <strong>Services</strong>
            {footerServices.map((service) => <Link href="/services" key={service}>{service}</Link>)}
          </nav>

          <section className="premium-footer-contact">
            <strong>Contact DEMAC</strong>
            <div className="premium-footer-contact-item"><span aria-hidden="true">⌖</span><div><small>Office</small><b>Santa Cruz 54 C</b><em>Santa Cruz, Aruba</em></div></div>
            <div className="premium-footer-contact-item"><span aria-hidden="true">◷</span><div><small>Business Hours</small><b>Mon–Fri · 8:00 AM–5:00 PM</b><em>Saturday · 9:00 AM–1:00 PM</em></div></div>
            <div className="premium-footer-contact-actions">
              <Link href="/contact?channel=whatsapp">WhatsApp / Contact</Link>
              <a href="https://www.google.com/maps/search/?api=1&query=Santa+Cruz+54+C%2C+Aruba" target="_blank" rel="noreferrer">Get Directions ↗</a>
            </div>
          </section>
        </div>

        <div className="premium-footer-bottom">
          <span>© {new Date().getFullYear()} DEMAC Professional Cooling Solutions · Aruba</span>
          <div><span>Professional Cooling Solutions</span><Link href="/login">Staff Login →</Link></div>
        </div>
      </div>
    </footer>
  );
}

export function PublicSiteShell({ children, active }: PublicSiteShellProps) {
  return <main className="public-site public-subsite"><PublicHeader active={active} />{children}<PublicFooter /></main>;
}
