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

const applicationImages: Record<string, string> = {
  apartments: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&fm=webp&q=82&w=900',
  hospitality: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&fm=webp&q=82&w=900',
  office: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&fm=webp&q=82&w=900',
  retail: 'https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&fm=webp&q=82&w=900',
  villas: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&fm=webp&q=82&w=900',
  controlled: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&fm=webp&q=82&w=900',
};

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

function OutdoorSystemArt({ variant }: { variant: number }) {
  const count = variant === 0 ? 3 : variant === 1 ? 2 : 1;
  return (
    <div className={styles.outdoorArt} aria-hidden="true">
      {Array.from({ length: count }).map((_, index) => (
        <span className={styles.outdoorCabinet} key={index}>
          <i className={styles.fan}><b /></i><em>DEMAC</em>
        </span>
      ))}
    </div>
  );
}

function IndoorUnitArt({ id }: { id: string }) {
  if (id === 'cassette') return <div className={`${styles.unitArt} ${styles.cassette}`}><span /><i /><i /><i /><i /></div>;
  if (id === 'fan-coil') return <div className={`${styles.unitArt} ${styles.fanCoil}`}><span /><span /><span /></div>;
  if (id === 'floor-ceiling') return <div className={`${styles.unitArt} ${styles.floorCeiling}`}><i /><span /></div>;
  if (id === 'air-handler') return <div className={`${styles.unitArt} ${styles.airHandler}`}><span /><span /><span /></div>;
  if (id === 'split-unit') return <div className={`${styles.unitArt} ${styles.splitUnit}`}><i /><span /></div>;
  return <div className={`${styles.unitArt} ${styles.wallMounted}`}><i /><span /></div>;
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

  return (
    <PublicSiteShell active="services">
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroBackdrop} />
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
                    <div key={item}><span><LineIcon index={index} /></span><b>{item}</b></div>
                  ))}
                </div>
              </div>

              <div className={styles.heroVisual}>
                <div className={styles.heroPhoto} style={{ backgroundImage: `url(${content.hero.imageUrl})`, backgroundPosition: content.hero.imagePosition }} />
                <div className={styles.heroPhotoWash} />
                <svg className={styles.zoneNetwork} viewBox="0 0 760 520" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M465 444V104M465 142H590M465 220H618M465 302H565M465 378H615" />
                  {[['465','142'],['590','142'],['465','220'],['618','220'],['465','302'],['565','302'],['465','378'],['615','378']].map(([cx,cy]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" />)}
                </svg>
                <div className={`${styles.zoneChip} ${styles.zoneOne}`}><b>Cassette</b><span>Office · 22°C</span></div>
                <div className={`${styles.zoneChip} ${styles.zoneTwo}`}><b>Fan Coil</b><span>Hotel Room · 23°C</span></div>
                <div className={`${styles.zoneChip} ${styles.zoneThree}`}><b>Wall Mounted</b><span>Apartment · 24°C</span></div>
                <div className={styles.heroOutdoor}><OutdoorSystemArt variant={1} /></div>
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
            <SectionHead eyebrow="WHY CHOOSE VRF?" title={content.benefitsHeading} copy="VRF technology delivers precise comfort, efficiency and control — ideal for Aruba’s climate and modern buildings." />
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
                  <div className={styles.indoorArtWrap}><IndoorUnitArt id={card.id} /></div>
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
                  <div className={styles.applicationPhoto} style={{ backgroundImage: `linear-gradient(180deg, transparent 42%, rgba(3,32,79,.72)), url(${applicationImages[card.id] ?? applicationImages.office})` }} />
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
            <div className={styles.trustPhoto} style={{ backgroundImage: `linear-gradient(110deg, rgba(3,37,88,.02), rgba(3,37,88,.12)), url(${content.trust.imageUrl})` }}><span>DEMAC</span></div>
            <div className={styles.trustBullets}>{content.trust.bullets.map((bullet) => <div key={bullet}><i>✓</i><span>{bullet}</span></div>)}</div>
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

        <section className={styles.finalCta}>
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
