import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import styles from './commercial-system-photo-guide.module.css';

type GlyphName = 'cassette' | 'ducted' | 'rooftop' | 'airhandler' | 'vrf' | 'arrow' | 'info';

type EquipmentPhoto = {
  src: string;
  alt: string;
  label: string;
  width: number;
  height: number;
  objectPosition?: CSSProperties['objectPosition'];
};

type EquipmentSystem = {
  icon: GlyphName;
  tag: string;
  title: string;
  copy: string;
  photos: EquipmentPhoto[];
  link?: string;
  cta?: string;
  wide?: boolean;
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
    ducted: <><rect {...common} x="3" y="6" width="11" height="12" rx="2"/><path {...common} d="M14 9h4l3 3-3 3h-4M6.5 10h4M6.5 14h4"/></>,
    rooftop: <><path {...common} d="M3 20h18M5 20V9h14v11M8 9V5h8v4M8 13h8"/><circle {...common} cx="10" cy="16" r="2.2"/></>,
    airhandler: <><rect {...common} x="3" y="5" width="18" height="14" rx="2"/><circle {...common} cx="9" cy="12" r="4"/><path {...common} d="M14 8.5h4M14 12h4M14 15.5h4"/></>,
    vrf: <><rect {...common} x="5" y="3" width="14" height="18" rx="2"/><circle {...common} cx="12" cy="9" r="3.4"/><circle {...common} cx="12" cy="16" r="3.4"/><path {...common} d="M5 12h14"/></>,
    arrow: <path {...common} d="M5 12h14M14 7l5 5-5 5"/>,
    info: <><circle {...common} cx="12" cy="12" r="9"/><path {...common} d="M12 10.5V17M12 7.3h.01"/></>,
  };

  return <svg viewBox="0 0 24 24" aria-hidden="true">{glyphs[name]}</svg>;
}

const systems: EquipmentSystem[] = [
  {
    icon: 'cassette',
    tag: 'Open areas',
    title: 'Cassette & floor-ceiling systems',
    copy: 'Visible indoor units that distribute air across restaurants, offices, retail areas and other open commercial spaces.',
    photos: [
      {
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/0f/Hitachi_cassette_air_conditioner.jpg/1180px-Hitachi_cassette_air_conditioner.jpg',
        alt: 'A real ceiling cassette air-conditioning unit installed in a suspended ceiling',
        label: 'Ceiling cassette',
        width: 1180,
        height: 1024,
        objectPosition: '50% 46%',
      },
      {
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/cb/Daikin_ceiling_suspended_air_conditioner.jpg/1280px-Daikin_ceiling_suspended_air_conditioner.jpg',
        alt: 'A real floor-ceiling or ceiling-suspended commercial air-conditioning indoor unit',
        label: 'Floor-ceiling unit',
        width: 1280,
        height: 1014,
        objectPosition: '50% 48%',
      },
    ],
  },
  {
    icon: 'ducted',
    tag: 'Larger zones',
    title: 'Commercial split & ducted systems',
    copy: 'An outdoor condensing unit connects to indoor equipment or ductwork that distributes conditioned air through the building.',
    photos: [
      {
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/7b/FUJITSU_AIR_CONDITIONER_OUTDOOR_UNIT.jpg/1280px-FUJITSU_AIR_CONDITIONER_OUTDOOR_UNIT.jpg',
        alt: 'A real commercial air-conditioning outdoor condensing unit',
        label: 'Outdoor condenser',
        width: 1280,
        height: 809,
        objectPosition: '50% 52%',
      },
      {
        src: 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/12/ADS_Air_conditioning_duct_systems.jpg/960px-ADS_Air_conditioning_duct_systems.jpg',
        alt: 'A real air-conditioning duct system installed above a ceiling',
        label: 'Duct distribution',
        width: 960,
        height: 1707,
        objectPosition: '50% 42%',
      },
    ],
  },
  {
    icon: 'rooftop',
    tag: 'Exterior equipment',
    title: 'Rooftop & outdoor equipment',
    copy: 'Packaged equipment positioned outdoors or on a roof, with service planning based on access, supports, airflow and exposure.',
    photos: [
      {
        src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/90/Rooftop_Packaged_Units.JPG/1280px-Rooftop_Packaged_Units.JPG',
        alt: 'Real packaged commercial air-conditioning equipment installed on a rooftop',
        label: 'Rooftop packaged units',
        width: 1280,
        height: 848,
        objectPosition: '50% 48%',
      },
    ],
  },
  {
    icon: 'airhandler',
    tag: 'Airside service',
    title: 'Air handlers & chilled-water terminal units',
    copy: 'Indoor airside equipment containing fans, coils, filters, drains and controls that conditions and circulates building air.',
    photos: [
      {
        src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/ff/HVAC_Air_Handler_Unit%2C_pic1.JPG/1280px-HVAC_Air_Handler_Unit%2C_pic1.JPG',
        alt: 'A real large commercial HVAC air handling unit installed inside a mechanical area',
        label: 'Commercial air handler',
        width: 1280,
        height: 960,
        objectPosition: '50% 48%',
      },
    ],
  },
  {
    icon: 'vrf',
    tag: 'Complex zoning',
    title: 'VRF multi-zone systems',
    copy: 'One modular outdoor system can serve multiple indoor zones with variable-capacity operation and centralized control options.',
    photos: [
      {
        src: 'https://commons.wikimedia.org/wiki/Special:Redirect/file/DAIKIN_AIR_CONDITIONER_OUTDOOR_UNIT_RQCZQ8CAVN.jpg?width=1280',
        alt: 'A real tall modular commercial outdoor air-conditioning unit representative of VRF equipment',
        label: 'VRF outdoor module',
        width: 960,
        height: 1325,
        objectPosition: '50% 48%',
      },
    ],
    link: '/services/vrf-systems',
    cta: 'Explore VRF systems',
    wide: true,
  },
];

const credits = [
  {
    label: 'Ceiling cassette',
    author: 'Nameless245',
    license: 'CC BY-SA 4.0',
    href: 'https://commons.wikimedia.org/wiki/File:Hitachi_cassette_air_conditioner.jpg',
  },
  {
    label: 'Floor-ceiling unit',
    author: 'Nameless245',
    license: 'CC BY-SA 4.0',
    href: 'https://commons.wikimedia.org/wiki/File:Daikin_ceiling_suspended_air_conditioner.jpg',
  },
  {
    label: 'Outdoor condenser',
    author: 'Dinkun Chen',
    license: 'CC BY-SA 4.0',
    href: 'https://commons.wikimedia.org/wiki/File:FUJITSU_AIR_CONDITIONER_OUTDOOR_UNIT.jpg',
  },
  {
    label: 'Duct distribution',
    author: 'Chesly cherizol',
    license: 'CC BY-SA 4.0',
    href: 'https://commons.wikimedia.org/wiki/File:ADS_Air_conditioning_duct_systems.jpg',
  },
  {
    label: 'Rooftop packaged units',
    author: 'P199',
    license: 'Public domain',
    href: 'https://commons.wikimedia.org/wiki/File:Rooftop_Packaged_Units.JPG',
  },
  {
    label: 'Commercial air handler',
    author: 'Alf van Beem',
    license: 'CC0 1.0',
    href: 'https://commons.wikimedia.org/wiki/File:HVAC_Air_Handler_Unit,_pic1.JPG',
  },
  {
    label: 'VRF outdoor module',
    author: 'Dinkun Chen',
    license: 'CC BY-SA 4.0',
    href: 'https://commons.wikimedia.org/wiki/File:DAIKIN_AIR_CONDITIONER_OUTDOOR_UNIT_RQCZQ8CAVN.jpg',
  },
];

function EquipmentCard({ system, index }: { system: EquipmentSystem; index: number }) {
  const cardClassName = `${styles.card} ${system.wide ? styles.wide : ''}`;
  const content = (
    <>
      <div className={`${styles.media} ${system.photos.length > 1 ? styles.mediaSplit : ''}`}>
        {system.photos.map((photo) => (
          <figure className={styles.photo} key={photo.label}>
            <img
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              loading="lazy"
              decoding="async"
              style={{ objectPosition: photo.objectPosition }}
            />
            <figcaption>{photo.label}</figcaption>
          </figure>
        ))}
        <span className={styles.realPhotoBadge}>Real equipment example</span>
      </div>

      <div className={styles.body}>
        <span className={styles.icon}><EquipmentGlyph name={system.icon} /></span>
        <span className={styles.copy}>
          <small>{system.tag}</small>
          <strong>{system.title}</strong>
          <p>{system.copy}</p>
          {system.cta ? <b>{system.cta}<i><EquipmentGlyph name="arrow" /></i></b> : null}
        </span>
        <span className={styles.number}>0{index + 1}</span>
      </div>
    </>
  );

  return system.link ? (
    <Link className={cardClassName} href={system.link} aria-label={`${system.title}: ${system.cta ?? 'learn more'}`}>
      {content}
    </Link>
  ) : (
    <article className={cardClassName}>{content}</article>
  );
}

export function CommercialSystemPhotoGuide() {
  return (
    <div className={styles.guide}>
      <div className={styles.grid} aria-label="Examples of commercial air-conditioning equipment types">
        {systems.map((system, index) => <EquipmentCard system={system} index={index} key={system.title} />)}
      </div>

      <div className={styles.note}>
        <span><EquipmentGlyph name="info" /></span>
        <p><strong>Equipment appearance varies.</strong> These photographs help identify each equipment category; they do not indicate a specific brand or model currently offered by DEMAC and are not presented as DEMAC project photographs.</p>
      </div>

      <details className={styles.credits}>
        <summary>Representative equipment photo credits</summary>
        <div>
          <p>Images are displayed as cropped web previews. Source and license information:</p>
          <ul>
            {credits.map((credit) => (
              <li key={credit.label}>
                <a href={credit.href} target="_blank" rel="noreferrer">{credit.label}</a>
                <span> — {credit.author}, {credit.license}</span>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}
