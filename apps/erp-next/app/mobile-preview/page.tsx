import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MobileInventoryPreview } from './mobile-inventory-preview';

export const metadata: Metadata = {
  title: 'Mobile Preview · ERP',
  robots: { index: false, follow: false, nocache: true },
};

export default function MobilePreviewPage() {
  const previewEnabled = process.env.VERCEL_ENV === 'preview' || process.env.NODE_ENV === 'development';
  if (!previewEnabled) notFound();

  return <MobileInventoryPreview />;
}
