import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './commercial-system-photo-guide.module.css';

type GlyphName = 'cassette' | 'floorCeiling' | 'ducted' | 'rooftop' | 'airhandler' | 'vrf' | 'building' | 'arrow' | 'info';

type EquipmentSystem = {
  icon: GlyphName;
  tag: string;
  title: string;
  copy: string;
  image: string;
  imageAlt: string;
  width: number;
  height: number;
  objectPosition?: string;
  link: string;
  sourceUrl: string;
  credit: string;
  license: string;
};

function EquipmentGlyph({ name }: { name: GlyphName }) {
  const common = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  const glyphs: Record<GlyphName, ReactNode> = {
    cassette: <><rect {...common} x="4" y="4" width="16" height="16" rx="2"/><circle {...common} cx="12" cy="12" r="3.2"/><path {...common} d="M12 4v4.8M20 12h-4.8M12 20v-4.8M4 12h4.8"/></>,
    floorCeiling: <><rect {...common} x="4" y="7" width="16" height="9" rx="2"/><path {...common} d="M7 12h10M7 16v2M17 16v2M8 10h8"/></>,
    ducted: <><rect {...common} x="3" y="6" width="11" height="12" rx="2"/><path {...common} d="M14 9h4l3 3-3 3h-4M6.5 10h4M6.5 14h4"/></>,
    rooftop: <><path {...common} d="M3 20h18M5 20V9h14v11M8 9V5h8v4M8 13h8"/><circle {...common} cx="10" cy="16" r="2.2"/></>,
    airhandler: <><rect {...common} x="3" y="5" width="18" height="14" rx="2"/><circle {...common} cx="9" cy="12" r="4"/><path {...common} d="M14 8.5h4M14 12h4M14 15.5h4"/></>,
    vrf: <><rect {...common} x="5" y="3" width="14" height="18" rx="2"/><circle {...common} cx="12" cy="9" r="3.4"/><circle {...common} cx="12" cy="16" r="3.4"/><path {...common} d="M5 12h14"/></>,
    building: <><path {...common} d="M5 20V5h9v15M14 9h5v11M8 8h3M8 11h3M8 14h3M8 17h3M16.5 12h1M16.5 15h1M16.5 18h1"/></>,
    arrow: <path {...common} d="M5 12h14M14 7l5 5-5 5"/>,
    info: <><circle {...common} cx="12" cy="12" r="9"/><path {...common} d="M12 10.5V17M12 7.3h.01"/></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{glyphs[name]}</svg>;
}

const systems: EquipmentSystem[] = [
  {
    icon: 'cassette',
    tag: 'Ceiling mounted',
    title: 'Cassette systems',
    copy: 'Discreet ceiling-mounted units that distribute air in multiple directions while preserving usable wall space.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Hitachi_cassette_air_conditioner.jpg/1180px-Hitachi_cassette_air_conditioner.jpg',
    imageAlt: 'A real ceiling cassette air-conditioning unit installed in a suspended ceiling',
    width: 1180,
    height: 1024,
    objectPosition: '50% 44%',
    link: '/contact?request=commercial-equipment&system=cassette',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Hitachi_cassette_air_conditioner.jpg',
    credit: 'Nameless245',
    license: 'CC BY-SA 4.0',
  },
  {
    icon: 'floorCeiling',
    tag: 'Flexible placement',
    title: 'Floor-ceiling type systems',
    copy: 'Exposed indoor units for open areas where strong directional airflow and flexible floor or ceiling placement are important.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c7/Split_a_soffitto_1.jpg/1280px-Split_a_soffitto_1.jpg',
    imageAlt: 'A real floor-ceiling type air-conditioning unit mounted below a ceiling',
    width: 1280,
    height: 853,
    objectPosition: '50% 45%',
    link: '/contact?request=commercial-equipment&system=floor-ceiling',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Split_a_soffitto_1.jpg',
    credit: 'Antonio Mette',
    license: 'CC BY-SA 4.0',
  },
  {
    icon: 'ducted',
    tag: 'Concealed distribution',
    title: 'Commercial split & ducted systems',
    copy: 'Concealed or connected indoor equipment serving larger zones through ductwork and coordinated air distribution.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/9/93/Fan_Coil_Unit.jpg',
    imageAlt: 'A real concealed ducted fan-coil unit with its upper panel removed',
    width: 2048,
    height: 1536,
    objectPosition: '50% 48%',
    link: '/contact?request=commercial-equipment&system=ducted',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Fan_Coil_Unit.jpg',
    credit: 'Andybrooks1978',
    license: 'CC BY-SA 4.0',
  },
  {
    icon: 'rooftop',
    tag: 'Packaged outdoor unit',
    title: 'Rooftop outdoor equipment',
    copy: 'Packaged commercial units for rooftop or exterior placement, planned around access, airflow and future service.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/90/Rooftop_Packaged_Units.JPG/1280px-Rooftop_Packaged_Units.JPG',
    imageAlt: 'Real packaged commercial air-conditioning units installed outdoors on a rooftop',
    width: 1280,
    height: 848,
    objectPosition: '50% 49%',
    link: '/contact?request=commercial-equipment&system=rooftop',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Rooftop_Packaged_Units.JPG',
    credit: 'P199',
    license: 'Public domain',
  },
  {
    icon: 'airhandler',
    tag: 'Airside equipment',
    title: 'Air handlers',
    copy: 'Airside equipment that moves, filters and conditions air through coils, fans, drains and connected duct systems.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/00/Air_handling_unit.JPG/960px-Air_handling_unit.JPG',
    imageAlt: 'A real large air-handling unit connected to supply and return ductwork',
    width: 960,
    height: 720,
    objectPosition: '50% 47%',
    link: '/contact?request=commercial-service&system=air-handler',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Air_handling_unit.JPG',
    credit: 'P199',
    license: 'Public domain',
  },
  {
    icon: 'vrf',
    tag: 'Advanced multi-zone',
    title: 'VRF systems',
    copy: 'Variable Refrigerant Flow systems connecting multiple zones with flexible indoor-unit options and centralized control.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/31/VRF_Building.jpg/1280px-VRF_Building.jpg',
    imageAlt: 'A real commercial building equipped with multiple VRF outdoor units',
    width: 1280,
    height: 960,
    objectPosition: '50% 48%',
    link: '/services/vrf-systems',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:VRF_Building.jpg',
    credit: 'Nilsonsvidal',
    license: 'Public domain',
  },
];

function EquipmentCard({ system }: { system: EquipmentSystem }) {
  return (
    <Link className={styles.card} href={system.link} aria-label={`${system.title}: learn more or discuss this system`}>
      <figure className={styles.photo}>
        <img
          src={system.image}
          alt={system.imageAlt}
          width={system.width}
          height={system.height}
          loading="lazy"
          decoding="async"
          style={{ objectPosition: system.objectPosition }}
        />
        <figcaption>{system.title}</figcaption>
        <span className={styles.realPhotoBadge}>Real equipment example</span>
        <span className={styles.icon}><EquipmentGlyph name={system.icon} /></span>
      </figure>

      <span className={styles.body}>
        <small>{system.tag}</small>
        <strong>{system.title}</strong>
        <p>{system.copy}</p>
        <b aria-hidden="true"><EquipmentGlyph name="arrow" /></b>
      </span>
    </Link>
  );
}

export function CommercialSystemPhotoGuide() {
  return (
    <div className={styles.guide}>
      <div className={styles.grid} aria-label="Examples of six common commercial air-conditioning equipment types">
        {systems.map((system) => <EquipmentCard system={system} key={system.title} />)}
      </div>

      <div className={styles.note}>
        <span><EquipmentGlyph name="info" /></span>
        <p><strong>Photos shown to help identify common system types.</strong> Equipment appearance, brands and configurations vary by project. These representative photographs are not presented as DEMAC project photography or as a promise of a specific brand.</p>
      </div>

      <details className={styles.credits}>
        <summary>Representative equipment photo credits</summary>
        <div>
          <p>Source and license information for the six photographs:</p>
          <ul>
            {systems.map((system) => (
              <li key={system.sourceUrl}>
                <a href={system.sourceUrl} target="_blank" rel="noreferrer">{system.title}</a>
                <span> — {system.credit}, {system.license}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>

      <section className={styles.helpCta} aria-label="Commercial system consultation">
        <span className={styles.helpIcon}><EquipmentGlyph name="building" /></span>
        <div className={styles.helpCopy}>
          <span>Not sure which system fits your building?</span>
          <h3>Start with the property, the cooling load and the way your business operates.</h3>
          <p>DEMAC can compare practical equipment and installation paths before you commit to a commercial cooling project.</p>
        </div>
        <div className={styles.helpActions}>
          <Link className="public-button public-button-whatsapp commercial-button" href="/contact?channel=whatsapp&service=commercial">◉ WhatsApp Us</Link>
          <Link className="public-button public-button-primary commercial-button" href="/contact?request=commercial-assessment">Request a Commercial Assessment</Link>
        </div>
      </section>
    </div>
  );
}
