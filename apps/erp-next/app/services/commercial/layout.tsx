import type { ReactNode } from 'react';
import { CommercialSystemGalleryEnhancer } from '@/components/public/commercial-system-gallery-enhancer';
import '../../commercial-system-gallery.css';

export default function CommercialLayout({ children }: { children: ReactNode }) {
  return <>{children}<CommercialSystemGalleryEnhancer /></>;
}
