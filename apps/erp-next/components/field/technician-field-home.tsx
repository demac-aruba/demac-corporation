'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { addDaysToDateKey, arubaDateKey, arubaTimeKey, formatArubaDateKey } from '@/lib/aruba-date';
import {
  attachExistingFieldAsset,
  getFieldJob,
  getFieldSchedule,
  prepareFieldVisit,
  transitionFieldVisit,
  type FieldActiveVisitTransition,
  type FieldJobDetail,
  type FieldScheduleJob,
  type FieldVisitStatus,
} from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

type RangeKey = 'today' | 'tomorrow' | 'week';

const COMPLETED_WORK_ORDER_STATUSES = new Set(['Completada']);
const ACTIVE_VISIT_STATUSES = new Set<FieldVisitStatus>(['en_route', 'on_site', 'in_progress']);
const SCHEDULE_REVALIDATE_MS = 60_000;
const ACTIVE_TRANSITION_LABELS: Record<FieldActiveVisitTransition, string> = {
  en_route: 'En camino',
  on_site: 'Llegué',
  in_progress: 'Iniciar trabajo',
};

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

function visitStatusLabel(value?: FieldVisitStatus) {
  if (!value) return 'No iniciada';
  if (value === 'scheduled') return 'Lista para salir';
  if (value === 'en_route') return 'En camino';
  if (value === 'on_site') return 'En el sitio';
  if (value === 'in_progress') return 'En proceso';
  if (value === 'pending') return 'Pendiente';
  if (value === 'requires_return_visit') return 'Requiere segunda visita';
  if (value === 'ready_for_office_review') return 'Lista para revisión';
  if (value === 'completed') return 'Completada';
  if (value === 'no_access') return 'Sin acceso';
  return 'Cancelada';
}

function jobCompleted(job: FieldScheduleJob) {
  return job.fieldVisit?.status === 'completed' || COMPLETED_WORK_ORDER_STATUSES.has(job.status);
}

function jobInProgress(job: FieldScheduleJob) {
  return job.fieldVisit ? ACTIVE_VISIT_STATUSES.has(job.fieldVisit.status) : false;
}

function clientRequestId(prefix: string, workOrderId: string) {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `${prefix}-${workOrderId}-${random}`.slice(0, 240);
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
          <span className={`${styles.badge} ${styles.badgeBrand}`}>Campo: {visitStatusLabel(job.fieldVisit?.status)}</span>
          <span className={styles.badge}>Programación: {job.status}</span>
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

function DetailView({
  job,
  loading,
  error,
  transitionError,
  assetError,
  transitioning,
  attachingAssetId,
  onTransition,
  onAttachAsset,
  onBack,
}: {
  job: FieldJobDetail | null;
  loading: boolean;
  error: string | null;
  transitionError: string | null;
  assetError: string | null;
  transitioning: FieldActiveVisitTransition | null;
  attachingAssetId: string | null;
  onTransition: (target: FieldActiveVisitTransition) => void;
  onAttachAsset: (assetId: string) => void;
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
  const availableTransitions: FieldActiveVisitTransition[] = job.fieldVisit
    ? job.fieldVisit.availableTransitions
    : job.canPrepareVisit
      ? ['en_route']
      : [];
  const attachedAssetIds = new Set(job.visitAssets.map((visitAsset) => visitAsset.assetId));
  const knownEquipmentById = new Map(job.knownEquipment.map((equipment) => [equipment.id, equipment]));
  const mutationBusy = transitioning !== null || attachingAssetId !== null;

  return (
    <div className={styles.shell}>
      <div className={styles.detailHeader}>
        <button className={styles.back} type="button" onClick={onBack} aria-label="Volver al itinerario">←</button>
        <div className={styles.detailTitle}>
          <h1>{job.customerName}</h1>
          <p>{job.time || 'Sin hora'} · Campo: {visitStatusLabel(job.fieldVisit?.status)} · {job.workOrderId}</p>
        </div>
      </div>

      <section className={styles.section}>
        <h2>ESTADO DE LA VISITA</h2>
        <div className={styles.infoGrid}>
          <div className={styles.info}><span>Programación / Work Order</span><strong>{job.status}</strong></div>
          <div className={styles.info}><span>Estado físico en campo</span><strong>{visitStatusLabel(job.fieldVisit?.status)}</strong></div>
          {job.fieldVisit?.departedAt ? <div className={styles.info}><span>Salida registrada</span><strong>{new Date(job.fieldVisit.departedAt).toLocaleTimeString('es-AW', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Aruba' })}</strong></div> : null}
          {job.fieldVisit?.arrivedAt ? <div className={styles.info}><span>Llegada registrada</span><strong>{new Date(job.fieldVisit.arrivedAt).toLocaleTimeString('es-AW', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Aruba' })}</strong></div> : null}
          {job.fieldVisit?.startedAt ? <div className={styles.info}><span>Trabajo iniciado</span><strong>{new Date(job.fieldVisit.startedAt).toLocaleTimeString('es-AW', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Aruba' })}</strong></div> : null}
        </div>
        {availableTransitions.length ? (
          <div className={styles.visitActions}>
            {availableTransitions.map((target) => (
              <button
                className={`${styles.action} ${styles.primary}`}
                disabled={mutationBusy}
                key={target}
                onClick={() => onTransition(target)}
                type="button"
              >
                {transitioning === target ? 'Procesando…' : ACTIVE_TRANSITION_LABELS[target]}
              </button>
            ))}
          </div>
        ) : <p className={styles.helper}>No hay otra transición activa disponible para esta visita en este slice.</p>}
        {transitionError ? <div className={styles.mutationError}>{transitionError}</div> : null}
      </section>

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
            <h2>CONFIRMADO EN SITIO</h2>
            <div className={styles.infoGrid}>
              <div className={styles.info}><span>Programado</span><strong>{job.estimatedQuantity > 0 ? `${job.estimatedQuantity} A/C` : 'Cantidad desconocida'}</strong></div>
              <div className={styles.info}><span>Confirmado físicamente</span><strong>{job.visitAssets.length} A/C</strong></div>
            </div>
            {job.visitAssets.length ? job.visitAssets.map((visitAsset) => {
              const equipment = knownEquipmentById.get(visitAsset.assetId);
              return (
                <div className={styles.equipment} key={visitAsset.id}>
                  <div>
                    <strong>{visitAsset.locationLabel || equipment?.locationLabel || `A/C ${visitAsset.sequence}`}</strong>
                    <span>{[equipment?.brand, equipment?.model, equipment?.systemType].filter(Boolean).join(' · ') || 'Equipo confirmado para esta visita'}</span>
                    <span>{equipment?.btu ? `${equipment.btu} BTU` : 'BTU por confirmar'} · {visitAsset.source === 'existing_asset' ? 'Equipo CRM existente' : visitAsset.source}</span>
                  </div>
                  <div className={styles.badges}>
                    <span className={`${styles.badge} ${styles.badgeBrand}`}>Confirmado #{visitAsset.sequence}</span>
                  </div>
                </div>
              );
            }) : <p className={styles.helper}>Todavía no hay A/C confirmados físicamente para esta visita. La cantidad programada permanece intacta.</p>}
            {assetError ? <div className={styles.mutationError}>{assetError}</div> : null}
          </section>

          <section className={styles.section}>
            <h2>EQUIPOS CONOCIDOS EN ESTA PROPIEDAD</h2>
            {job.knownEquipment.length ? job.knownEquipment.map((equipment) => {
              const attached = attachedAssetIds.has(equipment.id);
              return (
                <div className={styles.equipment} key={equipment.id}>
                  <div>
                    <strong>{equipment.locationLabel || 'Ubicación no registrada'}</strong>
                    <span>{[equipment.brand, equipment.model, equipment.systemType].filter(Boolean).join(' · ') || 'Información técnica incompleta'}</span>
                    <span>{equipment.btu ? `${equipment.btu} BTU` : 'BTU por confirmar'}{equipment.refrigerant ? ` · ${equipment.refrigerant}` : ''}{equipment.voltage ? ` · ${equipment.voltage}V` : ''}</span>
                  </div>
                  <div className={styles.actions}>
                    <span className={styles.badge}>{equipment.qrCode || 'Sin QR'}</span>
                    {attached ? <span className={`${styles.badge} ${styles.badgeBrand}`}>Incluido en visita</span> : null}
                    {!attached && !equipment.active ? <span className={styles.badge}>Equipo inactivo</span> : null}
                    {!attached && equipment.active && job.canAddExistingAsset ? (
                      <button
                        className={`${styles.action} ${styles.primary}`}
                        disabled={mutationBusy}
                        onClick={() => onAttachAsset(equipment.id)}
                        type="button"
                      >
                        {attachingAssetId === equipment.id ? 'Agregando…' : 'Agregar a esta visita'}
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            }) : <div className={styles.empty}>No hay equipos registrados todavía. El alcance real se confirmará en sitio.</div>}
            {!job.canAddExistingAsset && job.fieldVisit ? <p className={styles.helper}>La disponibilidad para agregar equipos es calculada por Field Authority según el estado y la asignación actual.</p> : null}
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
  const [clockNow, setClockNow] = useState(() => new Date());
  const [jobs, setJobs] = useState<FieldScheduleJob[]>([]);
  const [jobsOwnerUserId, setJobsOwnerUserId] = useState<string | null>(null);
  const [range, setRange] = useState<RangeKey>('today');
  const [selectedWorkOrderId, setSelectedWorkOrderId] = useState<string | null>(null);
  const [selectedOwnerUserId, setSelectedOwnerUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<FieldJobDetail | null>(null);
  const [detailOwnerUserId, setDetailOwnerUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState<FieldActiveVisitTransition | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [attachingAssetId, setAttachingAssetId] = useState<string | null>(null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const scheduleRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const mutationRequestRef = useRef(0);
  const mutationLockRef = useRef<number | null>(null);
  const selectedWorkOrderRef = useRef<string | null>(null);

  const today = arubaDateKey(clockNow);
  const nowTime = arubaTimeKey(clockNow);
  const tomorrow = addDaysToDateKey(today, 1);
  const weekEnd = addDaysToDateKey(today, 6);
  // This is only a render/request ownership key. Authorization remains server-side. Including
  // role/staff/van ensures refreshPrincipal() invalidates data when the same Firebase user is
  // reassigned or reprovisioned without changing uid.
  const principalFieldIdentityKey = `${principal.userId}|${principal.role}|${principal.staffId ?? ''}|${principal.vanId ?? ''}`;

  const closeJob = useCallback(() => {
    detailRequestRef.current += 1;
    mutationRequestRef.current += 1;
    mutationLockRef.current = null;
    selectedWorkOrderRef.current = null;
    setSelectedWorkOrderId(null);
    setSelectedOwnerUserId(null);
    setDetail(null);
    setDetailOwnerUserId(null);
    setDetailError(null);
    setDetailLoading(false);
    setTransitioning(null);
    setTransitionError(null);
    setAttachingAssetId(null);
    setAssetError(null);
  }, []);

  const loadDetail = useCallback(async (workOrderId: string, background = false) => {
    const requestId = ++detailRequestRef.current;
    const requestPrincipalKey = principalFieldIdentityKey;
    if (!background) {
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailLoading(true);
    }
    setDetailError(null);
    try {
      const response = await getFieldJob(workOrderId);
      if (requestId !== detailRequestRef.current) return;
      setDetail(response.job);
      setDetailOwnerUserId(requestPrincipalKey);
    } catch (loadError) {
      if (requestId !== detailRequestRef.current) return;
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailError(loadError instanceof Error ? loadError.message : 'No se pudo abrir el trabajo.');
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }, [principalFieldIdentityKey]);

  const loadSchedule = useCallback(async (background = false) => {
    const requestId = ++scheduleRequestRef.current;
    const requestPrincipalKey = principalFieldIdentityKey;
    // Assigned work is authorization-sensitive. Foreground loads hide previous data immediately;
    // background revalidation may keep it only while the same server request is in flight. Any
    // failure still clears prior assignments rather than preserving stale access indefinitely.
    if (!background) {
      setJobs([]);
      setJobsOwnerUserId(null);
      setLoading(true);
    }
    setScheduleError(null);
    try {
      const response = await getFieldSchedule(today, weekEnd);
      if (requestId !== scheduleRequestRef.current) return;
      setJobs(response.jobs);
      setJobsOwnerUserId(requestPrincipalKey);

      const selectedId = selectedWorkOrderRef.current;
      if (selectedId) {
        if (response.jobs.some((job) => job.workOrderId === selectedId)) {
          void loadDetail(selectedId, true);
        } else {
          closeJob();
        }
      }
    } catch (loadError) {
      if (requestId !== scheduleRequestRef.current) return;
      setJobs([]);
      setJobsOwnerUserId(null);
      closeJob();
      setScheduleError(loadError instanceof Error ? loadError.message : 'No se pudo cargar el itinerario del técnico.');
    } finally {
      if (requestId === scheduleRequestRef.current) setLoading(false);
    }
  }, [closeJob, loadDetail, principalFieldIdentityKey, today, weekEnd]);

  const runVisitTransition = useCallback(async (target: FieldActiveVisitTransition) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail) return;

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setTransitioning(target);
    setTransitionError(null);
    setAssetError(null);
    try {
      let visit = currentDetail.fieldVisit;
      if (!visit) {
        if (!currentDetail.canPrepareVisit || target !== 'en_route') {
          throw new Error('La visita todavía no está disponible para esta transición. Actualiza el trabajo e intenta nuevamente.');
        }
        const prepared = await prepareFieldVisit(workOrderId, clientRequestId('prepare', workOrderId));
        if (mutationId !== mutationRequestRef.current) return;
        visit = prepared.visit;
      }

      const transitioned = await transitionFieldVisit(
        visit.id,
        target,
        visit.version,
        clientRequestId(`transition-${target}`, workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;

      setDetail((current) => current?.workOrderId === workOrderId
        ? { ...current, fieldVisit: transitioned.visit, canPrepareVisit: false }
        : current);
      setTransitionError(null);
      void loadSchedule(true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setTransitionError(mutationError instanceof Error ? mutationError.message : 'No se pudo actualizar el estado de la visita.');
      // A timeout may occur after the server committed. Re-read authority instead of guessing or
      // applying an optimistic local transition.
      void loadDetail(workOrderId, true);
      void loadSchedule(true);
    } finally {
      if (mutationId === mutationRequestRef.current) setTransitioning(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [detail, detailOwnerUserId, loadDetail, loadSchedule, principalFieldIdentityKey]);

  const runAttachAsset = useCallback(async (assetId: string) => {
    if (mutationLockRef.current !== null) return;
    const currentDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    if (!currentDetail?.fieldVisit) {
      setAssetError('La visita todavía no está disponible para confirmar equipos en sitio.');
      return;
    }
    if (!currentDetail.canAddExistingAsset) {
      setAssetError('Field Authority no autoriza agregar equipos en el estado o asignación actual.');
      return;
    }
    if (currentDetail.visitAssets.some((visitAsset) => visitAsset.assetId === assetId)) return;

    const mutationId = ++mutationRequestRef.current;
    mutationLockRef.current = mutationId;
    const workOrderId = currentDetail.workOrderId;
    setAttachingAssetId(assetId);
    setAssetError(null);
    setTransitionError(null);
    try {
      await attachExistingFieldAsset(
        currentDetail.fieldVisit.id,
        assetId,
        clientRequestId('attach-asset', workOrderId),
      );
      if (mutationId !== mutationRequestRef.current) return;
      // Re-read the entire canonical job. VisitAsset is additive truth and another technician/device
      // may have changed actual scope concurrently; the client must not reconstruct that collection.
      await loadDetail(workOrderId, true);
    } catch (mutationError) {
      if (mutationId !== mutationRequestRef.current) return;
      setAssetError(mutationError instanceof Error ? mutationError.message : 'No se pudo agregar el A/C a esta visita.');
      // A timeout may occur after the transaction committed. Re-read instead of retrying blindly or
      // inventing an optimistic VisitAsset record in browser state.
      void loadDetail(workOrderId, true);
    } finally {
      if (mutationId === mutationRequestRef.current) setAttachingAssetId(null);
      if (mutationLockRef.current === mutationId) mutationLockRef.current = null;
    }
  }, [detail, detailOwnerUserId, loadDetail, principalFieldIdentityKey]);

  useEffect(() => {
    void loadSchedule();
    return () => { scheduleRequestRef.current += 1; };
  }, [loadSchedule]);

  useEffect(() => {
    const revalidate = () => {
      setClockNow(new Date());
      if (document.visibilityState === 'visible') void loadSchedule(true);
    };
    const handleFocus = () => revalidate();
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') revalidate();
    };
    const timer = window.setInterval(revalidate, SCHEDULE_REVALIDATE_MS);
    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [loadSchedule]);

  useEffect(() => {
    // A Field identity transition invalidates any selected detail immediately, even if an older
    // request resolves later. Render guards below prevent even a one-frame stale disclosure.
    closeJob();
  }, [closeJob, principalFieldIdentityKey]);

  useEffect(() => {
    if (!selectedWorkOrderId || selectedOwnerUserId !== principalFieldIdentityKey) {
      setDetail(null);
      setDetailOwnerUserId(null);
      setDetailError(null);
      setDetailLoading(false);
      return undefined;
    }
    void loadDetail(selectedWorkOrderId);
    return () => { detailRequestRef.current += 1; };
  }, [loadDetail, principalFieldIdentityKey, selectedOwnerUserId, selectedWorkOrderId]);

  const authorizedJobs = jobsOwnerUserId === principalFieldIdentityKey ? jobs : [];
  const todayJobs = useMemo(() => authorizedJobs.filter((job) => job.date === today), [authorizedJobs, today]);
  const summary = useMemo(() => {
    const completed = todayJobs.filter(jobCompleted).length;
    const inProgress = todayJobs.filter(jobInProgress).length;
    return { scheduled: todayJobs.length, completed, inProgress, remaining: Math.max(0, todayJobs.length - completed) };
  }, [todayJobs]);

  const visibleJobs = useMemo(() => {
    if (range === 'today') return authorizedJobs.filter((job) => job.date === today);
    if (range === 'tomorrow') return authorizedJobs.filter((job) => job.date === tomorrow);
    return authorizedJobs;
  }, [authorizedJobs, range, today, tomorrow]);

  const nextJob = useMemo(() => {
    const open = todayJobs.filter((job) => !jobCompleted(job));
    const active = open.find(jobInProgress);
    if (active) return active;
    return open.find((job) => job.time && job.time >= nowTime) ?? open[0] ?? null;
  }, [nowTime, todayJobs]);

  const openJob = (workOrderId: string) => {
    selectedWorkOrderRef.current = workOrderId;
    setSelectedOwnerUserId(principalFieldIdentityKey);
    setSelectedWorkOrderId(workOrderId);
  };

  if (selectedWorkOrderId && selectedOwnerUserId === principalFieldIdentityKey) {
    const authorizedDetail = detailOwnerUserId === principalFieldIdentityKey ? detail : null;
    return (
      <DetailView
        job={authorizedDetail}
        loading={detailLoading}
        error={detailError}
        transitionError={transitionError}
        assetError={assetError}
        transitioning={transitioning}
        attachingAssetId={attachingAssetId}
        onTransition={(target) => void runVisitTransition(target)}
        onAttachAsset={(assetId) => void runAttachAsset(assetId)}
        onBack={closeJob}
      />
    );
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
        {loading ? <div className={styles.loading}>Cargando ruta asignada…</div> : nextJob ? <div className={styles.next}><JobCard job={nextJob} onOpen={() => openJob(nextJob.workOrderId)} /></div> : <div className={styles.empty}>No quedan trabajos activos asignados para hoy.</div>}
      </section> : null}

      <section className={styles.panel}>
        <div className={styles.panelHead}>
          <h2>{range === 'today' ? 'Hoy' : range === 'tomorrow' ? 'Mañana' : 'Próximos 7 días'}</h2>
          <span>{loading ? 'Cargando…' : `${visibleJobs.length} trabajo${visibleJobs.length === 1 ? '' : 's'}`}</span>
        </div>
        {loading ? <div className={styles.loading}>Cargando itinerario autorizado…</div> : visibleJobs.length ? visibleJobs.map((job) => <JobCard key={job.workOrderId} job={job} onOpen={() => openJob(job.workOrderId)} />) : <div className={styles.empty}>No hay trabajos asignados en este período.</div>}
      </section>
    </div>
  );
}
