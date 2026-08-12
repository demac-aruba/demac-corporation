import Link from 'next/link';
import type { ReactNode } from 'react';

type PublicSiteShellProps = {
  children: ReactNode;
  active?: 'home' | 'services' | 'projects' | 'about' | 'contact';
};

const links = [
  ['home', '/', 'Home'],
  ['services', '/services', 'Services'],
  ['projects', '/projects', 'Projects'],
  ['about', '/about', 'About Us'],
  ['contact', '/contact', 'Contact'],
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
          {links.map(([id, href, label]) => <Link className={active === id ? 'is-active' : ''} href={href} key={id}>{label}</Link>)}
          <Link href="/#industries">Industries</Link>
        </nav>
        <div className="public-header-actions">
          <Link className="public-button public-button-whatsapp" href="/contact?channel=whatsapp"><span aria-hidden="true">◉</span> WhatsApp Us</Link>
          <Link className="public-button public-button-primary" href="/contact?request=estimate">Request Estimate</Link>
        </div>
        <details className="public-mobile-menu">
          <summary aria-label="Open navigation"><span /><span /><span /></summary>
          <div>
            {links.map(([id, href, label]) => <Link href={href} key={id}>{label}</Link>)}
            <Link href="/#industries">Industries</Link>
            <Link href="/login">Staff Login</Link>
          </div>
        </details>
      </div>
    </header>
  );
}

export function PublicFooter() {
  return (
    <footer className="public-footer public-footer-pages">
      <div className="public-footer-brand">
        <span className="public-snow" aria-hidden="true">❄</span>
        <span><strong>DEMAC</strong><small>Professional Cooling Solutions</small></span>
      </div>
      <div className="public-footer-links">
        <Link href="/services">Services</Link><Link href="/projects">Projects</Link><Link href="/about">About</Link><Link href="/contact">Contact</Link>
      </div>
      <div className="public-footer-office"><span>Office</span><strong>Santa Cruz 54 C · Aruba</strong></div>
      <Link className="public-staff-link" href="/login">Staff Login →</Link>
      <p>© {new Date().getFullYear()} DEMAC. All rights reserved.</p>
    </footer>
  );
}

export function PublicSiteShell({ children, active }: PublicSiteShellProps) {
  return <main className="public-site public-subsite"><PublicHeader active={active} />{children}<PublicFooter /></main>;
}
