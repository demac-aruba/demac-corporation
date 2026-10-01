'use client';

import type { ReactNode } from 'react';
import type { FieldScheduleJob } from '../../lib/field-authority-contract';
import { fieldDaySummary, fieldJobStatusPresentation, fieldWorkSummary } from '../../lib/field-portal-presentation';
import { isFieldJobInProgress } from '../../lib/field-ui-flow';
import { FieldPortalHeader, FieldPortalIdentity, PortalIcon, fieldPortalStyles as styles, type FieldPortalTab } from './field-portal-chrome';

export type FieldDayOverviewProps = {
  tab: FieldPortalTab;
  identity: { displayName: string; staffId?: string };
  date: string;
  jobs: readonly FieldScheduleJob[];
  nextJob: FieldScheduleJob | null;
  loading: boolean;
  error: string | null;
  stale: boolean;
  synchronization?: ReactNode;
  onRetry: () => void;
  onOpen: (workOrderId: string) => void;
  onNavigate: (tab: FieldPortalTab) => void;
  onSignOut: () => void;
};

function WorkRow({ job, onOpen }: { job: FieldScheduleJob; onOpen: (id: string) => void }) {
  const status = fieldJobStatusPresentation(job);
  return <button className={styles.workRow} type="button" onClick={() => onOpen(job.workOrderId)} aria-label={`Abrir trabajo: ${job.propertyName || job.customerName}`}>
    <span className={styles.rowStatusIcon} data-tone={status.tone}><PortalIcon name={status.tone === 'green' ? 'check' : 'clock'} /></span>
    <span className={styles.rowTime}>{job.time || 'Sin hora'}{job.endTime ? <small>{job.endTime}</small> : null}</span>
    <span className={styles.rowInfo}><strong>{job.propertyName || job.customerName}</strong><span>{job.customerName}</span><small>{fieldWorkSummary(job)}</small><span className={styles.status} data-tone={status.tone}>{status.label}</span></span>
    <PortalIcon name="chevron" />
  </button>;
}

export function FieldDayOverview({ tab, identity, date, jobs, nextJob, loading, error, stale, synchronization, onRetry, onOpen, onNavigate, onSignOut }: FieldDayOverviewProps) {
  const summary = fieldDaySummary(jobs);
  const anchor = nextJob || jobs[0] || null;
  const title = tab === 'home' ? 'Portal del Técnico' : tab === 'agenda' ? 'Mi agenda' : tab === 'profile' ? 'Mi perfil' : 'Mis trabajos';
  const count = (value: number) => loading && !jobs.length || error && !jobs.length ? '—' : value;
  return <div className={styles.portal}>
    <FieldPortalHeader title={title} trailing={<button className={styles.headerRefresh} type="button" onClick={onRetry} disabled={loading} aria-label="Actualizar agenda"><PortalIcon name="refresh" /></button>} />
    <main className={styles.surface}>
      <FieldPortalIdentity name={identity.displayName} staffId={identity.staffId} date={date} job={anchor} />
      {stale ? <div className={styles.notice} role="status"><PortalIcon name="info" /><span>Copia sin conexión. El estado del servidor debe confirmarse antes de continuar.</span></div> : null}
      {synchronization}
      {error ? <section className={styles.error} role="alert"><PortalIcon name="warning" /><div><strong>No se pudo actualizar la agenda</strong><p>{error}</p><button className={styles.secondary} type="button" onClick={onRetry}>Reintentar</button></div></section> : null}
      {tab === 'profile' ? <>
        <section className={styles.profilePanel}><h2>Tu cuenta de campo</h2><p>Tu identidad es personal. La cuadrilla mostrada corresponde a la asignación de la visita, no a una cuenta compartida de van.</p><div className={styles.notice}><PortalIcon name="lock" /><span>Solo puedes consultar y trabajar dentro de tus permisos actuales.</span></div><button className={styles.secondary} type="button" onClick={onRetry}><PortalIcon name="refresh" />Actualizar mi agenda</button><button className={styles.signOut} type="button" onClick={onSignOut}><PortalIcon name="logout" />Cerrar sesión</button></section>
      </> : <>
        <section className={styles.summary} aria-label="Resumen de trabajos de hoy"><div><PortalIcon name="work" /><span><strong>{count(summary.total)}</strong><small>trabajos hoy</small></span></div><div data-tone="green"><PortalIcon name="check" /><span><strong>{count(summary.finished + summary.sent)}</strong><small>terminados / enviados</small></span></div><div data-tone="amber"><PortalIcon name="clock" /><span><strong>{count(summary.pending)}</strong><small>pendientes</small></span></div></section>
        <p className={styles.summaryNote}>Terminado en campo o enviado no significa aprobado por oficina.</p>
        {tab === 'home' ? <>
          {nextJob ? <button className={styles.primary} type="button" onClick={() => onOpen(nextJob.workOrderId)}><PortalIcon name="play" />{isFieldJobInProgress(nextJob) ? 'Continuar trabajo' : 'Abrir próximo trabajo'}<PortalIcon name="chevron" /></button> : null}
          <button className={styles.secondary} type="button" onClick={() => onNavigate('agenda')}><PortalIcon name="calendar" />Ver agenda completa<PortalIcon name="chevron" /></button>
          {nextJob ? <section className={styles.nextCard}><header><span><PortalIcon name="clock" />{isFieldJobInProgress(nextJob) ? 'Trabajo en curso' : 'Próximo trabajo'}</span><span>{nextJob.time || 'Sin hora'}</span></header><div className={styles.nextBody}><div><h2>{nextJob.propertyName || nextJob.customerName}</h2><p>{nextJob.customerName}</p><p><PortalIcon name="pin" />{nextJob.address || 'Dirección no disponible'}</p>{nextJob.locationSnapshot?.accessContact?.name ? <p><PortalIcon name="user" />{nextJob.locationSnapshot.accessContact.name}</p> : null}<p><PortalIcon name="work" />{fieldWorkSummary(nextJob)}</p></div><div className={styles.propertyPlaceholder} aria-label="Sin fotografía verificada"><PortalIcon name="home" /></div></div><button className={styles.primary} type="button" onClick={() => onOpen(nextJob.workOrderId)}><PortalIcon name="play" />Abrir trabajo</button></section> : null}
        </> : null}
        <section className={styles.todaySection} aria-label="Trabajos del día"><div className={styles.sectionTitle}><h2>{tab === 'home' ? 'Trabajos de hoy' : tab === 'agenda' ? 'Agenda de hoy' : 'Trabajos y seguimiento'}</h2><span>Solo hoy · Aruba</span></div>
          {loading && !jobs.length ? <div className={styles.empty} role="status"><PortalIcon name="refresh" /><strong>Cargando tus trabajos…</strong></div> : jobs.length ? jobs.map((job) => <WorkRow key={job.workOrderId} job={job} onOpen={onOpen} />) : !error ? <div className={styles.empty}><PortalIcon name="calendar" /><strong>No tienes trabajos asignados para hoy</strong><p>Los trabajos aparecerán cuando oficina confirme tu asignación.</p></div> : null}
        </section>
      </>}
      <footer className={styles.motto}><PortalIcon name="snow" /><span>Aires acondicionados.<br />Gente más feliz.</span><strong>DEMAC<small>ARUBA</small></strong></footer>
    </main>
  </div>;
}
