'use client';
import { PublicSiteShell } from '@/components/public/public-site-shell';
import { VrfMobileExperience } from '@/components/public/vrf-mobile-experience';
import { VrfIndoorPhoto } from '@/components/public/vrf-indoor-photo';
import indoorStyles from '@/components/public/vrf-indoor-photos.module.css';
import mobileStyles from '@/components/public/vrf-mobile-experience.module.css';
import { defaultPublicVrfContent, type PublicVrfContent, type VrfCard, type VrfLink } from '@/lib/public-vrf-content';
import styles from '@/app/services/vrf-systems/vrf-fidelity.module.css';


const solutionImages = defaultPublicVrfContent.solutions.map((card) => ({ primary: card.imageUrl || '', fallback: `/website/vrf/${card.id}-aruba.jpg` }));
const applicationImages = Object.fromEntries(defaultPublicVrfContent.applications.map((card) => [card.id, card.imageUrl || '']));

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

function OutdoorSystemArt({ variant = 0, card }: { variant?: number; card: VrfCard }) {
  const source = { ...(solutionImages[variant] ?? solutionImages[0]), primary: card.imageUrl || (solutionImages[variant] ?? solutionImages[0]).primary };
  return (
    <div
      aria-hidden="true"
      data-website-image={`solutions.${card.id}.imageUrl`}
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

function SectionHead({ eyebrow, title, copy, titleField, copyField, eyebrowField }: { eyebrow: string; title: string; copy?: string; titleField?: string; copyField?: string; eyebrowField?: string }) {
  return (
    <div className={styles.sectionHead}>
      <div><span className={styles.eyebrow} data-website-text={eyebrowField}>{eyebrow}</span><h2 data-website-text={titleField}>{title}</h2></div>
      {copy ? <p data-website-text={copyField}>{copy}</p> : null}
    </div>
  );
}

function CardCopy({ card, group }: { card: VrfCard; group: string }) {
  return <><h3 data-website-text={`${group}.${card.id}.title`}>{card.title}</h3><p data-website-text={`${group}.${card.id}.description`}>{card.description}</p>{card.detail ? <small data-website-text={`${group}.${card.id}.detail`}>{card.detail}</small> : null}</>;
}

export function VrfPageView({ content }: { content: PublicVrfContent }) {
  const heroImage = content.hero.imageUrl;
  const heroPosition = content.hero.imagePosition;
  const trustImage = content.trust.imageUrl;

  return (
    <div className={`${mobileStyles.route} ${indoorStyles.scope}`}>
    <PublicSiteShell active="services">
      <VrfMobileExperience content={content} heroImage={heroImage} heroPosition={content.hero.mobileImagePosition || heroPosition} solutionImages={content.solutions.map((card, i) => ({ ...solutionImages[i], primary: card.imageUrl || solutionImages[i].primary }))} applicationImages={Object.fromEntries(content.applications.map((card) => [card.id, card.imageUrl || applicationImages[card.id] || applicationImages.office]))} trustImage={trustImage} indoorArt={content.indoorUnits.map((card) => <VrfIndoorPhoto key={card.id} card={card} />)} />
      <div className={mobileStyles.desktop} data-vrf-desktop>
      <main className={styles.page}>
        <section className={styles.hero} data-website-image="hero.imageUrl">
          <div className={styles.heroMedia} aria-hidden="true">
            <div className={styles.heroImage} style={{ backgroundImage: `url(${heroImage})`, backgroundPosition: heroPosition }} />
            <div className={styles.heroWash} />
          </div>
          <div className={styles.heroInner}>
            <div className={styles.heroCopy}>
              <span className={styles.eyebrow} data-website-text="hero.eyebrow">{content.hero.eyebrow}</span>
              <h1><span data-website-text="hero.title">{content.hero.title}</span> <strong data-website-text="hero.accent">{content.hero.accent}</strong></h1>
              <p data-website-text="hero.description">{content.hero.description}</p>
              <div className={styles.heroActions}>
                <ActionLink link={content.hero.secondaryCta} tone="whatsapp" />
                <ActionLink link={content.hero.primaryCta} />
              </div>
              <div className={styles.heroProof}>
                {[content.editorial.proof1, content.editorial.proof2, content.editorial.proof3, content.editorial.proof4].map((item, index) => (
                  <div key={item}><span><LineIcon index={index + 1} /></span><b data-website-text={`editorial.proof${index + 1}`}>{item}</b></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.solutionsSection}`}>
          <div className={styles.container}>
            <SectionHead eyebrow={content.editorial.systemsEyebrow} eyebrowField="editorial.systemsEyebrow" title={content.solutionsHeading} titleField="solutionsHeading" copy={content.solutionsIntro} copyField="solutionsIntro" />
            <div className={styles.solutionGrid}>
              {content.solutions.map((card, index) => (
                <article className={styles.solutionCard} key={card.id}>
                  <div className={styles.solutionArt}><OutdoorSystemArt variant={index} card={card} /></div>
                  <div className={styles.solutionText}><CardCopy card={card} group="solutions" /><a href="/contact?request=vrf" aria-label={`Discuss ${card.title}`}>→</a></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow={content.editorial.benefitsEyebrow} eyebrowField="editorial.benefitsEyebrow" title={content.benefitsHeading} titleField="benefitsHeading" copy={content.editorial.benefitsIntro} copyField="editorial.benefitsIntro" />
            <div className={styles.benefitGrid}>
              {content.benefits.map((card, index) => <article className={styles.benefitCard} key={card.id}><span><LineIcon index={index} /></span><CardCopy card={card} group="benefits" /></article>)}
            </div>
          </div>
        </section>

        <section className={styles.section} id="indoor-unit-options">
          <div className={styles.container}>
            <SectionHead eyebrow={content.editorial.indoorsEyebrow} eyebrowField="editorial.indoorsEyebrow" title={content.indoorHeading} titleField="indoorHeading" copy={content.indoorIntro} copyField="indoorIntro" />
            <div className={`${styles.indoorGrid} ${indoorStyles.catalogGrid}`} data-vrf-indoor-grid>
              {content.indoorUnits.map((card) => (
                <article className={styles.indoorCard} key={card.id}>
                  <div className={styles.indoorArtWrap}><VrfIndoorPhoto card={card} /></div>
                  <div className={styles.indoorBody}><CardCopy card={card} group="indoorUnits" /></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.applicationSection}`}>
          <div className={styles.container}>
            <SectionHead eyebrow={content.editorial.buildingsEyebrow} eyebrowField="editorial.buildingsEyebrow" title={content.applicationsHeading} titleField="applicationsHeading" />
            <div className={styles.applicationGrid}>
              {content.applications.map((card) => (
                <article className={styles.applicationCard} key={card.id}>
                  <div className={styles.applicationPhoto} data-website-image={`applications.${card.id}.imageUrl`} style={{ backgroundImage: `url("${card.imageUrl || applicationImages[card.id] || applicationImages.office}")` }} />
                  <div className={styles.applicationBody}><CardCopy card={card} group="applications" /></div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <div className={styles.container}>
            <SectionHead eyebrow={content.editorial.processEyebrow} eyebrowField="editorial.processEyebrow" title={content.processHeading} titleField="processHeading" copy={content.editorial.processIntro} copyField="editorial.processIntro" />
            <div className={styles.processGrid}>
              {content.process.map((card, index) => (
                <article className={styles.processCard} key={card.id}>
                  <div className={styles.processNumber}>{index + 1}</div>
                  <span className={styles.processIcon}><LineIcon index={index + 1} /></span>
                  <CardCopy card={card} group="process" />
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.serviceSection}`}>
          <div className={styles.container}>
            <SectionHead eyebrow={content.editorial.servicesEyebrow} eyebrowField="editorial.servicesEyebrow" title={content.servicesHeading} titleField="servicesHeading" />
            <div className={styles.serviceGrid}>
              {content.services.map((card, index) => <article className={styles.serviceCard} key={card.id}><span><LineIcon index={index + 2} /></span><CardCopy card={card} group="services" /></article>)}
            </div>
          </div>
        </section>

        <section className={`${styles.section} ${styles.trustSection}`}>
          <div className={`${styles.container} ${styles.trustGrid}`}>
            <div className={styles.trustCopy}>
              <span className={styles.eyebrow} data-website-text="trust.eyebrow">{content.trust.eyebrow}</span>
              <h2 data-website-text="trust.title">{content.trust.title}</h2>
              <p data-website-text="trust.description">{content.trust.description}</p>
              <a className={styles.projectButton} href="/projects">Our Projects <span>→</span></a>
            </div>
            <div className={styles.trustPhoto} data-website-image="trust.imageUrl" style={{ backgroundImage: `url(${trustImage})` }}><span>DEMAC</span></div>
            <div className={styles.trustBullets}>{content.trust.bullets.map((bullet, index) => <div key={index}><i>✓</i><span data-website-text={`trust.bullets.${index}`}>{bullet}</span></div>)}</div>
            <blockquote className={styles.testimonial}><b>“</b><p data-website-text="editorial.testimonialText">{content.editorial.testimonialText}</p><strong data-website-text="editorial.testimonialAuthor">{content.editorial.testimonialAuthor}</strong><span data-website-text="editorial.testimonialLocation">{content.editorial.testimonialLocation}</span></blockquote>
          </div>
        </section>

        <section className={`${styles.section} ${styles.faqSection}`}>
          <div className={styles.container}>
            <div className={styles.faqHeadingRow}><SectionHead eyebrow={content.editorial.faqEyebrow} eyebrowField="editorial.faqEyebrow" title={content.faqHeading} titleField="faqHeading" /><a href="/contact">Still have questions? <strong>Contact our team →</strong></a></div>
            <div className={styles.faqGrid}>
              {content.faq.map((item) => <details className={styles.faqItem} key={item.id}><summary><span data-website-text={`faq.${item.id}.title`}>{item.title}</span><span>+</span></summary><p data-website-text={`faq.${item.id}.description`}>{item.description}</p></details>)}
            </div>
          </div>
        </section>

        <section className={styles.finalCta} data-website-image="finalCta.imageUrl" style={{ backgroundImage: `linear-gradient(90deg,rgba(235,248,255,.96),rgba(220,245,255,.77),rgba(185,234,255,.58)),url("${content.finalCta.imageUrl}")` }}>
          <div className={styles.container}>
            <div className={styles.finalCtaInner}>
              <div><span data-website-text="finalCta.eyebrow">{content.finalCta.eyebrow}</span><h2 data-website-text="finalCta.title">{content.finalCta.title}</h2><p data-website-text="finalCta.description">{content.finalCta.description}</p></div>
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
