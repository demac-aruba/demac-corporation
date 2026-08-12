import type { Metadata } from 'next';
import Link from 'next/link';
import { PublicSiteShell } from '@/components/public/public-site-shell';

export const metadata: Metadata = {
  title: 'Air Conditioning Services in Aruba',
  description: 'DEMAC air conditioning sales, installation, maintenance, diagnostics, repairs, anti-corrosion, electrical diagnostics, VRF and chilled-water air-handler services in Aruba.',
  alternates: { canonical: '/services' },
};

const serviceGroups = [
  { title: 'Air Conditioning Sales', copy: 'Cooling equipment for homes, light-commercial spaces, larger commercial properties and advanced projects.', bullets: ['Residential split systems', 'Cassette and floor-ceiling systems', 'Central systems', 'Commercial equipment', 'VRF systems', 'Special-order equipment'] },
  { title: 'Professional Installation', copy: 'Installation planned around system performance, reliability, serviceability and a clean finished result.', bullets: ['Residential installations', 'Light-commercial installations', 'Commercial systems', 'VRF projects', 'Extended piping applications', 'Rooftop and special-access work'] },
  { title: 'Service & Maintenance', copy: 'Preventive and corrective maintenance designed to protect comfort and keep equipment working efficiently.', bullets: ['Standard service', 'Deep cleaning', 'Preventive maintenance', 'Filter and coil care', 'Commercial maintenance', 'UMA / air-handler maintenance'] },
  { title: 'Diagnostics & Repair', copy: 'Structured troubleshooting to identify the cause of a cooling problem before recommending the right corrective action.', bullets: ['Cooling-performance diagnostics', 'Refrigerant system checks', 'Electrical and control diagnostics', 'Leak investigation', 'Repair recommendations', 'System condition assessments'] },
  { title: 'Anti-Corrosive Treatment', copy: 'Protective treatment for outdoor condensers exposed to Aruba’s salt air and harsh coastal conditions.', bullets: ['New equipment treatment', 'Installed-unit treatment', 'Condenser protection', 'Coastal-environment applications'] },
  { title: 'Custom Brackets & Metal Fabrication', copy: 'Custom iron fabrication for applications where a standard mounting solution is not the right fit.', bullets: ['Special condenser brackets', 'Custom equipment supports', 'Site-specific mounting solutions', 'Workshop fabrication'] },
  { title: 'A/C Electrical Diagnostics', copy: 'Electrical troubleshooting focused specifically on power, protection and supply issues affecting air-conditioning equipment.', bullets: ['A/C circuit diagnostics', 'Breaker and conductor assessment', 'Supply-voltage checks', 'Electrical fault investigation'] },
  { title: 'UMA / Chilled-Water Air Handlers', copy: 'Service and maintenance for internal air-handling units connected to chilled-water systems.', bullets: ['Internal UMA maintenance', 'Coil and airflow service', 'Air-handler condition checks', 'Excludes chiller machine-room service at this time'] },
  { title: 'VRF & Specialized Cooling', copy: 'Advanced multi-zone systems and technical support for properties with more complex cooling requirements.', bullets: ['VRF system solutions', 'Multi-zone applications', 'Commercial assessments', 'Technical project support'] },
];

export default function ServicesPage() {
  return (
    <PublicSiteShell active="services">
      <section className="public-page-hero">
        <div className="public-page-hero-inner">
          <div><span className="public-page-kicker">DEMAC services</span><h1>Professional cooling care from first install to long-term service.</h1><p>One team for residential comfort, commercial cooling, VRF, diagnostics, maintenance and specialized air-conditioning work across Aruba.</p></div>
          <div className="public-page-hero-panel" aria-hidden="true"><div className="public-page-panel-unit"/><div className="public-page-panel-air"/></div>
        </div>
      </section>
      <section className="public-page-body">
        <div className="public-page-intro"><h2>Built around the full life of your system.</h2><p>DEMAC is not limited to selling equipment. We help select systems, install them, maintain them, diagnose faults, repair problems and support specialized cooling applications as requirements become more complex.</p></div>
        <div className="public-detail-grid">
          {serviceGroups.map((service,index)=><article className="public-detail-card" key={service.title}><span className="number">0{index+1}</span><h3>{service.title}</h3><p>{service.copy}</p><ul>{service.bullets.map(item=><li key={item}>{item}</li>)}</ul></article>)}
        </div>
        <div className="public-page-band"><div><h2>Not sure which service you need?</h2><p>Start with what you are experiencing. Our team can determine whether the next step should be service, a technical check, repair, replacement or a larger system assessment.</p></div><Link href="/contact">Contact DEMAC →</Link></div>
      </section>
    </PublicSiteShell>
  );
}
