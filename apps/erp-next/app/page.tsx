import type { Metadata } from 'next';
import Link from 'next/link';
import './landing.css';

export const metadata: Metadata = {
  title: 'DEMAC Professional Cooling Solutions | Aruba',
  description:
    'DEMAC Professional Cooling Solutions in Aruba. Our new website is currently under construction while we continue providing professional air conditioning solutions.',
  alternates: { canonical: '/' },
  robots: { index: true, follow: true },
  openGraph: {
    title: 'DEMAC Professional Cooling Solutions | Aruba',
    description:
      'Professional air conditioning sales, installations, maintenance, diagnostics and repairs in Aruba. Our new website is currently under construction.',
    url: 'https://demac-aruba.com',
    siteName: 'DEMAC Professional Cooling Solutions',
    locale: 'en_AW',
    type: 'website',
  },
};

const services = [
  ['Sales', 'Professional cooling equipment for homes and businesses.'],
  ['Installation', 'Professional installation built around performance and reliability.'],
  ['Maintenance', 'Preventive service to keep cooling systems operating at their best.'],
  ['Diagnostics & Repair', 'Professional assessment and repair solutions when something is not right.'],
];

export default function HomePage() {
  return (
    <main className="landing-page">
      <div className="landing-glow landing-glow-one" />
      <div className="landing-glow landing-glow-two" />

      <header className="landing-nav">
        <Link className="landing-brand" href="/" aria-label="DEMAC home">
          <span className="landing-brand-mark">D</span>
          <span className="landing-brand-copy">
            <strong>DEMAC</strong>
            <small>Professional Cooling Solutions</small>
          </span>
        </Link>
        <Link className="landing-login" href="/login">
          <span>Staff Login</span>
          <span aria-hidden="true">→</span>
        </Link>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="landing-status"><i /> Building something better for Aruba</div>
          <p className="landing-kicker">Professional Cooling Solutions</p>
          <h1>
            Aruba stays cool.
            <span>Our new website is on the way.</span>
          </h1>
          <p className="landing-intro">
            We are building a new digital experience to better serve our customers. While the website is under construction,
            DEMAC continues providing professional air conditioning solutions across Aruba.
          </p>
          <div className="landing-actions">
            <Link className="landing-primary" href="/login">Staff Login <span>→</span></Link>
            <a className="landing-secondary" href="#services">Explore our services</a>
          </div>
          <div className="landing-trust">
            <span>Aruba</span><i />
            <span>Residential</span><i />
            <span>Commercial</span>
          </div>
        </div>

        <div className="landing-visual" aria-hidden="true">
          <div className="landing-orbit orbit-one" />
          <div className="landing-orbit orbit-two" />
          <div className="landing-cooling-card">
            <div className="landing-unit">
              <div className="landing-unit-brand">DEMAC</div>
              <div className="landing-unit-line" />
              <div className="landing-unit-vent">
                <span /><span /><span /><span /><span /><span />
              </div>
              <div className="landing-unit-light" />
            </div>
            <div className="landing-airflow airflow-one" />
            <div className="landing-airflow airflow-two" />
            <div className="landing-airflow airflow-three" />
          </div>
          <div className="landing-temperature-card">
            <span>Professional comfort</span>
            <strong>Cooling Aruba</strong>
            <small>Sales · Installation · Service</small>
          </div>
        </div>
      </section>

      <section className="landing-services" id="services">
        <div className="landing-section-head">
          <p>What we do</p>
          <h2>Cooling expertise you can count on.</h2>
          <span>Our full customer website is coming soon. Our professional services continue as normal.</span>
        </div>
        <div className="landing-service-grid">
          {services.map(([title, description], index) => (
            <article className="landing-service-card" key={title}>
              <span className="landing-service-number">0{index + 1}</span>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-construction">
        <div>
          <span className="landing-construction-label">Website update</span>
          <h2>Our customer experience is under construction.</h2>
          <p>
            We are focused on building the systems behind the scenes first. A complete customer-facing DEMAC website will follow.
          </p>
        </div>
        <div className="landing-progress" aria-label="Website construction progress indicator">
          <div><span>Digital platform</span><strong>IN PROGRESS</strong></div>
          <div className="landing-progress-track"><span /></div>
          <small>Thank you for your patience.</small>
        </div>
      </section>

      <footer className="landing-footer">
        <div>
          <strong>DEMAC Professional Cooling Solutions</strong>
          <span>Aruba</span>
        </div>
        <p>© {new Date().getFullYear()} DEMAC. All rights reserved.</p>
        <Link href="/login">Authorized staff access</Link>
      </footer>
    </main>
  );
}
