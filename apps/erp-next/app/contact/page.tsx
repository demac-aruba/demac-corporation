import type { Metadata } from 'next';
import { PublicSiteShell } from '@/components/public/public-site-shell';

export const metadata: Metadata = {
  title: 'Contact DEMAC | Air Conditioning Aruba',
  description: 'Contact DEMAC Professional Cooling Solutions in Aruba for residential, commercial, VRF, service, maintenance, diagnostic and installation inquiries.',
  alternates: { canonical: '/contact' },
};

export default function ContactPage() {
  return (
    <PublicSiteShell active="contact">
      <section className="public-page-hero">
        <div className="public-page-hero-inner">
          <div><span className="public-page-kicker">Contact DEMAC</span><h1>Tell us what cooling solution you need.</h1><p>Service appointment, estimate, installation, equipment purchase or commercial project—start with the property and what you are trying to solve.</p></div>
          <div className="public-page-hero-panel" aria-hidden="true"><div className="public-page-panel-unit"/><div className="public-page-panel-air"/></div>
        </div>
      </section>
      <section className="public-page-body">
        <div className="public-contact-layout">
          <article className="public-contact-info">
            <span className="public-page-kicker">Our office</span>
            <h2>DEMAC Professional Cooling Solutions</h2>
            <p>Our customer contact experience is being connected to the same operational platform used by the DEMAC team. The physical office information below is already part of the public website foundation.</p>
            <div className="public-contact-methods">
              <div className="public-contact-method"><span>Office location</span><strong>Santa Cruz 54 C, Santa Cruz, Aruba</strong></div>
              <div className="public-contact-method"><span>WhatsApp</span><strong>Sales · Service requests · Estimates</strong></div>
              <div className="public-contact-method"><span>Commercial inquiries</span><strong>Commercial A/C · VRF · Specialized projects</strong></div>
            </div>
          </article>
          <article className="public-contact-form">
            <span className="public-page-kicker">Request details</span>
            <h2>Start your request</h2>
            <p>This is the visual foundation for the customer request flow. The next integration will connect submissions directly into DEMAC CRM/Booking Intelligence instead of sending unstructured website emails.</p>
            <form className="public-form-grid">
              <div className="public-form-field"><label htmlFor="customer-name">Name</label><input id="customer-name" name="name" placeholder="Your name" /></div>
              <div className="public-form-field"><label htmlFor="customer-phone">Phone / WhatsApp</label><input id="customer-phone" name="phone" placeholder="+297 ..." /></div>
              <div className="public-form-field full"><label htmlFor="request-type">What do you need?</label><select id="request-type" name="requestType" defaultValue=""><option value="" disabled>Select a request type</option><option>Service / Maintenance</option><option>Diagnostic / Repair</option><option>New A/C / Estimate</option><option>Installation</option><option>Commercial / VRF Project</option><option>Other</option></select></div>
              <div className="public-form-field full"><label htmlFor="customer-message">Tell us a little more</label><textarea id="customer-message" name="message" placeholder="Property area, equipment, number of A/C units, issue or project details..." /></div>
              <p className="public-form-note">Online submission is intentionally not activated yet. We will connect this form to the DEMAC CRM so customer records, properties and booking requests are created correctly instead of generating duplicate or disconnected leads.</p>
              <button className="public-form-button" type="button" aria-disabled="true">CRM connection coming in the next integration</button>
            </form>
          </article>
        </div>
      </section>
    </PublicSiteShell>
  );
}
