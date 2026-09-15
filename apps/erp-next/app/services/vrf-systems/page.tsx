import type { Metadata } from 'next';
import { PublicSiteShell } from '@/components/public/public-site-shell';
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
  '/website/vrf/large-vrf-aruba.webp',
  '/website/vrf/modular-vrf-aruba.webp',
  '/website/vrf/mini-vrf-aruba.webp',
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
    <img
      src={source}
      alt=""
      loading="lazy"
      width={480}
      height={429}
      style={{ display: 'block', width: '100%', height: '100%', minHeight: 170, objectFit: 'cover', objectPosition: 'center', borderRadius: 8 }}
    />
  );
}

function IndoorUnitArt({ id }: { id: string }) {
  const shell = `unit-shell-${id}`;
  const shade = `unit-shade-${id}`;
  return (
    <svg className={styles.indoorSvg} viewBox="0 0 220 120" role="img" aria-label="">
      <defs>
        <linearGradient id={shell} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.62" stopColor="#edf2f5" />
          <stop offset="1" stopColor="#c7d3db" />
        </linearGradient>
        <linearGradient id={shade} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#aab9c3" />
          <stop offset="1" stopColor="#6f8490" />
        </linearGradient>
        <filter id={`shadow-${id}`} x="-30%" y="-40%" width="160%" height="190%">
          <feDropShadow dx="0" dy="8" stdDeviation="6" floodColor="#173858" floodOpacity="0.18" />
        </filter>
      </defs>
      <g filter={`url(#shadow-${id})`}>
        {id === 'cassette' ? <>
          <path d="M47 38 112 20l61 20-65 21Z" fill={`url(#${shell})`} stroke="#b8c7d0" />
          <path d="M47 38v30l61 22V61Z" fill="#dce5ea" stroke="#b8c7d0" />
          <path d="M173 40v29l-65 21V61Z" fill="#eef3f6" stroke="#b8c7d0" />
          <ellipse cx="111" cy="43" rx="23" ry="10" fill="#c5d2d9" stroke="#93a6b1" />
          <ellipse cx="111" cy="43" rx="14" ry="6" fill="#edf4f7" stroke="#93a6b1" />
          <path d="M60 39 103 28M162 40l-43-11M61 64l42 15M160 64l-42 15" stroke="#8da2ad" strokeWidth="3" strokeLinecap="round" />
        </> : null}
        {id === 'fan-coil' ? <>
          <rect x="34" y="31" width="152" height="52" rx="5" fill={`url(#${shade})`} stroke="#657b88" />
          <rect x="43" y="40" width="134" height="32" rx="3" fill="#263f4d" />
          {Array.from({ length: 15 }).map((_, index) => <line key={index} x1={49 + index * 8.4} x2={49 + index * 8.4} y1="43" y2="69" stroke="#6f8793" strokeWidth="2" />)}
          <rect x="52" y="21" width="27" height="11" rx="3" fill="#dbe5e9" stroke="#a9b8c0" />
          <rect x="141" y="21" width="27" height="11" rx="3" fill="#dbe5e9" stroke="#a9b8c0" />
        </> : null}
        {id === 'floor-ceiling' ? <>
          <rect x="31" y="35" width="158" height="46" rx="7" fill={`url(#${shell})`} stroke="#b7c6ce" />
          <path d="M45 68h130" stroke="#8ca0aa" strokeWidth="5" strokeLinecap="round" />
          <path d="M46 54h98" stroke="#d0dbe0" strokeWidth="2" />
          <circle cx="172" cy="48" r="3" fill="#7d929e" />
        </> : null}
        {id === 'air-handler' ? <>
          <rect x="29" y="27" width="162" height="62" rx="4" fill={`url(#${shell})`} stroke="#a6b8c2" />
          <line x1="78" x2="78" y1="27" y2="89" stroke="#9fb1bb" />
          <line x1="139" x2="139" y1="27" y2="89" stroke="#9fb1bb" />
          <rect x="38" y="37" width="30" height="42" rx="3" fill="#d3dde2" stroke="#a0b2bc" />
          <circle cx="108" cy="58" r="20" fill="#d9e3e8" stroke="#98abb6" />
          <circle cx="108" cy="58" r="8" fill="#a5b6bf" />
          <path d="M150 41h29M150 51h29M150 61h29M150 71h29" stroke="#98abb6" strokeWidth="2" />
        </> : null}
        {id === 'split-unit' ? <>
          <path d="M38 43c0-7 6-12 13-12h118c7 0 13 5 13 12v31H38Z" fill={`url(#${shell})`} stroke="#b8c7d0" />
          <path d="M49 63h122" stroke="#8fa3ad" strokeWidth="4" strokeLinecap="round" />
          <path d="M57 49h65" stroke="#d9e2e6" strokeWidth="2" />
          <circle cx="165" cy="47" r="3" fill="#7f98a5" />
        </> : null}
        {id === 'wall-mounted' ? <>
          <path d="M35 37c0-7 6-12 13-12h124c7 0 13 5 13 12l-5 38c-1 6-6 10-12 10H52c-6 0-11-4-12-10Z" fill={`url(#${shell})`} stroke="#b8c7d0" />
          <path d="M49 67c35 8 87 8 122 0" stroke="#8ea2ad" strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M54 44h72" stroke="#d6e1e6" strokeWidth="2" />
          <circle cx="166" cy="44" r="3" fill="#7e96a3" />
        </> : null}
      </g>
    </svg>
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
    <PublicSiteShell active="services">
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

        <section className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow="INDOOR UNIT OPTIONS" title={content.indoorHeading} copy={content.indoorIntro} />
            <div className={styles.indoorGrid}>
              {content.indoorUnits.map((card) => (
                <article className={styles.indoorCard} key={card.id}>
                  <div className={styles.indoorArtWrap}><IndoorUnitArt id={card.id} /></div>
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
    </PublicSiteShell>
  );
}
