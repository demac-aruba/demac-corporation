import type { SVGProps } from 'react';
export type ChargeIconName = 'money' | 'receipt' | 'clock' | 'check' | 'bank' | 'card' | 'phone' | 'plus' | 'info' | 'history' | 'work' | 'person' | 'van' | 'calendar';
const paths: Record<ChargeIconName, React.ReactNode> = {
  money: <><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 9v6m12-6v6"/></>,
  receipt: <><path d="M6 3h9l4 4v14l-3-2-3 2-3-2-4 2V3Z"/><path d="M14 3v5h5M9 12h7m-7 4h5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  check: <><circle cx="12" cy="12" r="9"/><path d="m7 12 3 3 7-7"/></>,
  bank: <><path d="m3 8 9-5 9 5H3Zm1 12h16M6 10v7m6-7v7m6-7v7"/></>,
  card: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/></>,
  phone: <><rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2m-5-7 3 3 5-5"/></>,
  plus: <path d="M12 5v14M5 12h14"/>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/></>,
  history: <><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l4 2"/></>,
  work: <><path d="m14 6 4 4 3-3a7 7 0 0 1-9 9l-7 6-3-3 7-7a7 7 0 0 1 8-9l-3 3Z"/></>,
  person: <><circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3H4Z"/></>,
  van: <><path d="M3 17V6h12v11M15 10h4l3 4v3h-3M3 17h3m4 0h5"/><circle cx="8" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v5m10-5v5M3 11h18m-13 4h2m4 0h2"/></>,
};
export function ChargeIcon({ name, ...props }: SVGProps<SVGSVGElement> & { name: ChargeIconName }) { return <svg {...props} viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>; }
