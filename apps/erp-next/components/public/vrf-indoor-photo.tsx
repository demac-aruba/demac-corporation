'use client';

import type { VrfCard } from '@/lib/public-vrf-content';
import { defaultVrfIndoorUnits, safeIndoorImageUrl } from '@/lib/public-vrf-indoor';
import styles from './vrf-indoor-photos.module.css';

/** Native-size approved product artwork, shared by desktop, phone and editor. */
export function VrfIndoorPhoto({ card }: { card: VrfCard }) {
  const base = defaultVrfIndoorUnits.find((item) => item.id === card.id);
  const fallback = base?.imageUrl ?? '';
  const source = safeIndoorImageUrl(card.imageUrl, fallback);
  return <img
    key={source}
    className={styles.image}
    data-vrf-indoor-photo={card.id}
    src={source}
    alt={card.imageAlt || base?.imageAlt || card.title}
    width={236}
    height={159}
    loading="lazy"
    decoding="async"
    onError={(event) => {
      const image = event.currentTarget;
      if (fallback && source !== fallback && image.dataset.fallback !== 'true') {
        image.dataset.fallback = 'true';
        image.src = fallback;
      }
    }}
  />;
}
