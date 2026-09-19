import { defaults as bundledDefaults, normalizeVrf } from '../../../functions/websiteEditorialContract';

export type VrfLink = { label: string; href: string };

export type VrfCard = {
  id: string;
  title: string;
  description: string;
  detail?: string;
  imageUrl?: string;
  imageAlt?: string;
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
    mobileImagePosition: string;
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
  editorial: Record<string, string>;
  finalCta: {
    imageUrl: string;
    eyebrow: string;
    title: string;
    description: string;
    primaryCta: VrfLink;
    secondaryCta: VrfLink;
  };
  publicationId?: string;
  updatedAt?: string;
  updatedBy?: string;
  publishedAt?: string;
  publishedBy?: string;
};

export const VRF_DRAFT_ID = 'publicVrfPageDraft';
export const VRF_PUBLISHED_ID = 'publicVrfPagePublished';
export const VRF_SETTINGS_COLLECTION = 'businessSettings';
export const PUBLIC_VRF_CONFIG_PATH = 'public-website/vrf/published.json';

export const APPROVED_VRF_HERO_IMAGE_URL = 'https://images.unsplash.com/photo-1775629632806-165d644178c0?auto=format&fit=crop&fm=webp&q=88&w=2200';
export const APPROVED_VRF_TRUST_IMAGE_URL = 'https://skipcalls.com/aeo/hvac/hvac-first-hot-day-my-phone-blows-up-with-no-cool-calls.webp';
const LEGACY_VRF_HERO_IMAGE_URL = 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&fm=webp&q=88&w=2200';
const LEGACY_VRF_TRUST_IMAGE_URL = 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&fm=webp&q=86&w=1400';

export const defaultPublicVrfContent = normalizeVrf(bundledDefaults) as PublicVrfContent;

export function normalizePublicVrfContent(value: unknown, id = VRF_PUBLISHED_ID): PublicVrfContent {
  return normalizeVrf(value, id) as PublicVrfContent;
}

export function clonePublicVrfContent(content: PublicVrfContent, id = content.id) {
  return normalizePublicVrfContent(JSON.parse(JSON.stringify(content)), id);
}
