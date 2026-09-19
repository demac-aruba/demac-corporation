'use client';

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { PublicVrfContent, VrfLink } from '@/lib/public-vrf-content';
import styles from './vrf-mobile-experience.module.css';

type SolutionImage = { readonly primary: string; readonly fallback: string };
type Props = {
  content: PublicVrfContent;
  heroImage: string;
  heroPosition: string;
  solutionImages: readonly SolutionImage[];
  applicationImages: Record<string, string>;
  trustImage: string;
  indoorArt: ReactNode[];
};

const sections = [
  ['vrf-mobile-systems', 'Systems'],
  ['vrf-mobile-indoors', 'Indoor units'],
  ['vrf-mobile-buildings', 'Buildings'],
  ['vrf-mobile-services', 'Services'],
  ['vrf-mobile-faq', 'FAQ'],
] as const;

function Icon({ kind = 0 }: { kind?: number }) {
  const paths = [
    'M3 10 12 3l9 7M5 9v12h14V9M9 21v-7h6v7',
    'M20 4C9 4 4 10 7 16s13 4 13-12ZM4 21l11-11',
    'M4 5h16v14H4ZM4 10h16M10 10v9',
    'M3 8h13l-3-3m3 3-3 3M21 16H8l3-3m-3 3 3 3',
    'M3 5h18v13H3ZM8 22h8M12 18v4M7 9h2m3 0h5M7 13h10',
    'M4 9v6h4l5 4V5L8 9ZM17 8c3 2 3 6 0 8',
  ];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[kind % paths.length]} /></svg>;
}

function Action({ link, whatsapp = false }: { link: VrfLink; whatsapp?: boolean }) {
  return <a className={whatsapp ? styles.whatsapp : styles.primary} href={link.href}>
    {whatsapp ? <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.66 15L2 22l5.15-1.35A10 10 0 1 0 12 2Zm0 18a8 8 0 0 1-4.09-1.12l-.29-.17-3.05.8.81-2.97-.19-.3A8 8 0 1 1 12 20Zm4.39-5.99c-.24-.12-1.41-.7-1.63-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06a6.52 6.52 0 0 1-1.92-1.19 7.21 7.21 0 0 1-1.33-1.65c-.14-.24-.01-.37.11-.49.11-.1.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.41-.54-.42h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.69 2.58 4.1 3.62.57.25 1.02.4 1.37.51.58.18 1.1.16 1.51.1.46-.07 1.41-.58 1.61-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z" /></svg> : null}
    <span>{link.label}</span><span aria-hidden="true">↗</span>
  </a>;
}

function Heading({ eyebrow, title, children, titleField, eyebrowField }: { eyebrow: string; title: string; children?: ReactNode; titleField?: string; eyebrowField?: string }) {
  return <header className={styles.heading}><span className={styles.eyebrow} data-website-text={eyebrowField}>{eyebrow}</span><h2 data-website-text={titleField}>{title}</h2>{children}</header>;
}

// Reuse the approved desktop image sources; do not replace Website Manager data.
function Photo({ primary, fallback, label, className = '', fieldKey }: SolutionImage & { label: string; className?: string; fieldKey?: string }) {
  return <div role="img" data-website-image={fieldKey} aria-label={label} className={`${styles.photo} ${className}`} style={{ backgroundImage: `url("${primary}"), url("${fallback}")` }} />;
}

function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number, count: number, choose: (index: number) => void) {
  const next = event.key === 'ArrowRight' ? (index + 1) % count
    : event.key === 'ArrowLeft' ? (index + count - 1) % count
    : event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : null;
  if (next === null) return;
  event.preventDefault();
  choose(next);
  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
}

export function VrfMobileExperience({ content, heroImage, heroPosition, solutionImages, applicationImages, trustImage, indoorArt }: Props) {
  const [systemIndex, setSystemIndex] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [activeSection, setActiveSection] = useState<string>(sections[0][0]);
  const [showActions, setShowActions] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLElement>(null);
  const endRef = useRef<HTMLElement>(null);
  const buildingsRef = useRef<HTMLDivElement>(null);
  const currentSystem = Math.min(systemIndex, Math.max(0, content.solutions.length - 1));
  const currentStep = Math.min(stepIndex, Math.max(0, content.process.length - 1));

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window)) return;
    const media = window.matchMedia('(max-width: 767px)');
    let cleanup = () => {};
    const attach = () => {
      cleanup();
      if (!media.matches) { setShowActions(false); return; }
      const hero = heroRef.current;
      const end = endRef.current;
      if (!hero || !end) return;
      let heroVisible = true;
      let contactVisible = false;
      const actionsObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (entry.target === hero) heroVisible = entry.isIntersecting;
          if (entry.target === end) contactVisible = entry.isIntersecting;
        }
        const passedContact = end.getBoundingClientRect().top < window.innerHeight;
        setShowActions(!heroVisible && !contactVisible && !passedContact);
      });
      actionsObserver.observe(hero);
      actionsObserver.observe(end);
      const navObserver = new IntersectionObserver((entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) setActiveSection(visible[visible.length - 1].target.id);
      }, { rootMargin: '-80px 0px -55% 0px', threshold: 0 });
      for (const [id] of sections) {
        const section = root.querySelector(`#${id}`);
        if (section) navObserver.observe(section);
      }
      cleanup = () => { actionsObserver.disconnect(); navObserver.disconnect(); };
    };
    attach();
    media.addEventListener('change', attach);
    return () => { cleanup(); media.removeEventListener('change', attach); };
  }, []);

  function moveBuildings(direction: number) {
    const rail = buildingsRef.current;
    if (!rail) return;
    const card = rail.firstElementChild as HTMLElement | null;
    const distance = (card?.getBoundingClientRect().width ?? rail.clientWidth * .78) + 12;
    rail.scrollBy({ left: direction * distance, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  return <div className={styles.mobile} ref={rootRef} data-vrf-mobile>
    <section className={styles.hero} ref={heroRef} aria-labelledby="vrf-mobile-title">
      <div className={styles.heroCopy}>
        <span className={styles.eyebrow} data-website-text="hero.eyebrow">{content.hero.eyebrow}</span>
        <h1 id="vrf-mobile-title"><span data-website-text="hero.title">{content.hero.title}</span> <strong data-website-text="hero.accent">{content.hero.accent}</strong></h1>
        <p data-website-text="hero.description">{content.hero.description}</p>
        <div className={styles.actions}><Action link={content.hero.secondaryCta} whatsapp /><Action link={content.hero.primaryCta} /></div>
      </div>
      <div className={styles.heroImage} data-website-image="hero.imageUrl" role="img" aria-label="Building exterior" style={{ backgroundImage: `url("${heroImage}")`, backgroundPosition: heroPosition }} />
    </section>

    <nav className={styles.sectionNav} aria-label="Explore VRF solutions">
      {sections.map(([id, label]) => <a key={id} href={`#${id}`} aria-current={activeSection === id ? 'location' : undefined} onClick={() => setActiveSection(id)}>{label}</a>)}
    </nav>

    <section id="vrf-mobile-systems" className={styles.section}>
      <Heading eyebrow={content.editorial.systemsEyebrow} eyebrowField="editorial.systemsEyebrow" title={content.solutionsHeading} titleField="solutionsHeading"><p data-website-text="solutionsIntro">{content.solutionsIntro}</p></Heading>
      <div className={styles.systemTabs} role="tablist" aria-label="Choose your VRF system">
        {content.solutions.map((card, index) => <button key={card.id} id={`vrf-system-tab-${index}`} type="button" role="tab" aria-selected={currentSystem === index} aria-controls={`vrf-system-panel-${index}`} tabIndex={currentSystem === index ? 0 : -1} onClick={() => setSystemIndex(index)} onKeyDown={(event) => moveTab(event, index, content.solutions.length, setSystemIndex)}>{card.title.replace(/\s+Systems?$/i, '')}</button>)}
      </div>
      {content.solutions.map((card, index) => <div key={card.id} id={`vrf-system-panel-${index}`} role="tabpanel" aria-labelledby={`vrf-system-tab-${index}`} hidden={currentSystem !== index} className={styles.systemPanel} tabIndex={0}>
        <Photo {...(solutionImages[index] ?? solutionImages[0])} label={`${card.title} equipment`} className={styles.systemPhoto} fieldKey={`solutions.${card.id}.imageUrl`} />
        <div className={styles.systemBody}>
          <div className={styles.systemTitle}><h3 data-website-text={`solutions.${card.id}.title`}>{card.title}</h3><span>{String(index + 1).padStart(2, '0')} / {String(content.solutions.length).padStart(2, '0')}</span></div>
          <p data-website-text={`solutions.${card.id}.description`}>{card.description}</p>
          {card.detail ? <p className={styles.ideal} data-website-text={`solutions.${card.id}.detail`}>{card.detail}</p> : null}
          <a href={content.hero.primaryCta.href} className={styles.textLink}>Discuss this system <span aria-hidden="true">↗</span></a>
        </div>
      </div>)}
    </section>

    <section className={`${styles.section} ${styles.benefits}`}>
      <Heading eyebrow={content.editorial.benefitsEyebrow} eyebrowField="editorial.benefitsEyebrow" title={content.benefitsHeading} titleField="benefitsHeading" />
      <div className={styles.benefitGrid}>{content.benefits.map((card, index) => <article key={card.id} className={styles.benefitCard}><span className={styles.icon}><Icon kind={index} /></span><h3 data-website-text={`benefits.${card.id}.title`}>{card.title}</h3><p data-website-text={`benefits.${card.id}.description`}>{card.description}</p></article>)}</div>
    </section>

    <section id="vrf-mobile-indoors" className={styles.section}>
      <Heading eyebrow={content.editorial.indoorsEyebrow} eyebrowField="editorial.indoorsEyebrow" title={content.indoorHeading} titleField="indoorHeading"><p data-website-text="indoorIntro">{content.indoorIntro}</p></Heading>
      <div className={styles.unitGrid}>{content.indoorUnits.map((card, index) => <details key={card.id} className={styles.unitCard}>
        <summary><span className={styles.unitArt}>{indoorArt[index]}</span><span className={styles.unitTitle} data-website-text={`indoorUnits.${card.id}.title`}>{card.title}<span aria-hidden="true">+</span></span><span className={styles.unitHint}>Explore this unit</span></summary>
        <div className={styles.unitDetails}><p data-website-text={`indoorUnits.${card.id}.description`}>{card.description}</p>{card.detail ? <small data-website-text={`indoorUnits.${card.id}.detail`}>{card.detail}</small> : null}</div>
      </details>)}</div>
    </section>

    <section id="vrf-mobile-buildings" className={`${styles.section} ${styles.buildings}`}>
      <Heading eyebrow={content.editorial.buildingsEyebrow} eyebrowField="editorial.buildingsEyebrow" title={content.applicationsHeading} titleField="applicationsHeading" />
      <div className={styles.railHeading}><span>Swipe to explore <span aria-hidden="true">↔</span></span><div><button type="button" aria-label="Previous building types" aria-controls="vrf-building-rail" onClick={() => moveBuildings(-1)}>←</button><button type="button" aria-label="Next building types" aria-controls="vrf-building-rail" onClick={() => moveBuildings(1)}>→</button></div></div>
      <div id="vrf-building-rail" ref={buildingsRef} className={styles.buildingRail} tabIndex={0} aria-label="Building types, scroll horizontally">
        {content.applications.map((card, index) => <article className={styles.buildingCard} key={card.id}>
          <div className={styles.buildingPhoto} data-website-image={`applications.${card.id}.imageUrl`} role="img" aria-label={card.title} style={{ backgroundImage: `url("${applicationImages[card.id] ?? applicationImages.office}")` }} />
          <div><span className={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</span><h3 data-website-text={`applications.${card.id}.title`}>{card.title}</h3><p data-website-text={`applications.${card.id}.description`}>{card.description}</p></div>
        </article>)}
      </div>
    </section>

    <section className={styles.section}>
      <Heading eyebrow={content.editorial.processMobileEyebrow} eyebrowField="editorial.processMobileEyebrow" title={content.processHeading} titleField="processHeading" />
      <div className={styles.processBox}>
        <div className={styles.steps} role="tablist" aria-label="Explore the project process">
          {content.process.map((card, index) => <button key={card.id} type="button" id={`vrf-step-tab-${index}`} role="tab" aria-label={`Step ${index + 1}: ${card.title}`} aria-selected={currentStep === index} aria-controls={`vrf-step-panel-${index}`} tabIndex={currentStep === index ? 0 : -1} onClick={() => setStepIndex(index)} onKeyDown={(event) => moveTab(event, index, content.process.length, setStepIndex)}>{String(index + 1).padStart(2, '0')}</button>)}
        </div>
        {content.process.map((card, index) => <div key={card.id} id={`vrf-step-panel-${index}`} role="tabpanel" aria-labelledby={`vrf-step-tab-${index}`} hidden={currentStep !== index} className={styles.stepPanel} tabIndex={0}><span className={styles.icon}><Icon kind={index + 2} /></span><h3 data-website-text={`process.${card.id}.title`}>{card.title}</h3><p data-website-text={`process.${card.id}.description`}>{card.description}</p></div>)}
        <div className={styles.stepFooter}><span>Step {currentStep + 1} of {content.process.length}</span><button type="button" onClick={() => setStepIndex((currentStep + 1) % content.process.length)}>{currentStep === content.process.length - 1 ? 'Back to start' : 'Next step'} <span aria-hidden="true">→</span></button></div>
      </div>
    </section>

    <section id="vrf-mobile-services" className={`${styles.section} ${styles.services}`}>
      <Heading eyebrow={content.editorial.servicesEyebrow} eyebrowField="editorial.servicesEyebrow" title={content.servicesHeading} titleField="servicesHeading" />
      <div className={styles.disclosures}>{content.services.map((card, index) => <details key={card.id} name="vrf-mobile-service" className={styles.disclosure}><summary><span className={styles.icon}><Icon kind={index + 2} /></span><span data-website-text={`services.${card.id}.title`}>{card.title}</span><span className={styles.plus} aria-hidden="true">+</span></summary><p data-website-text={`services.${card.id}.description`}>{card.description}</p></details>)}</div>
    </section>

    <section className={`${styles.section} ${styles.trust}`}>
      <div className={styles.trustBox}>
        <div className={styles.trustHeader}><div><span className={styles.eyebrow} data-website-text="trust.eyebrow">{content.trust.eyebrow}</span><h2 data-website-text="trust.title">{content.trust.title}</h2></div><div role="img" aria-label="HVAC service technician" className={styles.trustPhoto} data-website-image="trust.imageUrl" style={{ backgroundImage: `url("${trustImage}")` }} /></div>
        <div className={styles.trustBullets}>{content.trust.bullets.map((bullet, index) => <div key={index} data-website-text={`trust.bullets.${index}`}><span aria-hidden="true">✓</span>{bullet}</div>)}</div>
        <details className={styles.trustMore}><summary>Our local approach <span aria-hidden="true">+</span></summary><p data-website-text="trust.description">{content.trust.description}</p></details>
        <a href="/projects" className={styles.textLink}>Our projects <span aria-hidden="true">↗</span></a>
      </div>
    </section>

    <section id="vrf-mobile-faq" className={styles.section}>
      <Heading eyebrow={content.editorial.faqEyebrow} eyebrowField="editorial.faqEyebrow" title={content.faqHeading} titleField="faqHeading" />
      <div className={styles.disclosures}>{content.faq.map((card) => <details className={styles.disclosure} name="vrf-mobile-faq" key={card.id}><summary><span data-website-text={`faq.${card.id}.title`}>{card.title}</span><span className={styles.plus} aria-hidden="true">+</span></summary><p data-website-text={`faq.${card.id}.description`}>{card.description}</p></details>)}</div>
      <a className={styles.faqContact} href="/contact">Still have questions? <strong>Talk to our team ↗</strong></a>
    </section>

    <section className={styles.contact} ref={endRef} id="vrf-mobile-contact">
      <span className={styles.eyebrow} data-website-text="finalCta.eyebrow">{content.finalCta.eyebrow}</span><h2 data-website-text="finalCta.title">{content.finalCta.title}</h2><p data-website-text="finalCta.description">{content.finalCta.description}</p>
      <div className={styles.contactActions}><Action link={content.finalCta.secondaryCta} whatsapp /><Action link={content.finalCta.primaryCta} /></div>
    </section>
    {showActions ? <aside className={styles.actionDock} aria-label="Contact DEMAC about VRF"><Action link={content.finalCta.secondaryCta} whatsapp /><Action link={content.finalCta.primaryCta} /></aside> : null}
  </div>;
}
