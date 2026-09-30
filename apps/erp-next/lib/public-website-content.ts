export type WebsiteLink = {
  label: string;
  href: string;
};

export type WebsiteHeroSlide = {
  id: string;
  name: string;
  enabled: boolean;
  imageUrl: string;
  mobileImageUrl?: string;
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
  primaryCta: WebsiteLink;
  secondaryCta: WebsiteLink;
  desktopPosition: string;
  mobilePosition: string;
};

export const CAREERS_COPY_KEYS = ['eyebrow','title','subtitle','description'] as const;
export type CareersCopyKey = typeof CAREERS_COPY_KEYS[number];
export type CareersSpanishCopy = Record<CareersCopyKey,string> & {status:'Draft'|'Approved';source:string};
export function careersCopySignature(content: Record<CareersCopyKey,string>): string {
  return JSON.stringify(CAREERS_COPY_KEYS.map(key=>content[key].trim()));
}
export type WebsiteCareersContent = {
  spanish?: CareersSpanishCopy;
  eyebrow: string; title: string; subtitle: string; description: string;
  imageUrl: string; roleImageUrl: string;
};

/** Existing bundled artwork, not a photograph of DEMAC's premises or staff. */
export const defaultCareersContent: WebsiteCareersContent = {
  eyebrow: 'BUILD A COOLER TOMORROW', title: 'Careers', subtitle: 'Join the DEMAC team.',
  description: 'Great people. Real impact. A cooler Aruba.',
  imageUrl: '/website/hero/hero-residential.webp',
  roleImageUrl: '/website/hero/hero-residential.webp',
  spanish: {status:'Approved',source:JSON.stringify(['BUILD A COOLER TOMORROW','Careers','Join the DEMAC team.','Great people. Real impact. A cooler Aruba.']),
    eyebrow:'CONSTRUYAMOS UN FUTURO MÁS FRESCO',title:'Trabaja con nosotros',subtitle:'Únete al equipo DEMAC.',description:'Grandes personas. Impacto real. Una Aruba más fresca.'},
};

export function normalizeCareersContent(value: unknown): WebsiteCareersContent {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result = { ...defaultCareersContent };
  for (const key of [...CAREERS_COPY_KEYS,'imageUrl','roleImageUrl'] as const) {
    const raw = source[key];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const text = raw.trim();
    if (key === 'imageUrl' || key === 'roleImageUrl') {
      // Accept public HTTPS or site-local artwork, not script/data URLs or credentials.
      try {
        const url = new URL(text, 'https://website.invalid');
        if (url.protocol !== 'https:' || url.username || url.password || text.startsWith('//') || /[\\\s]/.test(text)) continue;
        if (!text.startsWith('/') && !text.startsWith('https://')) continue;
        result[key] = text.slice(0, 2048);
      } catch { /* Preserve the bundled, offline-safe image. */ }
    } else result[key] = text.slice(0, 500);
  }
  if(Object.hasOwn(source,'spanish')) {
    const candidate=source.spanish && typeof source.spanish==='object'?source.spanish as Record<string,unknown>:{};
    if(['Draft','Approved'].includes(String(candidate.status))&&typeof candidate.source==='string'&&candidate.source.length<=2200&&CAREERS_COPY_KEYS.every(key=>typeof candidate[key]==='string'&&(candidate[key] as string).length<=500)) {
      result.spanish={status:candidate.status as 'Draft'|'Approved',source:candidate.source,...Object.fromEntries(CAREERS_COPY_KEYS.map(key=>[key,(candidate[key] as string).trim()]))} as CareersSpanishCopy;
    } else delete result.spanish;
  }
  return result;
}

export function careersContentFor(content:WebsiteCareersContent,locale:'en'|'es'): {content:WebsiteCareersContent;contentLocale:'en'|'es'} {
  const es=content.spanish;
  if(locale==='es'&&es?.status==='Approved'&&es.source===careersCopySignature(content)&&CAREERS_COPY_KEYS.every(key=>!!es[key].trim()))
    return {content:{...content,...Object.fromEntries(CAREERS_COPY_KEYS.map(key=>[key,es[key]]))},contentLocale:'es'};
  return {content,contentLocale:'en'};
}

export type PublicWebsiteContent = {
  id: string;
  version: number;
  hero: {
    autoplayMs: number;
    transitionMs: number;
    slides: WebsiteHeroSlide[];
  };
  careers?: WebsiteCareersContent;
  contact: {
    officeAddress: string;
    weekdayHours: string;
    saturdayHours: string;
    phone?: string;
    email?: string;
    whatsappUrl?: string;
    facebookUrl?: string;
    instagramUrl?: string;
  };
  updatedAt?: string;
  updatedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
};

export const WEBSITE_DRAFT_ID = 'publicWebsiteDraft';
export const WEBSITE_PUBLISHED_ID = 'publicWebsitePublished';
export const WEBSITE_SETTINGS_COLLECTION = 'businessSettings';

// The first bundled image exports were accidentally compressed to only
// 7–14 KB and became visibly blocky at full hero width. Keep these HD URLs
// centralized so both bundled defaults and previously saved configs migrate
// away from the damaged assets automatically.
export const DEFAULT_HERO_IMAGE_URLS = {
  residential: 'https://images.unsplash.com/photo-1761330440311-16e160cad236?auto=format&fit=crop&fm=webp&q=88&w=2400',
  professional: 'https://images.unsplash.com/photo-1715593949273-09009558300a?auto=format&fit=crop&fm=webp&q=88&w=2400',
  hospitality: 'https://images.unsplash.com/photo-1775480462508-373a4f259049?auto=format&fit=crop&fm=webp&q=88&w=2400',
} as const;

const COMPRESSED_HERO_MIGRATION: Record<string, string> = {
  '/website/hero/hero-residential.webp': DEFAULT_HERO_IMAGE_URLS.residential,
  '/website/hero/hero-professional.webp': DEFAULT_HERO_IMAGE_URLS.professional,
  '/website/hero/hero-hospitality.webp': DEFAULT_HERO_IMAGE_URLS.hospitality,
};

export const defaultPublicWebsiteContent: PublicWebsiteContent = {
  id: WEBSITE_PUBLISHED_ID,
  version: 1,
  hero: {
    autoplayMs: 5000,
    transitionMs: 700,
    slides: [
      {
        id: 'hero-residential',
        name: 'Residential comfort',
        enabled: true,
        imageUrl: DEFAULT_HERO_IMAGE_URLS.residential,
        eyebrow: 'Premium air conditioning solutions',
        title: 'Cooling Comfort for Homes & Businesses in',
        accent: 'Aruba.',
        description: 'Premium air conditioning solutions built for Aruba’s climate. Sales, professional installations, expert service and reliable repairs.',
        primaryCta: { label: 'Request Estimate', href: '/contact?request=estimate' },
        secondaryCta: { label: 'WhatsApp Us', href: '/contact?channel=whatsapp' },
        desktopPosition: 'center right',
        mobilePosition: '64% center',
      },
      {
        id: 'hero-professional',
        name: 'Professional spaces',
        enabled: true,
        imageUrl: DEFAULT_HERO_IMAGE_URLS.professional,
        eyebrow: 'Cooling for professional spaces',
        title: 'Reliable Cooling for Offices & Clinics in',
        accent: 'Aruba.',
        description: 'Comfort, dependable service and professional cooling support for offices, clinics, consultorios and customer-facing spaces.',
        primaryCta: { label: 'Request Estimate', href: '/contact?request=estimate' },
        secondaryCta: { label: 'View Services', href: '/services' },
        desktopPosition: 'center right',
        mobilePosition: '66% center',
      },
      {
        id: 'hero-hospitality',
        name: 'Hospitality & business',
        enabled: true,
        imageUrl: DEFAULT_HERO_IMAGE_URLS.hospitality,
        eyebrow: 'Commercial comfort across Aruba',
        title: 'Cooling Solutions for Hospitality & Business in',
        accent: 'Aruba.',
        description: 'Professional cooling solutions for restaurants, hospitality, commercial properties and demanding operating environments.',
        primaryCta: { label: 'Discuss a Project', href: '/contact?request=estimate' },
        secondaryCta: { label: 'Commercial Services', href: '/services/commercial' },
        desktopPosition: 'center right',
        mobilePosition: '68% center',
      },
    ],
  },
  contact: {
    officeAddress: 'Santa Cruz 54 C · Aruba',
    weekdayHours: 'Mon–Fri · 8:00 AM–5:00 PM',
    saturdayHours: 'Saturday · 9:00 AM–1:00 PM',
  },
};

function stringValue(value: unknown, fallback: string) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizeLink(value: unknown, fallback: WebsiteLink): WebsiteLink {
  if (!value || typeof value !== 'object') return fallback;
  const source = value as Record<string, unknown>;
  return {
    label: stringValue(source.label, fallback.label),
    href: stringValue(source.href, fallback.href),
  };
}

function normalizeImageUrl(value: unknown, fallback: string) {
  const imageUrl = stringValue(value, fallback);
  return COMPRESSED_HERO_MIGRATION[imageUrl] ?? imageUrl;
}

function normalizeSlide(value: unknown, fallback: WebsiteHeroSlide): WebsiteHeroSlide {
  if (!value || typeof value !== 'object') return fallback;
  const source = value as Record<string, unknown>;
  return {
    id: stringValue(source.id, fallback.id),
    name: stringValue(source.name, fallback.name),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    imageUrl: normalizeImageUrl(source.imageUrl, fallback.imageUrl),
    mobileImageUrl: optionalString(source.mobileImageUrl),
    eyebrow: stringValue(source.eyebrow, fallback.eyebrow),
    title: stringValue(source.title, fallback.title),
    accent: stringValue(source.accent, fallback.accent),
    description: stringValue(source.description, fallback.description),
    primaryCta: normalizeLink(source.primaryCta, fallback.primaryCta),
    secondaryCta: normalizeLink(source.secondaryCta, fallback.secondaryCta),
    desktopPosition: stringValue(source.desktopPosition, fallback.desktopPosition),
    mobilePosition: stringValue(source.mobilePosition, fallback.mobilePosition),
  };
}

export function normalizePublicWebsiteContent(value: unknown, id = WEBSITE_PUBLISHED_ID): PublicWebsiteContent {
  const fallback = defaultPublicWebsiteContent;
  if (!value || typeof value !== 'object') return { ...fallback, id };
  const source = value as Record<string, unknown>;
  const hero = source.hero && typeof source.hero === 'object' ? source.hero as Record<string, unknown> : {};
  const contact = source.contact && typeof source.contact === 'object' ? source.contact as Record<string, unknown> : {};
  const rawSlides = Array.isArray(hero.slides) ? hero.slides : [];
  const slides = rawSlides.length
    ? rawSlides.slice(0, 12).map((slide, index) => normalizeSlide(slide, fallback.hero.slides[index % fallback.hero.slides.length]))
    : fallback.hero.slides;

  return {
    id,
    version: Math.max(1, Math.round(numberValue(source.version, fallback.version, 1, 9999))),
    hero: {
      autoplayMs: numberValue(hero.autoplayMs, fallback.hero.autoplayMs, 3000, 15000),
      transitionMs: numberValue(hero.transitionMs, fallback.hero.transitionMs, 250, 1800),
      slides,
    },
    careers: normalizeCareersContent(source.careers),
    contact: {
      officeAddress: stringValue(contact.officeAddress, fallback.contact.officeAddress),
      weekdayHours: stringValue(contact.weekdayHours, fallback.contact.weekdayHours),
      saturdayHours: stringValue(contact.saturdayHours, fallback.contact.saturdayHours),
      phone: optionalString(contact.phone),
      email: optionalString(contact.email),
      whatsappUrl: optionalString(contact.whatsappUrl),
      facebookUrl: optionalString(contact.facebookUrl),
      instagramUrl: optionalString(contact.instagramUrl),
    },
    updatedAt: optionalString(source.updatedAt),
    updatedBy: optionalString(source.updatedBy),
    publishedAt: optionalString(source.publishedAt),
    publishedBy: optionalString(source.publishedBy),
  };
}

export function cloneWebsiteContent(content: PublicWebsiteContent, id = content.id): PublicWebsiteContent {
  return normalizePublicWebsiteContent(JSON.parse(JSON.stringify(content)), id);
}
