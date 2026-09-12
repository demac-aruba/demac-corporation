import type { Metadata } from 'next';
import { PublicSiteShell } from '@/components/public/public-site-shell';
import { loadPublishedVrfContent } from '@/lib/public-vrf-public';
import type { VrfCard, VrfLink } from '@/lib/public-vrf-content';
import styles from './vrf-premium.module.css';

export const metadata: Metadata = {
  title: 'VRF Systems in Aruba',
  description: 'Large VRF, modular VRF and mini VRF design, installation, commissioning, service and maintenance in Aruba.',
  alternates: { canonical: '/services/vrf-systems' },
  openGraph: {
    title: 'VRF Systems in Aruba | DEMAC',
    description: 'Smarter zoning, energy efficiency and end-to-end VRF support for buildings across Aruba.',
    type: 'website',
    url: '/services/vrf-systems',
  },
};

const APPROVED_HERO_IMAGE = 'https://images.unsplash.com/photo-1775629632806-165d644178c0?auto=format&fit=crop&fm=webp&q=88&w=2200';
const LEGACY_HERO_IMAGE = 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&fm=webp&q=88&w=2200';

const indoorUnitImages: Record<string, string> = {
  cassette: 'https://www.pinclipart.com/picdir/middle/535-5355980_inverter-4-way-cassette-samsung-ceiling-cassette-air.png',
  'fan-coil': 'https://cdn1-1.ddc.kz/nomenclature/images/60309/fan_coil1.png',
  'floor-ceiling': 'https://cdn.freewebstore.com/origin/32505/1457534704266_mideauniversalfront.jpg',
  'air-handler': 'https://www.holtop.com/uploads/Air-Handling-Unit-Customized-AHU.jpg',
  'split-unit': 'https://pngimg.com/uploads/air_conditioner/air_conditioner_PNG42.png',
  'wall-mounted': 'https://pngimg.com/uploads/air_conditioner/air_conditioner_PNG42.png',
};

const applicationImages: Record<string, string> = {
  apartments: 'https://images.unsplash.com/photo-1775629632806-165d644178c0?auto=format&fit=crop&fm=webp&q=86&w=1000',
  hospitality: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&fm=webp&q=86&w=1000',
  office: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&fm=webp&q=86&w=1000',
  retail: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&fm=webp&q=86&w=1000',
  villas: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&fm=webp&q=86&w=1000',
  controlled: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&fm=webp&q=86&w=1000',
};

const trustImageFallback = 'https://skipcalls.com/aeo/hvac/hvac-first-hot-day-my-phone-blows-up-with-no-cool-calls.webp';
const ctaBackground = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&fm=webp&q=86&w=2200';

function ActionLink({ link, tone = 'primary' }: { link: VrfLink; tone?: 'primary' | 'whatsapp' | 'ghost' }) {
  const className = tone === 'whatsapp' ? styles.whatsappButton : tone === 'ghost' ? styles.ghostButton : styles.primaryButton;
  return <a className={className} href={link.href}>{tone === 'whatsapp' ? <span className={styles.whatsappGlyph}>●</span> : null}{link.label}<span aria-hidden="true">→</span></a>;
}

function LineIcon({ index }: { index: number }) {
  const icons = [
    <path key="a" d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1m-8.6 8.6-2.1 2.1M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z" />,
    <path key="b" d="M20 4c-7.2.5-12.3 3.7-12.3 9.1 0 3.4 2.4 5.4 5.2 5.4 5.4 0 7.1-8.3 7.1-14.5ZM5 20c2-4.6 5.3-7.7 10.3-10.2" />,
    <path key="c" d="M4 5h16v14H4V5Zm0 5h16M10 10v9" />,
    <path key="d" d="M4 12h5l2-5 3 10 2-5h4" />,
    <path key="e" d="M4 6h16v12H4V6Zm4 15h8M12 18v3M8 10h8m-8 4h5" />,
    <path key="f" d="M5 10v4m3-7v10m3-13v16m4-11v6m3-3v1" />,
  ];
  return <svg viewBox="0 0 24 24" aria-hidden="true">{icons[index % icons.length]}</svg>;
}

function OutdoorSystemArt({ variant = 0 }: { variant?: number }) {
  const count = variant === 0 ? 3 : variant === 1 ? 2 : 1;
  return (
    <div className={styles.outdoorArt} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span className={styles.outdoorCabinet} key={index}>
          <i className={styles.fan}><b /></i>
          <i className={`${styles.fan} ${styles.fanLower}`}><b /></i>
          <em>DEMAC</em>
        </span>
      ))}
    </div>
  );
}

function MiniIndoor({ type, label }: { type: 'wall' | 'cassette' | 'ducted' | 'air-handler'; label: string }) {
  return <div className={`${styles.miniIndoor} ${styles[`mini${type === 'air-handler' ? 'AirHandler' : type.charAt(0).toUpperCase() + type.slice(1)}`]}`}><span>{label}</span></div>;
}

function SectionHead({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: string }) {
  return (
    <div className={styles.sectionHead}>
      <div><span className={styles.eyebrow}>{eyebrow}</span><h2>{title}</h2></div>
      {copy ? <p>{copy}</p> : null}
    </div>
  );
}

function CardCopy({ card }: { card: VrfCard }) {
  return <><h3>{card.title}</h3><p>{card.description}</p>{card.detail ? <small>{card.detail}</small> : null}</>;
}

export default async function VrfSystemsPage() {
  const content = await loadPublishedVrfContent();
  const heroImage = content.hero.imageUrl === LEGACY_HERO_IMAGE ? APPROVED_HERO_IMAGE : content.hero.imageUrl;
  const trustImage = content.trust.imageUrl.includes('photo-1621905251189-08b45d6a269e') ? trustImageFallback : content.trust.imageUrl;

  return (
    <PublicSiteShell active="services">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.container}>
            <div className={styles.heroGrid}>
              <div className={styles.heroCopy}>
                <span className={styles.eyebrow}>{content.hero.eyebrow}</span>
                <h1>{content.hero.title} <strong>{content.hero.accent}</strong></h1>
                <p>{content.hero.description}</p>
                <div className={styles.heroActions}>
                  <ActionLink link={content.hero.secondaryCta} tone="whatsapp" />
                  <ActionLink link={content.hero.primaryCta} />
                </div>
                <div className={styles.heroProof}>
                  {['Higher Energy Efficiency', 'Individual Zoning Control', 'Expert Design & Installation', 'Long-Term After-Sales Support'].map((item, index) => (
                    <div key={item}><span><LineIcon index={index + 1} /></span><b>{item}</b></div>
                  ))}
                </div>
              </div>

              <div className={styles.heroVisual}>
                <div className={styles.heroPhoto} style={{ backgroundImage: `url(${heroImage})`, backgroundPosition: content.hero.imagePosition }} />
                <div className={styles.heroPhotoWash} />
                <div className={styles.comfortScript}>Comfort<br />in Every Space</div>
                <div className={styles.cutaway} aria-label="VRF zoning example">
                  <div className={styles.cutawayRoom}><MiniIndoor type="wall" label="Wall Mounted" /></div>
                  <div className={styles.cutawayRoom}><MiniIndoor type="cassette" label="Cassette" /></div>
                  <div className={styles.cutawayRoom}><MiniIndoor type="ducted" label="Ducted" /></div>
                  <div className={styles.cutawayRoom}><MiniIndoor type="air-handler" label="Air Handler" /></div>
                </div>
                <svg className={styles.zoneNetwork} viewBox="0 0 720 500" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M410 390V96M410 120H535M410 205H558M410 292H533M410 378H555" />
                  {[['410','120'],['535','120'],['410','205'],['558','205'],['410','292'],['533','292'],['410','378'],['555','378']].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" />)}
                </svg>
                <div className={styles.heroOutdoor}><OutdoorSystemArt variant={0} /></div>
                <aside className={styles.systemPanel}>
                  <strong>ONE SYSTEM.<br />MULTIPLE ZONES.<br />TOTAL COMFORT.</strong>
                  {['Apartments', 'Hotel Rooms', 'Offices', 'Retail Spaces', 'Villas & Homes'].map((item, index) => <span key={item}><i><LineIcon index={index} /></i>{item}</span>)}
                </aside>
                <div className={styles.arubaBadge}><b>✦</b><span>ENGINEERED<br />FOR ARUBA</span></div>
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.solutionsSection}`}>
          <div className={styles.container}>
            <SectionHead eyebrow="OUR VRF SOLUTIONS" title={content.solutionsHeading} copy={content.solutionsIntro} />
            <div className={styles.solutionGrid}>
              {content.solutions.map((card, index) => (
                <article className={styles.solutionCard} key={card.id}>
                  <div className={styles.solutionArt}><OutdoorSystemArt variant={index} /></div>
                  <div className={styles.solutionText}><CardCopy card={card} /><a href="/contact?request=vrf" aria-label={`Discuss ${card.title}`}>→</a></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow="WHY CHOOSE VRF?" title={content.benefitsHeading} copy="VRF technology delivers superior comfort, efficiency and control — ideal for Aruba’s climate and modern buildings." />
            <div className={styles.benefitGrid}>
              {content.benefits.map((card, index) => <article className={styles.benefitCard} key={card.id}><span><LineIcon index={index} /></span><CardCopy card={card} /></article>)}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow="INDOOR UNIT OPTIONS" title={content.indoorHeading} copy={content.indoorIntro} />
            <div className={styles.indoorGrid}>
              {content.indoorUnits.map((card) => (
                <article className={styles.indoorCard} key={card.id}>
                  <div className={styles.indoorArtWrap}><img src={indoorUnitImages[card.id]} alt="" loading="lazy" /></div>
                  <CardCopy card={card} />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.applicationSection}`}>
          <div className={styles.container}>
            <SectionHead eyebrow="WHERE VRF WORKS BEST" title={content.applicationsHeading} />
            <div className={styles.applicationGrid}>
              {content.applications.map((card) => (
                <article className={styles.applicationCard} key={card.id}>
                  <div className={styles.applicationPhoto} style={{ backgroundImage: `url(${applicationImages[card.id] ?? applicationImages.office})` }} />
                  <div><CardCopy card={card} /></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow="HOW DEMAC DELIVERS VRF PROJECTS" title={content.processHeading} copy="A proven process. Exceptional results." />
            <div className={styles.processGrid}>
              {content.process.map((card, index) => (
                <article className={styles.processCard} key={card.id}>
                  <div className={styles.processNumber}>{index + 1}</div>
                  <span className={styles.processIcon}><LineIcon index={index + 1} /></span>
                  <CardCopy card={card} />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.serviceSection}`}>
          <div className={styles.container}>
            <SectionHead eyebrow="OUR SERVICE CAPABILITIES" title={content.servicesHeading} />
            <div className={styles.serviceGrid}>
              {content.services.map((card, index) => <article className={styles.serviceCard} key={card.id}><span><LineIcon index={index + 2} /></span><CardCopy card={card} /></article>)}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.trustSection}`}>
          <div className={`${styles.container} ${styles.trustGrid}`}>
            <div className={styles.trustCopy}>
              <span className={styles.eyebrow}>{content.trust.eyebrow}</span>
              <h2>{content.trust.title}</h2>
              <p>{content.trust.description}</p>
              <a className={styles.projectButton} href="/projects">Our Projects <span>→</span></a>
            </div>
            <div className={styles.trustPhoto} style={{ backgroundImage: `url(${trustImage})` }}><span>DEMAC</span></div>
            <div className={styles.trustBullets}>{content.trust.bullets.map((bullet) => <div key={bullet}><i>✓</i><span>{bullet}</span></div>)}</div>
            <blockquote className={styles.testimonial}><b>“</b><p>DEMAC delivered an exceptional VRF solution for our property. Professional, reliable and always available.</p><strong>Commercial Client</strong><span>Aruba</span></blockquote>
          </div>
        </section>

        <section className={`${styles.section} ${styles.faqSection}`}>
          <div className={styles.container}>
            <SectionHead eyebrow="FREQUENTLY ASKED QUESTIONS" title={content.faqHeading} />
            <div className={styles.faqGrid}>
              {content.faq.map((item) => <details className={styles.faqItem} key={item.id}><summary>{item.title}<span>+</span></summary><p>{item.description}</p></details>)}
            </div>
          </div>
        </section>

        <section className={styles.finalCta} style={{ backgroundImage: `linear-gradient(90deg,rgba(235,248,255,.95) 0%,rgba(235,248,255,.88) 46%,rgba(20,123,190,.18) 100%),url(${ctaBackground})` }}>
          <div className={styles.container}>
            <div className={styles.finalCtaInner}>
              <div><span>{content.finalCta.eyebrow}</span><h2>{content.finalCta.title}</h2><p>{content.finalCta.description}</p></div>
              <div><ActionLink link={content.finalCta.secondaryCta} tone="whatsapp" /><ActionLink link={content.finalCta.primaryCta} /></div>
            </div>
          </div>
        </section>
      </main>
    </PublicSiteShell>
  );
}
