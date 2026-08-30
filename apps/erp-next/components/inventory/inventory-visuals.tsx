'use client';

import type { CSSProperties } from 'react';
import styles from './inventory-visuals.module.css';

export type InventoryIconName =
  | 'package'
  | 'bottle'
  | 'van'
  | 'tool'
  | 'transfer'
  | 'warning'
  | 'warehouse'
  | 'office'
  | 'overview'
  | 'movement';

export function InventoryIcon({ name, className = '' }: { name: InventoryIconName; className?: string }) {
  const common = {
    className: `${styles.icon} ${className}`,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };

  if (name === 'package') return <svg {...common}><path d="m4 7.5 8-4 8 4-8 4-8-4Z"/><path d="M4 7.5v9l8 4 8-4v-9M12 11.5v9"/></svg>;
  if (name === 'bottle') return <svg {...common}><path d="M9 3h6M10 3v4l-3 4v8a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2v-8l-3-4V3"/><path d="M8 13h8"/></svg>;
  if (name === 'van') return <svg {...common}><path d="M3 7h11v10H3zM14 10h4l3 4v3h-7z"/><path d="M6 17a2 2 0 1 0 4 0M16 17a2 2 0 1 0 4 0M14 13h6"/></svg>;
  if (name === 'tool') return <svg {...common}><path d="M14.5 6.5a4 4 0 0 0-5-5l2.2 2.2-2.8 2.8-2.2-2.2a4 4 0 0 0 5 5l7.7 7.7a2 2 0 1 1-2.8 2.8l-7.7-7.7"/><path d="m5 19 4-4"/></svg>;
  if (name === 'transfer') return <svg {...common}><path d="M7 7h13M16 3l4 4-4 4M17 17H4M8 13l-4 4 4 4"/></svg>;
  if (name === 'warning') return <svg {...common}><path d="M10.3 3.7 2.5 18a2 2 0 0 0 1.8 3h15.4a2 2 0 0 0 1.8-3L13.7 3.7a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>;
  if (name === 'warehouse') return <svg {...common}><path d="m3 10 9-6 9 6v10H3V10Z"/><path d="M7 20v-7h10v7M7 16h10"/></svg>;
  if (name === 'office') return <svg {...common}><path d="M4 21V4h11v17M15 9h5v12M8 8h3M8 12h3M8 16h3M18 13h.01M18 17h.01"/></svg>;
  if (name === 'movement') return <svg {...common}><path d="M4 5h16v14H4zM8 9h8M8 13h5M8 17h3"/><path d="m16 14 2 2-2 2"/></svg>;
  return <svg {...common}><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></svg>;
}

type VanThumbnailProps = {
  imageUrl?: string;
  name: string;
  size?: 'small' | 'medium' | 'large';
  className?: string;
};

const FALLBACK_VAN_IMAGE = '/images/inventory/demac-service-van.webp';

export function VanThumbnail({ imageUrl, name, size = 'medium', className = '' }: VanThumbnailProps) {
  const source = imageUrl || FALLBACK_VAN_IMAGE;
  return <span className={`${styles.vanThumbnail} ${styles[size]} ${className}`} style={{ '--van-image-position': 'center' } as CSSProperties}>
    <img
      src={source}
      alt={`${name} service van`}
      onError={(event) => {
        if (event.currentTarget.src.endsWith(FALLBACK_VAN_IMAGE)) return;
        event.currentTarget.src = FALLBACK_VAN_IMAGE;
      }}
    />
  </span>;
}
