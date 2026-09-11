export type VrfLink = { label: string; href: string };

export type VrfCard = {
  id: string;
  title: string;
  description: string;
  detail?: string;
};

export type PublicVrfContent = {
  id: string;
  version: number;
  hero: {
    eyebrow: string;
    title: string;
    accent: string;
    description: string;
    imageUrl: string;
    imagePosition: string;
    primaryCta: VrfLink;
    secondaryCta: VrfLink;
  };
  solutionsHeading: string;
  solutionsIntro: string;
  solutions: VrfCard[];
  benefitsHeading: string;
  benefits: VrfCard[];
  indoorHeading: string;
  indoorIntro: string;
  indoorUnits: VrfCard[];
  applicationsHeading: string;
  applications: VrfCard[];
  processHeading: string;
  process: VrfCard[];
  servicesHeading: string;
  services: VrfCard[];
  trust: {
    eyebrow: string;
    title: string;
    description: string;
    imageUrl: string;
    bullets: string[];
  };
  faqHeading: string;
  faq: VrfCard[];
  finalCta: {
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: VrfLink;
    secondaryCta: VrfLink;
  };
  updatedAt?: string;
  updatedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
};

export const VRF_DRAFT_ID = 'publicVrfPageDraft';
export const VRF_PUBLISHED_ID = 'publicVrfPagePublished';
export const VRF_SETTINGS_COLLECTION = 'businessSettings';
export const PUBLIC_VRF_CONFIG_PATH = 'public-website/vrf/published.json';

export const defaultPublicVrfContent: PublicVrfContent = {
  id: VRF_PUBLISHED_ID,
  version: 1,
  hero: {
    eyebrow: 'VRF SYSTEMS IN ARUBA',
    title: 'Smarter VRF solutions for complex buildings in',
    accent: 'Aruba.',
    description: 'Energy-efficient. Flexible. Built for Aruba. DEMAC designs, installs and supports VRF systems for apartments, hotels, offices, villas and commercial buildings — delivering precise comfort, lower operating costs and long-term reliability.',
    imageUrl: 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&fm=webp&q=88&w=2200',
    imagePosition: 'center center',
    primaryCta: { label: 'Request a VRF Consultation', href: '/contact?request=vrf' },
    secondaryCta: { label: 'WhatsApp Us', href: '/contact?channel=whatsapp' },
  },
  solutionsHeading: 'The right VRF system for every project.',
  solutionsIntro: 'From compact spaces to large, complex buildings, DEMAC provides the right VRF architecture for the property, load profile and long-term operating goals.',
  solutions: [
    { id: 'large-vrf', title: 'Large VRF Systems', description: 'High-capacity systems for hotels, large commercial buildings and multi-tower developments.', detail: 'Ideal for: hotels, large offices, commercial complexes' },
    { id: 'modular-vrf', title: 'Modular VRF Systems', description: 'Scalable systems that grow with the project and support phased or multi-building developments.', detail: 'Ideal for: mid-size buildings, phased developments' },
    { id: 'mini-vrf', title: 'Mini VRF Systems', description: 'Compact, efficient VRF for villas, smaller buildings and light-commercial applications.', detail: 'Ideal for: villas, small offices, residential buildings' },
  ],
  benefitsHeading: 'A smarter way to cool.',
  benefits: [
    { id: 'zoned-comfort', title: 'Zoned Comfort', description: 'Individual temperature control for each room or zone.' },
    { id: 'energy-efficiency', title: 'Energy Efficiency', description: 'Variable-capacity operation follows real demand to reduce energy use.' },
    { id: 'flexible-design', title: 'Flexible Design', description: 'Adapts to complex building layouts, multiple floors and future changes.' },
    { id: 'long-pipe-runs', title: 'Long Pipe Runs', description: 'Greater design freedom for high-rise and larger sites.' },
    { id: 'central-control', title: 'Centralized Control', description: 'Manage zones, schedules and operating visibility from one interface.' },
    { id: 'quiet-operation', title: 'Quiet Operation', description: 'Low indoor noise for hotels, residences, offices and professional spaces.' },
  ],
  indoorHeading: 'A complete range of indoor units.',
  indoorIntro: 'Mix and match indoor-unit styles to create the right comfort solution for each space.',
  indoorUnits: [
    { id: 'cassette', title: 'Cassette Units', description: 'Discreet ceiling integration with wide air distribution.', detail: 'Offices · retail · commercial spaces' },
    { id: 'fan-coil', title: 'Fan Coil Units', description: 'Flexible concealed or ducted installation for refined interiors.', detail: 'Hotels · offices · residences' },
    { id: 'floor-ceiling', title: 'Floor-Ceiling Units', description: 'Versatile mounting for open areas and spaces with limited ceiling options.', detail: 'Retail · restaurants · open spaces' },
    { id: 'air-handler', title: 'Air Handlers', description: 'Higher-static solutions for custom ductwork and larger conditioned areas.', detail: 'Large buildings · custom applications' },
    { id: 'split-unit', title: 'Split Units', description: 'Flexible indoor-unit option for smaller commercial zones.', detail: 'Offices · support spaces' },
    { id: 'wall-mounted', title: 'Wall-Mounted Split Units', description: 'Compact, familiar indoor units with independent zoning.', detail: 'Bedrooms · offices · smaller rooms' },
  ],
  applicationsHeading: 'Trusted in every type of building.',
  applications: [
    { id: 'apartments', title: 'Apartments & Condominiums', description: 'Efficient, individual comfort for every residence.' },
    { id: 'hospitality', title: 'Hotels & Hospitality', description: 'Quiet guest comfort with centralized oversight.' },
    { id: 'office', title: 'Office Buildings', description: 'Flexible zoning for teams, meeting rooms and changing occupancy.' },
    { id: 'retail', title: 'Retail & Mixed Use', description: 'Different schedules and comfort needs within one coordinated system.' },
    { id: 'villas', title: 'Luxury Homes & Villas', description: 'Discreet comfort and design flexibility for premium residences.' },
    { id: 'controlled', title: 'Medical / Controlled Environments', description: 'Stable comfort and operational visibility for professional spaces.' },
  ],
  processHeading: 'From concept to comfort.',
  process: [
    { id: 'assessment', title: 'Assessment', description: 'We understand the building, occupancy, goals and operating requirements.' },
    { id: 'load-study', title: 'Load Study & Concept', description: 'Cooling loads, zoning and the system concept are developed for the project.' },
    { id: 'design', title: 'Design & Coordination', description: 'Equipment, piping, controls and trades are coordinated before execution.' },
    { id: 'installation', title: 'Installation', description: 'Professional installation by trained technicians with documented quality checks.' },
    { id: 'commissioning', title: 'Commissioning', description: 'Pressure testing, vacuum, addressing, startup and system validation.' },
    { id: 'support', title: 'Maintenance & Support', description: 'Preventive service, diagnostics and local after-sales support.' },
  ],
  servicesHeading: 'More than installation. A long-term partner.',
  services: [
    { id: 'assessment-design', title: 'VRF Assessment & Design', description: 'System analysis, load planning and coordinated solution design.' },
    { id: 'install-commission', title: 'Installation & Commissioning', description: 'Professional execution and complete system startup.' },
    { id: 'diagnostics', title: 'Diagnostics & Repairs', description: 'Structured troubleshooting for refrigeration, electrical and controls.' },
    { id: 'maintenance', title: 'Preventive Maintenance', description: 'Protect efficiency, reliability and equipment life.' },
    { id: 'controls', title: 'Controls & Integration', description: 'Centralized controls, schedules and integration-ready planning.' },
    { id: 'technical-support', title: 'Technical Support', description: 'Local support from a team that understands the installed system.' },
  ],
  trust: {
    eyebrow: 'WHY WORK WITH DEMAC?',
    title: 'Local expertise. Lasting performance.',
    description: 'DEMAC combines VRF technical expertise with local Aruba knowledge to deliver systems that are practical to install, commission, service and support for the long term.',
    imageUrl: 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&fm=webp&q=86&w=1400',
    bullets: [
      'Aruba-based team with local expertise',
      'End-to-end project coordination',
      'Experienced installation and commissioning team',
      'Reliable after-sales service and maintenance',
      'Solutions for projects from mini VRF to modular systems',
      'A long-term partner you can count on',
    ],
  },
  faqHeading: 'Quick answers about VRF systems.',
  faq: [
    { id: 'what-is-vrf', title: 'What is a VRF system?', description: 'VRF uses variable refrigerant flow to serve multiple indoor zones from one coordinated outdoor-system architecture, matching capacity to demand.' },
    { id: 'efficiency', title: 'How energy efficient are VRF systems?', description: 'Inverter-driven compressors modulate capacity instead of operating only at full output, which can reduce unnecessary energy use when loads vary.' },
    { id: 'best-buildings', title: 'What types of buildings are VRF systems best for?', description: 'VRF is especially useful where many zones have different schedules or comfort needs, including hotels, apartments, offices, villas and mixed-use buildings.' },
    { id: 'mix-indoor', title: 'Can I mix different indoor unit types?', description: 'Yes. A properly designed VRF project can combine compatible cassettes, fan coils, floor-ceiling units, air handlers and wall-mounted units across different zones.' },
    { id: 'maintenance', title: 'Do you provide maintenance and support?', description: 'Yes. DEMAC supports VRF systems with preventive maintenance, diagnostics, repairs and ongoing technical support.' },
    { id: 'start-project', title: 'How do I get started with a VRF project?', description: 'Start with a consultation and project assessment so we can understand the building, cooling loads, zoning, electrical conditions and design priorities.' },
  ],
  finalCta: {
    eyebrow: 'READY TO OPTIMIZE YOUR BUILDING?',
    title: 'Let’s design the right VRF solution for your building.',
    description: 'Get expert advice from DEMAC’s VRF team in Aruba and build the system around your property, operating needs and long-term goals.',
    primaryCta: { label: 'Request a VRF Consultation', href: '/contact?request=vrf' },
    secondaryCta: { label: 'WhatsApp Us', href: '/contact?channel=whatsapp' },
  },
};

function text(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function optionalText(value: unknown, fallback?: string) {
  return typeof value === 'string' ? value.trim() : fallback;
}

function normalizeLink(value: unknown, fallback: VrfLink): VrfLink {
  if (!value || typeof value !== 'object') return fallback;
  const source = value as Record<string, unknown>;
  return { label: text(source.label, fallback.label), href: text(source.href, fallback.href) };
}

function normalizeCards(value: unknown, fallback: VrfCard[], limit = 12): VrfCard[] {
  if (!Array.isArray(value) || !value.length) return fallback;
  return value.slice(0, limit).map((item, index) => {
    const base = fallback[index] ?? fallback[fallback.length - 1];
    const source = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      id: text(source.id, base?.id ?? `item-${index + 1}`),
      title: text(source.title, base?.title ?? `Item ${index + 1}`),
      description: text(source.description, base?.description ?? ''),
      detail: optionalText(source.detail, base?.detail),
    };
  });
}

export function normalizePublicVrfContent(value: unknown, id = VRF_PUBLISHED_ID): PublicVrfContent {
  const f = defaultPublicVrfContent;
  if (!value || typeof value !== 'object') return { ...f, id };
  const source = value as Record<string, unknown>;
  const hero = source.hero && typeof source.hero === 'object' ? source.hero as Record<string, unknown> : {};
  const trust = source.trust && typeof source.trust === 'object' ? source.trust as Record<string, unknown> : {};
  const finalCta = source.finalCta && typeof source.finalCta === 'object' ? source.finalCta as Record<string, unknown> : {};
  const rawBullets = Array.isArray(trust.bullets) ? trust.bullets : [];
  return {
    id,
    version: Math.max(1, Number(source.version) || f.version),
    hero: {
      eyebrow: text(hero.eyebrow, f.hero.eyebrow),
      title: text(hero.title, f.hero.title),
      accent: text(hero.accent, f.hero.accent),
      description: text(hero.description, f.hero.description),
      imageUrl: text(hero.imageUrl, f.hero.imageUrl),
      imagePosition: text(hero.imagePosition, f.hero.imagePosition),
      primaryCta: normalizeLink(hero.primaryCta, f.hero.primaryCta),
      secondaryCta: normalizeLink(hero.secondaryCta, f.hero.secondaryCta),
    },
    solutionsHeading: text(source.solutionsHeading, f.solutionsHeading),
    solutionsIntro: text(source.solutionsIntro, f.solutionsIntro),
    solutions: normalizeCards(source.solutions, f.solutions, 3),
    benefitsHeading: text(source.benefitsHeading, f.benefitsHeading),
    benefits: normalizeCards(source.benefits, f.benefits, 6),
    indoorHeading: text(source.indoorHeading, f.indoorHeading),
    indoorIntro: text(source.indoorIntro, f.indoorIntro),
    indoorUnits: normalizeCards(source.indoorUnits, f.indoorUnits, 6),
    applicationsHeading: text(source.applicationsHeading, f.applicationsHeading),
    applications: normalizeCards(source.applications, f.applications, 6),
    processHeading: text(source.processHeading, f.processHeading),
    process: normalizeCards(source.process, f.process, 6),
    servicesHeading: text(source.servicesHeading, f.servicesHeading),
    services: normalizeCards(source.services, f.services, 6),
    trust: {
      eyebrow: text(trust.eyebrow, f.trust.eyebrow),
      title: text(trust.title, f.trust.title),
      description: text(trust.description, f.trust.description),
      imageUrl: text(trust.imageUrl, f.trust.imageUrl),
      bullets: rawBullets.length ? rawBullets.slice(0, 8).map((item, index) => text(item, f.trust.bullets[index] ?? 'Local support')) : f.trust.bullets,
    },
    faqHeading: text(source.faqHeading, f.faqHeading),
    faq: normalizeCards(source.faq, f.faq, 8),
    finalCta: {
      eyebrow: text(finalCta.eyebrow, f.finalCta.eyebrow),
      title: text(finalCta.title, f.finalCta.title),
      description: text(finalCta.description, f.finalCta.description),
      primaryCta: normalizeLink(finalCta.primaryCta, f.finalCta.primaryCta),
      secondaryCta: normalizeLink(finalCta.secondaryCta, f.finalCta.secondaryCta),
    },
    updatedAt: optionalText(source.updatedAt),
    updatedBy: optionalText(source.updatedBy),
    publishedAt: optionalText(source.publishedAt),
    publishedBy: optionalText(source.publishedBy),
  };
}

export function clonePublicVrfContent(content: PublicVrfContent, id = content.id) {
  return normalizePublicVrfContent(JSON.parse(JSON.stringify(content)), id);
}
