import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './commercial-system-photo-guide.module.css';

type GlyphName = 'cassette' | 'floorCeiling' | 'ducted' | 'rooftop' | 'airhandler' | 'vrf' | 'arrow' | 'info';

type EquipmentSystem = {
  icon: GlyphName;
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
    arrow: <path {...common} d="M4 12h15M14 7l5 5-5 5"/>,
    info: <><circle {...common} cx="12" cy="12" r="9"/><path {...common} d="M12 10.5V17M12 7.3h.01"/></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{glyphs[name]}</svg>;
}

const systems: EquipmentSystem[] = [
  {
    icon: 'cassette',
    title: 'Cassette Systems',
    copy: 'Discreet ceiling-mounted units that deliver even cooling and blend seamlessly into commercial interiors.',
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
    title: 'Floor-Ceiling Type Systems',
    copy: 'Versatile units ideal for open areas, providing powerful directional airflow and consistent comfort.',
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
    title: 'Commercial Split & Ducted Systems',
    copy: 'Reliable solutions for offices and multi-room layouts that need quiet, coordinated air distribution.',
    image: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/FUJITSU_AIR_CONDITIONER_OUTDOOR_UNIT.jpg/1280px-FUJITSU_AIR_CONDITIONER_OUTDOOR_UNIT.jpg',
    imageAlt: 'A real commercial air-conditioning outdoor condensing unit used with split and ducted systems',
    width: 1280,
    height: 809,
    objectPosition: '50% 51%',
    link: '/contact?request=commercial-equipment&system=ducted',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:FUJITSU_AIR_CONDITIONER_OUTDOOR_UNIT.jpg',
    credit: 'Dinkun Chen',
    license: 'CC BY-SA 4.0',
  },
  {
    icon: 'rooftop',
    title: 'Rooftop Outdoor Equipment',
    copy: 'Packaged equipment for larger buildings that need powerful cooling in a practical, space-saving configuration.',
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
    title: 'Air Handlers',
    copy: 'Customizable airside equipment that moves and conditions air for dependable comfort and air quality.',
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
    title: 'VRF Systems',
    copy: 'Advanced multi-zone systems that deliver precise comfort, flexible control and efficient variable-capacity operation.',
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
        <figcaption className={styles.visuallyHidden}>{system.title}</figcaption>
        <span className={styles.icon}><EquipmentGlyph name={system.icon} /></span>
      </figure>

      <span className={styles.body}>
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
        <p><strong>Representative equipment photographs.</strong> Equipment appearance, brand and final configuration vary by project. These images are not presented as DEMAC project photography or as a promise of a specific brand.</p>
      </div>

      <details className={styles.credits}>
        <summary>Equipment photo credits</summary>
        <div>
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
    </div>
  );
}
