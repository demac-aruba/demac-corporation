import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'QuickBooks | DEMAC ERP', robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' };
export default function QuickBooksLayout({ children }: { children: React.ReactNode }) { return children; }
