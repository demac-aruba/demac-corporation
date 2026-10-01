'use client';

import type { ReactNode } from 'react';
import type { FieldScheduleJob } from '../../lib/field-authority-contract';
import { formatArubaDateKey } from '../../lib/aruba-date';
import { fieldJobStatusPresentation, fieldRolePresentation, fieldWorkSummary } from '../../lib/field-portal-presentation';
import styles from './field-portal.module.css';

export type FieldPortalTab = 'home' | 'agenda' | 'jobs' | 'profile';
type IconName = 'home' | 'calendar' | 'work' | 'user' | 'users' | 'check' | 'clock' | 'pin' | 'chevron' | 'play' | 'van' | 'snow' | 'refresh' | 'logout' | 'lock' | 'phone' | 'unit' | 'plus' | 'back' | 'info' | 'warning';
const paths: Record<IconName, ReactNode> = {
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M7 3v4m10-4v4M3 10h18M7 14h1m4 0h1m4 0h1M7 18h1m4 0h1" /></>,
  work: <><rect x="5" y="5" width="14" height="16" rx="2" /><rect x="9" y="3" width="6" height="4" rx="1" /><path d="M9 12h6m-6 4h6" /></>,
  user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  users: <><circle cx="9" cy="7" r="3" /><path d="M2 21v-2a7 7 0 0 1 14 0v2M16 4a3 3 0 0 1 0 6m2 4a6 6 0 0 1 4 6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
  pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  play: <path d="m8 4 12 8-12 8Z" />,
  van: <><path d="M3 17V6h11v11M14 9h4l3 5v3H3" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="18" r="2" /><path d="M17 10v4h4" /></>,
  snow: <><path d="M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1-1-4M18 19l-1-4 4-1M6 19l1-4-4-1M21 10l-4-1 1-4" /></>,
  refresh: <><path d="M20 7v5h-5M4 17v-5h5M5 7a8 8 0 0 1 14-1l1 6M4 12l1 6a8 8 0 0 0 14-1" /></>,
  logout: <><path d="M10 3H4v18h6m-2-9h13m-5-5 5 5-5 5" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
  phone: <path d="m5 3 4 1 1 5-3 2a12 12 0 0 0 6 6l2-3 5 1 1 4c-1 5-8 2-12-2S1 4 5 3Z" />,
  unit: <><rect x="2" y="5" width="20" height="12" rx="2" /><path d="M5 13h14M7 20v2m5-2v2m5-2v2" /></>,
  plus: <path d="M12 4v16M4 12h16" />,
  back: <path d="m12 5-7 7 7 7M5 12h16" />,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  warning: <><path d="m12 3 10 18H2Z" /><path d="M12 9v5m0 3h.01" /></>,
};
export function PortalIcon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name]}</svg>;
}

/** Same text/snowflake identity as the existing public-site brand; no generated employee imagery. */
export function FieldPortalHeader({ title, subtitle = 'Servicio que mantiene Aruba en movimiento', onBack, trailing }: { title: string; subtitle?: string; onBack?: () => void; trailing?: ReactNode }) {
  return <header className={styles.header}>
    <div className={styles.headerTop}>
      {onBack ? <button className={styles.back} type="button" onClick={onBack}><PortalIcon name="back" /><span>Volver</span></button> : null}
      <div className={styles.brand} aria-label="DEMAC ERP Next"><span><PortalIcon name="snow" /><strong>DEMAC</strong></span><small>ERP NEXT</small></div>
      {trailing ? <div className={styles.headerTrailing}>{trailing}</div> : null}
    </div>
    <div className={styles.headerCopy}><div><h1>{title}</h1><p>{subtitle}</p></div><span className={styles.slogan}>Un Aruba<br />más confortable</span></div>
  </header>;
}

export function FieldPortalNavigation({ active, onNavigate }: { active: FieldPortalTab; onNavigate: (tab: FieldPortalTab) => void }) {
  return <nav className={styles.bottomNav} aria-label="Navegación del portal">
    {([['home', 'Inicio', 'home'], ['agenda', 'Agenda', 'calendar'], ['jobs', 'Trabajos', 'work'], ['profile', 'Perfil', 'user']] as const).map(([id, label, icon]) => <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => onNavigate(id)}><PortalIcon name={icon} /><span>{label}</span></button>)}
  </nav>;
}

export function FieldPortalIdentity({ name, staffId, date, job, compact = false }: { name: string; staffId?: string; date: string; job?: FieldScheduleJob | null; compact?: boolean }) {
  const initials = (name.match(/\p{L}[\p{L}-]*/gu) || []).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'D';
  const teammates = job?.crew?.members.filter((member) => member.staffId !== staffId) ?? [];
  return <section className={`${styles.identity} ${compact ? styles.identityCompact : ''}`} aria-label="Identidad y cuadrilla asignada">
    <div className={styles.avatar} aria-label="Iniciales; foto no disponible">{initials}</div>
    <div className={styles.identityName}><strong>{name}</strong><span>{fieldRolePresentation(job?.responsibility)}</span>{teammates.length ? <div className={styles.teammates}><PortalIcon name="users" /><span>{teammates.map((member) => member.name).join(' · ')}<small>Cuadrilla asignada</small></span></div> : null}</div>
    <div className={styles.identityMeta}><span><PortalIcon name="van" />{job?.crew?.vanName || job?.vanId || 'Sin asignación confirmada'}</span><span><PortalIcon name="calendar" />{formatArubaDateKey(date, { weekday: 'short', day: 'numeric', month: 'short' })}</span></div>
  </section>;
}

export function FieldJobContext({ job }: { job: FieldScheduleJob }) {
  const status = fieldJobStatusPresentation(job);
  return <section className={styles.context} aria-label="Contexto del trabajo">
    <div className={styles.contextTop}><div className={styles.propertyPlaceholder} aria-label="Propiedad sin fotografía verificada"><PortalIcon name="home" /></div><div><span className={styles.eyebrow}>{job.customerName}</span><h2>{job.propertyName || 'Propiedad por confirmar'}</h2><span className={styles.status} data-tone={status.tone}>{status.label}</span></div></div>
    <div className={styles.contextFacts}><span><PortalIcon name="pin" />{job.address || 'Dirección no disponible'}</span><span><PortalIcon name="user" />Contacto: {job.locationSnapshot?.accessContact?.name || 'No disponible'}</span><span><PortalIcon name="work" />{fieldWorkSummary(job)}</span></div>
    <div className={styles.contextDate}><span><PortalIcon name="calendar" />{formatArubaDateKey(job.date)}</span><span><PortalIcon name="clock" />{job.time || 'Hora por confirmar'}{job.endTime ? ` – ${job.endTime}` : ''}</span></div>
  </section>;
}

export { styles as fieldPortalStyles };
