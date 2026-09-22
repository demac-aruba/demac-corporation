import type { SVGProps } from 'react';
export type PropertyIconName = 'house' | 'building' | 'office' | 'pin' | 'plus' | 'minus' | 'check' | 'close' | 'chevron' | 'search' | 'person' | 'snow' | 'grid' | 'edit';
const paths: Record<PropertyIconName, React.ReactNode> = {
  house: <><path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8" /></>,
  building: <><path d="M5 21V5h10v16M15 10h4v11M3 21h18M9 8h2M9 12h2M9 16h2" /></>,
  office: <><path d="M3 21V7h18v14M7 7V3h10v4M2 21h20M7 11h2m6 0h2M7 15h2m6 0h2M10 21v-4h4v4" /></>,
  pin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />, minus: <path d="M5 12h14" />,
  check: <path d="m5 12 4 4L19 6" />, close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m6 9 6 6 6-6" />, search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 5 5" /></>,
  person: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-3a8 8 0 0 1 16 0v3" /></>,
  snow: <><path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3" /></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 15v5ZM12 20h9" /></>,
};
export function PropertyIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: PropertyIconName }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{paths[name]}</svg>;
}
