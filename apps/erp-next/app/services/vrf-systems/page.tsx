import type { Metadata } from 'next';
import { PublicSiteShell } from '@/components/public/public-site-shell';
import { VrfMobileExperience } from '@/components/public/vrf-mobile-experience';
import { VrfIndoorPhoto } from '@/components/public/vrf-indoor-photo';
import indoorStyles from '@/components/public/vrf-indoor-photos.module.css';
import mobileStyles from '@/components/public/vrf-mobile-experience.module.css';
import { loadPublishedVrfContent } from '@/lib/public-vrf-public';
import type { VrfCard, VrfLink } from '@/lib/public-vrf-content';
import styles from './vrf-fidelity.module.css';

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

const DEFAULT_HERO_IMAGES = new Set([
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&fm=webp&q=88&w=2200',
  'https://images.unsplash.com/photo-1775629632806-165d644178c0?auto=format&fit=crop&fm=webp&q=88&w=2200',
  '/website/hero/hero-hospitality.webp',
]);

const DEFAULT_VRF_HERO = 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&fm=webp&q=90&w=2400';

const solutionImages = [
  {
    primary: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/user_690ccf1f4f20635046a259c9/e52f5393d_Tropicalrooftopwithmodernequipment1.png',
    fallback: '/website/vrf/large-vrf-aruba.jpg',
  },
  {
    primary: 'https://cdn1.npcdn.net/images/5960ee38ad7354220701bc5d1f0a886e_1772521105.webp?from=jpeg&md5id=d41ca4d10ddfea76d016acbfded20618&new_height=1000&new_width=1000&size=max&type=9&w=-62170008925',
    fallback: '/website/vrf/modular-vrf-aruba.jpg',
  },
  {
    primary: 'https://static.wixstatic.com/media/ba87af_d796787b6c0f440d9036b324b812071b~mv2.jpg/v1/fill/w_632%2Ch_632%2Cal_c%2Cq_85%2Cenc_avif%2Cquality_auto/ba87af_d796787b6c0f440d9036b324b812071b~mv2.jpg',
    fallback: '/website/vrf/mini-vrf-aruba.jpg',
  },
] as const;

const applicationImages: Record<string, string> = {
  apartments: 'https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?auto=format&fit=crop&fm=webp&q=88&w=1200',
  hospitality: 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&fm=webp&q=88&w=1200',
  office: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&fm=webp&q=88&w=1200',
  retail: 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&fm=webp&q=88&w=1200',
  villas: 'https://images.unsplash.com/photo-1600047509807-ba8f99d2cdde?auto=format&fit=crop&fm=webp&q=88&w=1200',
  controlled: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&fm=webp&q=88&w=1200',
};

const trustImageFallback = 'https://skipcalls.com/aeo/hvac/hvac-first-hot-day-my-phone-blows-up-with-no-cool-calls.webp';
const ctaBackground = 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&fm=webp&q=88&w=2400';

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
  const source = solutionImages[variant] ?? solutionImages[0];
  return (
    <div
      aria-hidden="true"
      style={{
        display: 'block',
        width: '100%',
        height: '100%',
        minHeight: 170,
        borderRadius: 8,
        backgroundImage: `url("${source.primary}"), url("${source.fallback}")`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat',
      }}
    />
  );
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
  const usesDefaultHero = DEFAULT_HERO_IMAGES.has(content.hero.imageUrl);
  const heroImage = usesDefaultHero ? DEFAULT_VRF_HERO : content.hero.imageUrl;
  const heroPosition = usesDefaultHero ? '74% center' : content.hero.imagePosition;
  const trustImage = content.trust.imageUrl.includes('photo-1621905251189-08b45d6a269e') ? trustImageFallback : content.trust.imageUrl;

  return (
    <div className={`${mobileStyles.route} ${indoorStyles.scope}`}>
    <PublicSiteShell active="services">
      <VrfMobileExperience content={content} heroImage={heroImage} heroPosition={heroPosition} solutionImages={solutionImages} applicationImages={applicationImages} trustImage={trustImage} indoorArt={content.indoorUnits.map((card) => <VrfIndoorPhoto key={card.id} card={card} />)} />
      <div className={mobileStyles.desktop} data-vrf-desktop>
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroMedia} aria-hidden="true">
            <div className={styles.heroImage} style={{ backgroundImage: `url(${heroImage})`, backgroundPosition: heroPosition }} />
            <div className={styles.heroWash} />
          </div>
          <div className={styles.heroInner}>
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

        <section className={styles.section} id="indoor-unit-options">
          <div className={styles.container}>
            <SectionHead eyebrow="INDOOR UNIT OPTIONS" title={content.indoorHeading} copy={content.indoorIntro} />
            <div className={`${styles.indoorGrid} ${indoorStyles.catalogGrid}`} data-vrf-indoor-grid>
              {content.indoorUnits.map((card) => (
                <article className={styles.indoorCard} key={card.id}>
                  <div className={styles.indoorArtWrap}><VrfIndoorPhoto card={card} /></div>
                  <div className={styles.indoorBody}><CardCopy card={card} /></div>
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
                  <div className={styles.applicationBody}><CardCopy card={card} /></div>
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
            <div className={styles.faqHeadingRow}><SectionHead eyebrow="FREQUENTLY ASKED QUESTIONS" title={content.faqHeading} /><a href="/contact">Still have questions? <strong>Contact our team →</strong></a></div>
            <div className={styles.faqGrid}>
              {content.faq.map((item) => <details className={styles.faqItem} key={item.id}><summary>{item.title}<span>+</span></summary><p>{item.description}</p></details>)}
            </div>
          </div>
        </section>

        <section className={styles.finalCta} style={{ backgroundImage: `linear-gradient(90deg,rgba(235,248,255,.96),rgba(220,245,255,.77),rgba(185,234,255,.58)),url(${ctaBackground})` }}>
          <div className={styles.container}>
            <div className={styles.finalCtaInner}>
              <div><span>{content.finalCta.eyebrow}</span><h2>{content.finalCta.title}</h2><p>{content.finalCta.description}</p></div>
              <div><ActionLink link={content.finalCta.secondaryCta} tone="whatsapp" /><ActionLink link={content.finalCta.primaryCta} /></div>
            </div>
          </div>
        </section>
      </main>
      </div>
    </PublicSiteShell>
    </div>
  );
}
