'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { addDaysToDateKey, arubaDateKey, arubaTimeKey, formatArubaDateKey } from '@/lib/aruba-date';
import {
  getFieldJob,
  getFieldSchedule,
  type FieldJobDetail,
  type FieldScheduleJob,
} from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

type RangeKey = 'today' | 'tomorrow' | 'week';

const COMPLETED_STATUSES = new Set(['Completada']);
const IN_PROGRESS_STATUSES = new Set(['En camino', 'En el sitio', 'En proceso']);

function workSummary(job: Pick<FieldScheduleJob, 'plannedWork' | 'customerFacingDescription'>) {
  if (job.plannedWork.length) {
    return job.plannedWork.map((line) => `${line.quantity} × ${line.label}`).join(' · ');
  }
  return job.customerFacingDescription || 'Trabajo programado';
}

function roleLabel(value: FieldScheduleJob['responsibility']) {
  if (value === 'lead') return 'Líder';
  if (value === 'helper') return 'Ayudante';
  if (value === 'office') return 'Oficina';
  return 'Técnico';
}

function assignmentLabel(value: FieldScheduleJob['assignmentSource']) {
  if (value === 'daily_assignment') return 'Equipo del día';
  if (value === 'regular_crew') return 'Equipo regular';
  if (value === 'direct_staff') return 'Asignación directa';
  if (value === 'profile_van_fallback') return 'Van · solo lectura';
  return 'Oficina';
}

function whatsappDigits(value?: string) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 7 ? `297${digits}` : digits;
}

function callHref(value?: string) {
  const raw = String(value ?? '').trim();
  return raw ? `tel:${raw.replace(/[^+\d]/g, '')}` : '';
}

function whatsappHref(value?: string) {
  const digits = whatsappDigits(value);
  return digits ? `https://wa.me/${digits}` : '';
}

function mapHref(job: Pick<FieldScheduleJob, 'latitude' | 'longitude' | 'address'>) {
  const query = Number.isFinite(job.latitude) && Number.isFinite(job.longitude)
    ? `${job.latitude},${job.longitude}`
    : job.address;
  return query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : '';
}

function contactLinks(job: FieldScheduleJob) {
  return {
    call: callHref(job.arrivalPhone),
    whatsapp: whatsappHref(job.arrivalWhatsapp || job.arrivalPhone),
    map: mapHref(job),
  };
}

function JobActions({ job, onOpen }: { job: FieldScheduleJob; onOpen: () => void }) {
  const links = contactLinks(job);
  return (
    <div className={styles.actions}>
      <button className={`${styles.action} ${styles.primary}`} type="button" onClick={onOpen}>Abrir</button>
      {links.map ? <a className={styles.action} href={links.map} target="_blank" rel="noreferrer">Navegar</a> : null}
      {links.call ? <a className={styles.action} href={links.call}>Llamar</a> : null}
      {links.whatsapp ? <a className={styles.action} href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null}
    </div>
  );
}

function JobCard({ job, onOpen }: { job: FieldScheduleJob; onOpen: () => void }) {
  return (
    <article className={styles.jobCard}>
      <div className={styles.time}>{job.time || '—'}<small>{job.endTime ? `hasta ${job.endTime}` : job.status}</small></div>
      <div className={styles.jobMain}>
        <strong>{job.customerName}</strong>
        <div className={styles.address}>{job.propertyName ? `${job.propertyName} · ` : ''}{job.address || 'Dirección no disponible'}</div>
        <div className={styles.work}>{workSummary(job)}</div>
        <div className={styles.badges}>
          <span className={`${styles.badge} ${styles.badgeBrand}`}>{job.status}</span>
          <span className={styles.badge}>{job.vanId || 'Sin van'}</span>
          <span className={styles.badge}>{roleLabel(job.responsibility)}</span>
          <span className={styles.badge}>{assignmentLabel(job.assignmentSource)}</span>
          <span className={styles.badge}>{job.estimatedQuantity > 0 ? `${job.estimatedQuantity} A/C estimado` : 'Cantidad por confirmar'}</span>
        </div>
      </div>
      <JobActions job={job} onOpen={onOpen} />
    </article>
  );
}

function DetailView({ job, loading, error, onBack }: {
  job: FieldJobDetail | null;
  loading: boolean;
  error: string | null;
  onBack: () => void;
}) {
  if (loading || error || !job) {
    return (
      <div className={styles.shell}>
        <div className={styles.detailHeader}>
          <button className={styles.back} type="button" onClick={onBack} aria-label="Volver al itinerario">←</button>
          <div className={styles.detailTitle}>
            <h1>Detalle del trabajo</h1>
            <p>{loading ? 'Cargando…' : 'No disponible'}</p>
          </div>
        </div>
        <section className={styles.panel}>
          <div className={error ? styles.error : styles.loading}>
            {loading ? 'Cargando información del trabajo…' : error || 'No se pudo abrir este trabajo.'}
          </div>
        </section>
      </div>
    );
  }

  const links = contactLinks(job);
  return (
    <div className={styles.shell}>
      <div className={styles.detailHeader}>
        <button className={styles.back} type="button" onClick={onBack} aria-label="Volver al itinerario">←</button>
        <div className={styles.detailTitle}>
          <h1>{job.customerName}</h1>
          <p>{job.time || 'Sin hora'} · {job.status} · {job.workOrderId}</p>
        </div>
      </div>

      <div className={styles.detailGrid}>
        <div>
          <section className={styles.section}>
            <h2>PROGRAMADO POR LA OFICINA</h2>
            <div className={styles.planned}>
              <div className={styles.plannedTitle}>Alcance planificado · no se modifica en campo</div>
              {job.plannedWork.length ? job.plannedWork.map((line) => (
                <div className={styles.plannedItem} key={line.id}><span>{line.label}</span><strong>{line.quantity}×</strong></div>
              )) : <p className={styles.helper}>No hay líneas programadas estructuradas. Revisa la descripción del cliente.</p>}
            </div>
            <div className={styles.infoGrid} style={{ marginTop: 12 }}>
              <div className={styles.info}><span>Cantidad estimada</span><strong>{job.estimatedQuantity > 0 ? `${job.estimatedQuantity} A/C` : 'Por confirmar en sitio'}</strong></div>
              <div className={styles.info}><span>Asignación</span><strong>{roleLabel(job.responsibility)} · {assignmentLabel(job.assignmentSource)}</strong></div>
            </div>
            {job.customerFacingDescription ? <p className={styles.helper}>{job.customerFacingDescription}</p> : null}
          </section>

          <section className={styles.section}>
            <h2>EQUIPOS CONOCIDOS EN ESTA PROPIEDAD</h2>
            {job.knownEquipment.length ? job.knownEquipment.map((equipment) => (
              <div className={styles.equipment} key={equipment.id}>
                <div>
                  <strong>{equipment.locationLabel || 'Ubicación no registrada'}</strong>
                  <span>{[equipment.brand, equipment.model, equipment.systemType].filter(Boolean).join(' · ') || 'Información técnica incompleta'}</span>
                  <span>{equipment.btu ? `${equipment.btu} BTU` : 'BTU por confirmar'}{equipment.refrigerant ? ` · ${equipment.refrigerant}` : ''}{equipment.voltage ? ` · ${equipment.voltage}V` : ''}</span>
                </div>
                <span>{equipment.qrCode || 'Sin QR'}</span>
              </div>
            )) : <div className={styles.empty}>No hay equipos registrados todavía. El alcance real se confirmará en sitio.</div>}
          </section>
        </div>

        <aside>
          <section className={styles.section}>
            <h2>CLIENTE Y UBICACIÓN</h2>
            <div className={styles.infoGrid}>
              <div className={styles.info}><span>Propiedad</span><strong>{job.propertyName || 'Sin nombre'}</strong></div>
              <div className={styles.info}><span>Van</span><strong>{job.vanId || 'Sin van'}</strong></div>
              <div className={styles.info} style={{ gridColumn: '1 / -1' }}><span>Dirección</span><strong>{job.address || 'No disponible'}</strong></div>
            </div>
            <div className={styles.contactActions}>
              {links.map ? <a href={links.map} target="_blank" rel="noreferrer">Navegar</a> : null}
              {links.call ? <a href={links.call}>Llamar</a> : null}
              {links.whatsapp ? <a href={links.whatsapp} target="_blank" rel="noreferrer">WhatsApp</a> : null}
            </div>
          </section>

          <section className={styles.section}>
            <h2>INSTRUCCIONES</h2>
            <div className={styles.info}><span>Acceso</span><strong>{job.accessInstructions || 'Sin instrucciones especiales'}</strong></div>
            <div className={styles.info} style={{ marginTop: 10 }}><span>Nota para técnico</span><strong>{job.technicianInstructions || 'Sin instrucciones adicionales'}</strong></div>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function TechnicianFieldHome() {
  const { principal } = useAuth();
  const [jobs, setJobs] = useState<FieldScheduleJob[]>([]);
  const [range, setRange] = useState<RangeKey>('today');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FieldJobDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const today = arubaDateKey();
  const tomorrow = addDaysToDateKey(today, 1);
  const weekEnd = addDaysToDateKey(today, 6);

  const loadSchedule = useCallback(async () => {
    setLoading(true);
    setScheduleError(null);
    try {
      const response = await getFieldSchedule(today, weekEnd);
      setJobs(response.jobs);
    } catch (loadError) {
      setScheduleError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el itinerario del técnico.');
    } finally {
      setLoading(false);
    }
  }, [today, weekEnd]);

  useEffect(() => { void loadSchedule(); }, [loadSchedule]);

  useEffect(() => {
    if (!selectedWorkOrderId) {
      setDetail(null);
      setDetailError(null);
      return undefined;
    }
    let active = true;
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    void getFieldJob(selectedWorkOrderId)
      .then((response) => { if (active) setDetail(response.job); })
      .catch((loadError) => { if (active) setDetailError(loadError instanceof Error ? loadError.message : 'No se pudo abrir el trabajo.'); })
      .finally(() => { if (active) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedWorkOrderId]);

  const todayJobs = useMemo(() => jobs.filter((job) => job.date === today), [jobs, today]);
  const summary = useMemo(() => {
    const completed = todayJobs.filter((job) => COMPLETED_STATUSES.has(job.status)).length;
    const inProgress = todayJobs.filter((job) => IN_PROGRESS_STATUSES.has(job.status)).length;
    return { scheduled: todayJobs.length, completed, inProgress, remaining: Math.max(0, todayJobs.length - completed) };
  }, [todayJobs]);

  const visibleJobs = useMemo(() => {
    if (range === 'today') return jobs.filter((job) => job.date === today);
    if (range === 'tomorrow') return jobs.filter((job) => job.date === tomorrow);
    return jobs;
  }, [jobs, range, today, tomorrow]);

  const nextJob = useMemo(() => {
    const open = todayJobs.filter((job) => !COMPLETED_STATUSES.has(job.status));
    const active = open.find((job) => IN_PROGRESS_STATUSES.has(job.status));
    if (active) return active;
    const now = arubaTimeKey();
    return open.find((job) => job.time && job.time >= now) ?? open[0] ?? null;
  }, [todayJobs]);

  if (selectedWorkOrderId) {
    return <DetailView job={detail} loading={detailLoading} error={detailError} onBack={() => setSelectedWorkOrderId(null)} />;
  }

  return (
    <div className={styles.shell}>
      <header className={styles.head}>
        <div><div className={styles.eyebrow}>DEMAC · Trabajo de campo</div><h1>Mi ruta de trabajo</h1></div>
        <div className={styles.identity}>{principal.displayName}{principal.staffId ? ` · ${principal.staffId}` : ''}</div>
      </header>

      <div className={styles.tabs} role="tablist" aria-label="Período del itinerario">
        <button className={`${styles.tab} ${range === 'today' ? styles.tabActive : ''}`} type="button" onClick={() => setRange('today')}>Hoy</button>
        <button className={`${styles.tab} ${range === 'tomorrow' ? styles.tabActive : ''}`} type="button" onClick={() => setRange('tomorrow')}>Mañana</button>
        <button className={`${styles.tab} ${range === 'week' ? styles.tabActive : ''}`} type="button" onClick={() => setRange('week')}>Semana</button>
      </div>

      <section className={styles.summary} aria-label="Resumen de hoy">
        <div className={styles.metric}><strong>{summary.scheduled}</strong><span>Programados hoy</span></div>
        <div className={styles.metric}><strong>{summary.completed}</strong><span>Completados</span></div>
        <div className={styles.metric}><strong>{summary.inProgress}</strong><span>En curso</span></div>
        <div className={styles.metric}><strong>{summary.remaining}</strong><span>Restantes</span></div>
      </section>

      {scheduleError ? <section className={styles.panel}><div className={styles.error}>{scheduleError}<div style={{ marginTop: 12 }}><button className={styles.action} type="button" onClick={() => void loadSchedule()}>Reintentar</button></div></div></section> : null}

      {range === 'today' ? <section className={styles.panel}>
        <div className={styles.panelHead}><h2>Próximo trabajo</h2><span>{formatArubaDateKey(today, { weekday: 'long', month: 'long', day: 'numeric' })}</span></div>
        {loading ? <div className={styles.loading}>Cargando ruta asignada…</div> : nextJob ? <div className={styles.next}><JobCard job={nextJob} onOpen={() => setSelectedWorkOrderId(nextJob.workOrderId)} /></div> : <div className={styles.empty}>No quedan trabajos activos asignados para hoy.</div>}
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>{range === 'today' ? 'Hoy' : range === 'tomorrow' ? 'Mañana' : 'Próximos 7 días'}</h2>
          <span>{loading ? 'Cargando…' : `${visibleJobs.length} trabajo${visibleJobs.length === 1 ? '' : 's'}`}</span>
        </div>
        {loading ? <div className={styles.loading}>Cargando itinerario autorizado…</div> : visibleJobs.length ? visibleJobs.map((job) => <JobCard key={job.workOrderId} job={job} onOpen={() => setSelectedWorkOrderId(job.workOrderId)} />) : <div className={styles.empty}>No hay trabajos asignados en este período.</div>}
      </section>
    </div>
  );
}