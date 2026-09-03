'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

type SystemIconName = 'cassette' | 'floorCeiling' | 'ducted' | 'rooftop' | 'airHandler' | 'zones' | 'building' | 'arrow';

function SystemIcon({ name }: { name: SystemIconName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const icons: Record<SystemIconName, ReactNode> = {
    cassette: <><rect {...common} x="5" y="5" width="14" height="14" rx="2"/><circle {...common} cx="12" cy="12" r="3"/><path {...common} d="M12 5v4M19 12h-4M12 19v-4M5 12h4"/></>,
    floorCeiling: <><rect {...common} x="4" y="7" width="16" height="9" rx="2"/><path {...common} d="M7 12h10M7 16v2M17 16v2M8 10h8"/></>,
    ducted: <><rect {...common} x="3" y="7" width="12" height="10" rx="2"/><path {...common} d="M15 10h4l2 2-2 2h-4M7 10h4M7 14h4"/></>,
    rooftop: <><path {...common} d="M3 19h18M5 19V9h14v10M8 9V5h8v4M8 13h8"/></>,
    airHandler: <><rect {...common} x="4" y="5" width="16" height="14" rx="2"/><circle {...common} cx="10" cy="12" r="4"/><path {...common} d="M14 9h3M14 12h3M14 15h3"/></>,
    zones: <><rect {...common} x="4" y="4" width="6" height="6" rx="1"/><rect {...common} x="14" y="4" width="6" height="6" rx="1"/><rect {...common} x="4" y="14" width="6" height="6" rx="1"/><rect {...common} x="14" y="14" width="6" height="6" rx="1"/></>,
    building: <><path {...common} d="M5 20V5h9v15M14 9h5v11M8 8h3M8 11h3M8 14h3M8 17h3M16.5 12h1M16.5 15h1M16.5 18h1"/></>,
    arrow: <path {...common} d="M5 12h14M14 7l5 5-5 5"/>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{icons[name]}</svg>;
}

const systems = [
  {
    className: 'is-cassette',
    icon: 'cassette' as const,
    title: 'Cassette systems',
    copy: 'Discreet ceiling-mounted units that distribute air in multiple directions while preserving usable wall space.',
    tag: 'Ceiling mounted',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Hitachi_cassette_air_conditioner.jpg/1180px-Hitachi_cassette_air_conditioner.jpg',
    imageAlt: 'Ceiling cassette air-conditioning unit installed in a suspended ceiling',
    link: '/contact?request=commercial-equipment&system=cassette',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hitachi_cassette_air_conditioner.jpg',
    credit: 'Nameless245',
    license: 'CC BY-SA 4.0',
  },
  {
    className: 'is-floor-ceiling',
    icon: 'floorCeiling' as const,
    title: 'Floor-ceiling type systems',
    copy: 'Versatile exposed indoor units for open areas where strong directional airflow and flexible placement are important.',
    tag: 'Flexible placement',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Split_a_soffitto_1.jpg/1280px-Split_a_soffitto_1.jpg',
    imageAlt: 'Floor-ceiling type air-conditioning unit mounted below a ceiling',
    link: '/contact?request=commercial-equipment&system=floor-ceiling',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Split_a_soffitto_1.jpg',
    credit: 'Antonio Mette',
    license: 'CC BY-SA 4.0',
  },
  {
    className: 'is-ducted',
    icon: 'ducted' as const,
    title: 'Commercial split & ducted systems',
    copy: 'Concealed or connected indoor equipment serving larger zones through ductwork and coordinated air distribution.',
    tag: 'Concealed distribution',
    image: 'https://upload.wikimedia.org/wikipedia/commons/9/93/Fan_Coil_Unit.jpg',
    imageAlt: 'Concealed ducted fan-coil unit with its upper panel removed',
    link: '/contact?request=commercial-equipment&system=ducted',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fan_Coil_Unit.jpg',
    credit: 'Andybrooks1978',
    license: 'CC BY-SA 4.0',
  },
  {
    className: 'is-rooftop',
    icon: 'rooftop' as const,
    title: 'Rooftop outdoor equipment',
    copy: 'Packaged commercial units for rooftop or exterior placement, planned around access, airflow and future service.',
    tag: 'Packaged outdoor unit',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Rooftop_Packaged_Units.JPG/1280px-Rooftop_Packaged_Units.JPG',
    imageAlt: 'Packaged commercial air-conditioning units installed outdoors on a rooftop',
    link: '/contact?request=commercial-equipment&system=rooftop',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Rooftop_Packaged_Units.JPG',
    credit: 'P199',
    license: 'Public domain',
  },
  {
    className: 'is-air-handler',
    icon: 'airHandler' as const,
    title: 'Air handlers',
    copy: 'Airside equipment that moves, filters and conditions air through coils, fans and connected duct systems.',
    tag: 'Airside equipment',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Air_handling_unit.JPG/960px-Air_handling_unit.JPG',
    imageAlt: 'Large air-handling unit connected to supply and return ductwork',
    link: '/contact?request=commercial-service&system=air-handler',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Air_handling_unit.JPG',
    credit: 'P199',
    license: 'Public domain',
  },
  {
    className: 'is-vrf',
    icon: 'zones' as const,
    title: 'VRF systems',
    copy: 'Variable Refrigerant Flow systems connecting multiple zones with flexible indoor-unit options and centralized control.',
    tag: 'Advanced multi-zone',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/VRF_Building.jpg/1280px-VRF_Building.jpg',
    imageAlt: 'Commercial building equipped with multiple VRF outdoor units',
    link: '/services/vrf-systems',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:VRF_Building.jpg',
    credit: 'Nilsonsvidal',
    license: 'Public domain',
  },
];

export function CommercialSystemGalleryEnhancer() {
  const [target, setTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const section = document.querySelector<HTMLElement>('.commercial-segment-page .commercial-systems-section');
    if (!section) return;
    setTarget(section);
  }, []);

  useEffect(() => {
    if (!target) return;

    const previousIntro = target.querySelector<HTMLElement>(':scope > .commercial-systems-intro');
    const previousStack = target.querySelector<HTMLElement>(':scope > .commercial-system-stack');

    target.classList.add('has-system-photo-gallery');
    previousIntro?.setAttribute('hidden', '');
    previousStack?.setAttribute('hidden', '');

    return () => {
      target.classList.remove('has-system-photo-gallery');
      previousIntro?.removeAttribute('hidden');
      previousStack?.removeAttribute('hidden');
    };
  }, [target]);

  if (!target) return null;

  return createPortal(
    <div className="commercial-system-gallery-enhancement">
      <div className="commercial-system-gallery-intro">
        <div>
          <span>System applications</span>
          <h2>Match the cooling approach <em>to the building, not the other way around.</em></h2>
        </div>
        <div>
          <p>Every commercial property has different loads, layouts and operating priorities. These representative photos help customers recognize common equipment types before DEMAC evaluates capacity, airflow, access, controls and service requirements.</p>
          <Link href="/contact?request=commercial-assessment">Request a system review →</Link>
        </div>
      </div>

      <div className="commercial-system-gallery" aria-label="Common commercial cooling system types">
        {systems.map((system) => (
          <Link className={`commercial-system-photo-card ${system.className}`} href={system.link} key={system.title}>
            <span className="commercial-system-photo">
              <img src={system.image} alt={system.imageAlt} width={1280} height={900} loading="lazy" decoding="async" />
              <span className="commercial-system-photo-icon"><SystemIcon name={system.icon} /></span>
            </span>
            <span className="commercial-system-photo-copy">
              <small>{system.tag}</small>
              <strong>{system.title}</strong>
              <p>{system.copy}</p>
              <b aria-hidden="true"><SystemIcon name="arrow" /></b>
            </span>
          </Link>
        ))}
      </div>

      <div className="commercial-system-note">
        <span aria-hidden="true">i</span>
        <p>Representative equipment photos are shown to help identify common system types. Brands, configurations and final selections vary by project.</p>
      </div>

      <details className="commercial-photo-credits">
        <summary>Photo credits and licenses</summary>
        <ul>
          {systems.map((system) => (
            <li key={system.sourceUrl}>
              <a href={system.sourceUrl} target="_blank" rel="noreferrer">{system.title}</a>
              {' · '}{system.credit}{' · '}{system.license}
            </li>
          ))}
        </ul>
      </details>

      <div className="commercial-system-help-cta">
        <span className="commercial-system-help-icon"><SystemIcon name="building" /></span>
        <div className="commercial-system-help-copy">
          <span>Not sure which system fits your building?</span>
          <h3>Start with the property, the load and the way your business operates.</h3>
          <p>DEMAC can compare practical equipment and installation paths before you commit to a commercial cooling project.</p>
        </div>
        <div className="commercial-system-help-actions">
          <Link className="public-button public-button-whatsapp commercial-button" href="/contact?channel=whatsapp&service=commercial">◉ WhatsApp Us</Link>
          <Link className="public-button public-button-primary commercial-button" href="/contact?request=commercial-assessment">Request a Commercial Assessment</Link>
        </div>
      </div>
    </div>,
    target,
  );
}
