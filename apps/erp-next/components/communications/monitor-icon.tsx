import type {CSSProperties} from 'react';
const paths={
  pulse:<path d="M3 12h4l3-7 4 14 3-7h4"/>,alert:<><path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3v.1"/></>,
  check:<path d="m5 12 4 4 10-10"/>,clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  mail:<><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 7 9 6 9-6"/></>,
  bell:<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>,
  arrow:<path d="M5 12h14m-5-5 5 5-5 5"/>,shield:<><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  refresh:<><path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1"/></>,
  gear:<><path d="m9 3-1 3-3 1v4l-2 1 2 2v4l3 1 1 2h5l1-2 3-1v-4l2-2-2-1V7l-3-1-1-3Z"/><circle cx="11.5" cy="12" r="3"/></>,
};
export function MonitorIcon({name,size=20,style}:{name:keyof typeof paths;size?:number;style?:CSSProperties}) {
  return <svg width={size} height={size} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
