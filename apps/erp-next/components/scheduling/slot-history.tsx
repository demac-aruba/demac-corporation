'use client';

import { historyKindLabel, type SlotHistoryItem } from '../../lib/scheduling-slot-history';
import { useBookingDialog } from './use-booking-dialog';
import styles from './slot-history.module.css';

function time(value: string) {
  if (!value) return 'Sin registrar';
  const [hours, minutes] = value.split(':');
  return `${Number(hours) % 12 || 12}:${minutes} ${Number(hours) >= 12 ? 'PM' : 'AM'}`;
}
function timestamp(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sin registrar';
  return new Date(value).toLocaleString('es', { timeZone: 'America/Aruba', dateStyle: 'medium', timeStyle: 'short' });
}

export function SlotHistoryNote({ items, disabled = false, onOpen }: { items: SlotHistoryItem[]; disabled?: boolean; onOpen: (items: SlotHistoryItem[]) => void }) {
  if (!items.length) return null;
  const first = items[0];
  return <button type="button" className={styles.note} data-slot-history data-history-kind={first.event.kind}
    disabled={disabled} onClick={event => { event.stopPropagation(); onOpen(items); }}
    aria-label={`Ver historial: ${items.length} cambio${items.length === 1 ? '' : 's'}, ${first.customer}, ${time(first.start)}`}>
    <span aria-hidden="true">↺</span><span><strong>{historyKindLabel(first.event.kind)}{items.length > 1 ? ` · +${items.length - 1}` : ''}</strong>
      <small>{time(first.start)}{first.end ? `–${time(first.end)}` : ''} · {first.customer} · Ver historial</small></span><span aria-hidden="true">›</span>
  </button>;
}

export function SlotHistoryDialog({ items, onClose }: { items: SlotHistoryItem[]; onClose: () => void }) {
  const dialogRef = useBookingDialog(onClose, false);
  return <div className={styles.backdrop}>
    <aside ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="slot-history-title" tabIndex={-1} data-booking-modal>
      <header><div><small>SCHEDULING · HISTORIAL</small><h2 id="slot-history-title">Lo que ocurrió en este cupo</h2></div><button type="button" onClick={onClose} aria-label="Cerrar historial">×</button></header>
      <div className={styles.body}>
        <p className={styles.intro}>Estas notas conservan el historial. La disponibilidad actual del cupo se muestra en la agenda.</p>
        {items.map(item => <article key={item.key} className={styles.event}>
          <div className={styles.eventHeading}><strong>{historyKindLabel(item.event.kind)}</strong><time>{timestamp(item.event.at)}</time></div>
          <h3>{item.customer}</h3><p>{item.property}</p>
          <dl>
            <div><dt>Ubicación anterior</dt><dd>{item.date} · {item.vanId.replace('VAN-', 'Van ')} · {time(item.start)}{item.end ? `–${time(item.end)}` : ' · hora final sin registrar'}{item.role === 'support' ? ' · Apoyo' : ''}</dd></div>
            {item.event.to ? <div><dt>Destino de este cambio</dt><dd>{item.event.to.dateKey} · {(item.role === 'support' ? item.event.to.supportVanId : item.event.to.primaryVanId)?.replace('VAN-', 'Van ') || 'Sin registrar'} · {time((item.role === 'support' ? item.event.to.supportStart : item.event.to.primaryStart) || '')}</dd></div> : null}
            <div><dt>Motivo</dt><dd>{item.event.reason || 'Sin registrar'}</dd></div>
            {item.event.note ? <div><dt>Nota</dt><dd>{item.event.note}</dd></div> : null}
            <div><dt>Registrado por</dt><dd>{item.event.actorName || 'Sin registrar'}</dd></div>
            <div><dt>Creación de la reserva</dt><dd>{timestamp(item.appointment.createdAt || '')}{item.appointment.createdByName ? ` · ${item.appointment.createdByName}` : ''}</dd></div>
            {item.appointment.workLabel ? <div><dt>Servicio registrado en la cita</dt><dd>{item.appointment.workLabel}</dd></div> : null}
            <div><dt>Referencia</dt><dd>{item.appointment.appointmentId}</dd></div>
          </dl>
        </article>)}
      </div>
      <footer><button type="button" onClick={onClose}>Volver a la agenda</button></footer>
    </aside>
  </div>;
}
