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

export type PublicWebsiteContent = {
  id: string;
  version: number;
  hero: {
    autoplayMs: number;
    transitionMs: number;
    slides: WebsiteHeroSlide[];
  };
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
        imageUrl: '/website/hero/hero-residential.webp',
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
        imageUrl: '/website/hero/hero-professional.webp',
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
        imageUrl: '/website/hero/hero-hospitality.webp',
        eyebrow: 'Commercial comfort across Aruba',
        title: 'Cooling Solutions for Hospitality & Business in',
        accent: 'Aruba.',
        description: 'Professional cooling solutions for restaurants, hospitality, commercial properties and demanding operating environments.',
        primaryCta: { label: 'Discuss a Project', href: '/contact?request=estimate' },
        secondaryCta: { label: 'Commercial Services', href: '/services' },
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

function normalizeSlide(value: unknown, fallback: WebsiteHeroSlide): WebsiteHeroSlide {
  if (!value || typeof value !== 'object') return fallback;
  const source = value as Record<string, unknown>;
  return {
    id: stringValue(source.id, fallback.id),
    name: stringValue(source.name, fallback.name),
    enabled: typeof source.enabled === 'boolean' ? source.enabled : fallback.enabled,
    imageUrl: stringValue(source.imageUrl, fallback.imageUrl),
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
