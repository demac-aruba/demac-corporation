import type { ReactNode } from 'react';
import type { Vacancy } from '../../lib/careers-preview';
import { sizeLabel } from './careers-ui';
import s from './careers.module.css';

export type IconName = 'person' | 'file' | 'certificate' | 'briefcase' | 'location' | 'clock' | 'chart' | 'check' | 'arrow' | 'mail' | 'upload' | 'camera' | 'close' | 'filters' | 'lock' | 'users';
const paths: Record<IconName, ReactNode> = {
  person: <><circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/></>,
  file: <><path d="M14 2H5v20h14V7zM14 2v6h5M8 12h8M8 16h6"/></>,
  certificate: <><path d="m12 2 3 2 4 1 1 4 2 3-2 3-1 4-4 1-3 2-3-2-4-1-1-4-2-3 2-3 1-4 4-1z"/><path d="m8 12 3 3 5-6"/></>,
  briefcase: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M8 7V3h8v4M3 12c5 4 13 4 18 0M12 12v4"/></>,
  location: <><path d="M19 10c0 6-7 12-7 12S5 16 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2.5"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
  chart: <><path d="M4 21V11h4v10M10 21V7h4v14M16 21V3h4v18"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></>,
  upload: <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>,
  camera: <><path d="m8 5 2-3h4l2 3h5v16H3V5z"/><circle cx="12" cy="12" r="4"/></>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  filters: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="10" cy="18" r="2" fill="currentColor"/></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/></>,
  users: <><circle cx="9" cy="7" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M17 4a3 3 0 0 1 0 6M19 14c2 1 3 2 3 5v2"/></>,
};
export function CareerIcon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className || s.icon} viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}
export function IconTile({ name, children }: { name: IconName; children?: ReactNode }) {
  return <span className={s.iconTile}><CareerIcon name={name}/>{children}</span>;
}
export function VacancyFacts({ vacancy }: { vacancy: Vacancy }) {
  const experience = vacancy.requirements.find(item => /\b\d+\+?\s+years?\b/i.test(item));
  const facts: [IconName, string, string][] = [
    ['location', 'Location', vacancy.location], ['briefcase', 'Department', vacancy.department],
    ['clock', 'Type', vacancy.contract], ['chart', 'Experience', experience || 'See requirements'],
  ];
  return <dl className={s.factGrid}>{facts.map(([icon, label, value]) => <div key={label}><CareerIcon name={icon}/><div><dt>{label}</dt><dd>{value}</dd></div></div>)}</dl>;
}
export function ReadyFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  return <div className={s.selectedFile} data-file-state="selected"><span className={s.greenCheck}><CareerIcon name="check"/></span><div className={s.selectedFileCopy}><strong>{file.name}</strong><small>{sizeLabel(file.size)} · Selected for review</small></div><button type="button" className={s.iconButton} aria-label={`Remove ${file.name}`} onClick={onRemove}><CareerIcon name="close"/></button></div>;
}
export function FunnelSteps({ step, disabled, onSelect }: { step: number; disabled: boolean; onSelect: (index: number) => void }) {
  return <nav className={s.steps} aria-label="Application progress">{['Your details', 'Experience', 'Documents'].map((label, index) => <button key={label} type="button" data-step-state={index < step ? 'complete' : index === step ? 'active' : 'upcoming'} disabled={index > step || disabled} onClick={() => onSelect(index)} aria-current={index === step ? 'step' : undefined} aria-label={`Step ${index + 1}: ${label}${index < step ? ', completed' : ''}`} className={index <= step ? s.stepActive : s.step}><span className={s.stepCircle}>{index < step ? <CareerIcon name="check"/> : index + 1}</span><small>{label}</small></button>)}</nav>;
}
