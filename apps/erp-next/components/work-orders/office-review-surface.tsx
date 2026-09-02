'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import {
  decideFieldOfficeReview,
  getFieldOfficeReviewQueue,
  type FieldOfficeReviewDecision,
  type FieldOfficeReviewQueueItem,
} from '@/lib/field-authority';
import { BrowserOfficeReviewQueue } from './browser-office-review-queue';
import styles from './browser-office-review-queue.module.css';

function requestId(reviewId: string, decision: FieldOfficeReviewDecision) {
  const random = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  return `office-review-${decision}-${reviewId}-${random}`.slice(0, 240);
}

function reviewStatusLabel(status: FieldOfficeReviewQueueItem['status']) {
  if (status === 'returned') return 'devuelta';
  if (status === 'approved') return 'aprobada';
  return 'pendiente';
}

function reportStatusLabel(status: FieldOfficeReviewQueueItem['currentRevision']['snapshot']['professionalReportPreview']['status']) {
  if (status === 'field_complete') return 'Campo completo';
  if (status === 'incomplete_report') return 'Reporte incompleto';
  if (status === 'partial') return 'Trabajo parcial';
  return 'En proceso';
}

type FrozenReport = FieldOfficeReviewQueueItem['currentRevision']['snapshot']['reports'][number];

function sectionTypeLabel(type: FrozenReport['template']['sections'][number]['type']) {
  if (type === 'measurement_table') return 'Mediciones';
  if (type === 'findings') return 'Hallazgos';
  if (type === 'photos') return 'Fotos';
  if (type === 'free_text') return 'Texto técnico';
  if (type === 'voice_note') return 'Nota de voz';
  if (type === 'customer_acknowledgement') return 'Confirmación del cliente';
  return 'Checklist';
}

function sectionStatusLabel(status: FrozenReport['sectionStatus'][string]) {
  if (status === 'completed') return 'completa';
  if (status === 'in_progress') return 'en progreso';
  return 'pendiente';
}

function FrozenReportContent({ review }: { review: FieldOfficeReviewQueueItem }) {
  const snapshot = review.currentRevision.snapshot;
  const interventionById = new Map(snapshot.interventions.map((entry) => [entry.id, entry]));
  const visitAssetById = new Map(snapshot.visitAssets.map((entry) => [entry.id, entry]));
  if (!snapshot.reports.length) {
    return <div className={styles.reportEmpty}>Esta revisión no contiene reportes técnicos congelados.</div>;
  }
  return (
    <section className={styles.frozenReports}>
      <div className={styles.frozenReportsHead}>
        <span>CONTENIDO TÉCNICO CONGELADO · OFFICE REVIEW</span>
        <strong>{snapshot.reports.length} reporte(s) inmutable(s)</strong>
        <p>Esta vista pertenece a la revisión enviada. No cambia si la información operativa se modifica después.</p>
      </div>
      {snapshot.reports.map((report) => {
        const intervention = interventionById.get(report.interventionId);
        const visitAsset = visitAssetById.get(report.visitAssetId);
        return (
          <article className={styles.frozenReport} key={report.interventionId}>
            <header>
              <div>
                <span>{visitAsset?.locationLabel || report.assetId}</span>
                <strong>{intervention?.interventionType || report.template.name}</strong>
                <small>{report.template.name} · plantilla v{report.template.version}</small>
              </div>
              <b>{report.completion.completedRequiredSectionCount}/{report.completion.requiredSectionCount} obligatorias</b>
            </header>
            <div className={styles.reportSections}>
              {report.template.sections.map((section) => {
                const photos = report.evidence.filter((item) => item.sectionId === section.id);
                const measurements = report.measurements.filter((item) => item.sectionId === section.id);
                const findings = report.findings.filter((item) => item.sectionId === section.id);
                const checklist = report.checklistResponses.filter((item) => item.sectionId === section.id);
                const freeText = report.freeTextResponses.filter((item) => item.sectionId === section.id);
                const acknowledgements = report.customerAcknowledgements.filter((item) => item.sectionId === section.id);
                const voices = report.voiceNotes.filter((item) => item.sectionId === section.id);
                return (
                  <section className={styles.reportSection} key={section.id}>
                    <div className={styles.reportSectionHead}>
                      <div><strong>{section.title}</strong><small>{sectionTypeLabel(section.type)}{section.required ? ' · obligatoria' : ' · opcional'}</small></div>
                      <b data-status={report.sectionStatus[section.id]}>{sectionStatusLabel(report.sectionStatus[section.id])}</b>
                    </div>
                    {section.type === 'checklist' ? (
                      <ul>{(section.checklistItems ?? []).map((item) => {
                        const response = checklist.find((entry) => entry.itemId === item.id);
                        return <li key={item.id}><strong>{response?.checked ? '✓' : '—'} {item.label}</strong><small>{response ? `Registrado ${new Date(response.respondedAt).toLocaleString('es-AW')}` : 'Sin respuesta'}</small></li>;
                      })}</ul>
                    ) : null}
                    {measurements.length ? <ul>{measurements.map((item) => <li key={item.id}><strong>{item.metric}: {item.value} {item.unit}</strong><small>{item.moment} · {new Date(item.measuredAt).toLocaleString('es-AW')}</small></li>)}</ul> : null}
                    {findings.length ? <ul>{findings.map((item) => <li key={item.id}><strong>{item.summary}</strong><small>{item.details}{item.recommendation ? ` · Recomendación: ${item.recommendation}` : ''}</small></li>)}</ul> : null}
                    {freeText.length ? <ul>{freeText.map((item) => <li key={item.id}><strong>{item.value}</strong><small>Registrado {new Date(item.respondedAt).toLocaleString('es-AW')}</small></li>)}</ul> : null}
                    {photos.length ? <ul>{photos.map((item) => <li key={item.id}><strong>{item.caption || 'Foto técnica'}</strong><small>Referencia inmutable: {item.storagePath} · {new Date(item.capturedAt).toLocaleString('es-AW')}</small></li>)}</ul> : null}
                    {voices.length ? <ul>{voices.map((item) => <li key={item.id}><strong>Nota de voz · {item.durationSeconds}s</strong><small>Referencia inmutable: {item.storagePath} · {new Date(item.capturedAt).toLocaleString('es-AW')}</small></li>)}</ul> : null}
                    {acknowledgements.length ? <ul>{acknowledgements.map((item) => <li key={item.id}><strong>Confirmado verbalmente por {item.receiverName}</strong><small>{item.note || 'Sin nota adicional'} · {new Date(item.acknowledgedAt).toLocaleString('es-AW')}</small></li>)}</ul> : null}
                  </section>
                );
              })}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function CanonicalOfficeReviewQueue() {
  const [reviews, setReviews] = useState<FieldOfficeReviewQueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<FieldOfficeReviewDecision | null>(null);
  const operationRef = useRef<{ signature: string; requestId: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await getFieldOfficeReviewQueue();
      setReviews(response.reviews);
      setSelectedId((current) => response.reviews.some((review) => review.id === current)
        ? current
        : response.reviews.find((review) => review.status === 'pending')?.id ?? response.reviews[0]?.id ?? null);
    } catch (loadError) {
      setReviews([]);
      setSelectedId(null);
      setError(loadError instanceof Error ? loadError.message : 'No se pudo cargar Office Review.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => reviews.find((review) => review.id === selectedId) ?? null,
    [reviews, selectedId],
  );
  const pending = reviews.filter((review) => review.status === 'pending').length;

  const decide = useCallback(async (decision: FieldOfficeReviewDecision) => {
    if (!selected || selected.status !== 'pending' || deciding) return;
    const normalizedNote = note.trim();
    if (decision === 'return' && normalizedNote.length < 3) {
      setError('Escribe una nota clara para devolver el reporte al técnico.');
      return;
    }
    const signature = `${selected.id}|${selected.version}|${decision}|${normalizedNote}`;
    const stableRequestId = operationRef.current?.signature === signature
      ? operationRef.current.requestId
      : requestId(selected.id, decision);
    operationRef.current = { signature, requestId: stableRequestId };
    setDeciding(decision);
    setError(null);
    try {
      const result = await decideFieldOfficeReview(
        selected.id,
        decision,
        normalizedNote,
        selected.version,
        stableRequestId,
      );
      if (decision === 'approve') {
        const handoffMessages = [
          result.inventoryHandoff
            ? result.inventoryHandoff.status === 'ready_for_inventory_authority'
              ? `Inventory handoff ${result.inventoryHandoff.id} quedó listo para Inventory Authority; no se movió stock automáticamente.`
              : `Inventory handoff ${result.inventoryHandoff.id} requiere revisión de Inventario; no se movió stock automáticamente.`
            : 'No hay productos vendidos que requieran Inventory handoff.',
          result.billingCandidate
            ? result.billingCandidate.status === 'ready_for_billing_review'
              ? `Billing candidate ${result.billingCandidate.id} quedó listo para revisión financiera; no se creó ninguna factura.`
              : `Billing candidate ${result.billingCandidate.id} requiere revisión de precios; no se creó ninguna factura.`
            : 'No hay trabajo facturable para proyectar.',
        ];
        setNotice(handoffMessages.join(' '));
      } else {
        setNotice(null);
      }
      operationRef.current = null;
      setNote('');
      await load();
    } catch (decisionError) {
      setError(decisionError instanceof Error ? decisionError.message : 'No se pudo guardar la decisión de Office Review.');
      void load();
    } finally {
      setDeciding(null);
    }
  }, [deciding, load, note, selected]);

  if (loading) {
    return <section className={styles.queue}><header><div><span>OFFICE QUALITY GATE</span><h2>Cargando revisiones canónicas…</h2></div></header></section>;
  }
  if (!reviews.length && !error && !notice) return null;

  return (
    <section className={styles.queue}>
      <header>
        <div>
          <span>OFFICE QUALITY GATE · CANONICAL</span>
          <h2>Reportes técnicos esperando revisión</h2>
          <p>Professional Report es la proyección de campo; Office Review es una decisión separada y auditable.</p>
        </div>
        <b>{pending} pendiente{pending === 1 ? '' : 's'}</b>
      </header>
      {error ? <div className={styles.returnedNote}><span>ATENCIÓN</span><strong>{error}</strong></div> : null}
      {notice ? <div className={styles.returnedNote} role="status"><span>HANDOFF GOBERNADO</span><strong>{notice}</strong></div> : null}
      <div className={styles.layout}>
        <aside className={styles.list}>
          {reviews.map((review) => (
            <button
              className={selected?.id === review.id ? styles.active : ''}
              key={review.id}
              onClick={() => { setSelectedId(review.id); setNote(review.reviewerNote ?? ''); setError(null); setNotice(null); }}
              type="button"
            >
              <div><strong>{review.workOrderId}</strong><span>{review.customerId}</span><small>{review.propertyId} · rev. {review.currentRevisionNumber}</small></div>
              <b className={review.status === 'returned' ? styles.returned : styles.pending}>{reviewStatusLabel(review.status)}</b>
            </button>
          ))}
        </aside>
        {selected ? (
          <main className={styles.detail}>
            <div className={styles.detailHead}>
              <div><span>{selected.id}</span><h3>{selected.workOrderId}</h3><p>{selected.propertyId} · enviada {new Date(selected.submittedAt).toLocaleString('es-AW')}</p></div>
              <b className={selected.status === 'returned' ? styles.returned : styles.pending}>{reviewStatusLabel(selected.status)}</b>
            </div>
            <div className={styles.summaryGrid}>
              <section>
                <span>VERDAD CANÓNICA DE CAMPO</span>
                <p>{selected.currentRevision.snapshot.visitChain.length} visita(s) física(s) · {selected.currentRevision.snapshot.distinctAssetCount} A/C · {selected.currentRevision.snapshot.interventions.length} intervención(es).</p>
              </section>
              <section>
                <span>PROFESSIONAL REPORT · READ-ONLY</span>
                <p>{reportStatusLabel(selected.currentRevision.snapshot.professionalReportPreview.status)} · {selected.currentRevision.snapshot.professionalReportPreview.completedInterventionCount} completada(s) · {selected.currentRevision.snapshot.professionalReportPreview.completedRequiredSectionCount}/{selected.currentRevision.snapshot.professionalReportPreview.requiredSectionCount} secciones obligatorias.</p>
              </section>
            </div>
            <FrozenReportContent review={selected} />
            {selected.currentRevision.technicianCorrectionNote ? (
              <div className={styles.returnedNote}>
                <span>CORRECCIÓN INMUTABLE · REV. {selected.currentRevision.revisionNumber}</span>
                <strong>Solicitud de oficina: {selected.currentRevision.officeReturnNote}</strong>
                <p>Corrección reportada por el técnico: {selected.currentRevision.technicianCorrectionNote}</p>
              </div>
            ) : null}
            <div className={styles.reviewControls}>
              <label className={styles.note} style={{ gridColumn: '1 / -1' }}>Nota de revisión<textarea rows={3} disabled={selected.status !== 'pending' || deciding !== null} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Corrección concreta o nota de calidad…" /></label>
            </div>
            {selected.status === 'returned' ? (
              <div className={styles.returnedNote}><span>DEVUELTA PARA CORRECCIÓN</span><strong>{selected.reviewerNote}</strong><p>El técnico debe corregir y reenviar el mismo Office Review; la revisión anterior permanece inmutable.</p></div>
            ) : null}
            <div className={styles.guardrail}><div><span>CONTROL DE ENTREGA AL CLIENTE</span><strong>Nada se envía automáticamente desde esta cola.</strong><p>Aprobar solo cierra el control de oficina. La entrega al cliente continúa como un flujo humano separado.</p></div></div>
            {selected.status === 'pending' ? (
              <footer>
                <button className={styles.returnButton} disabled={deciding !== null} onClick={() => void decide('return')} type="button">{deciding === 'return' ? 'Devolviendo…' : 'Devolver para corrección'}</button>
                <button className={styles.approveButton} disabled={deciding !== null} onClick={() => void decide('approve')} type="button">{deciding === 'approve' ? 'Aprobando…' : 'Aprobar reporte'}</button>
              </footer>
            ) : null}
          </main>
        ) : null}
      </div>
    </section>
  );
}

export function OfficeReviewSurface() {
  const { mode, principal, status } = useAuth();
  if (status === 'loading') return null;
  if (mode === 'firebase') {
    return principal.capabilities.has('field.review') ? <CanonicalOfficeReviewQueue /> : null;
  }
  return <BrowserOfficeReviewQueue />;
}
