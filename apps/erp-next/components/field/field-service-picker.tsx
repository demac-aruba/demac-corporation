'use client';

import { useId } from 'react';
import type { FieldAvailableService, FieldExecutionJobDetail } from '@/lib/field-authority';
import styles from './field-service-picker.module.css';

type Choice = { id: string; label: string; detail?: string };

/** Native radio inputs keep keyboard/touch selection separate from saving a service. */
export function FieldChoiceCards({ title, choices, value, disabled = false, onChange }: {
  title: string;
  choices: readonly Choice[];
  value: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}) {
  const group = useId();
  return <fieldset className={styles.choices} disabled={disabled}>
    <legend>{title}</legend>
    <div className={styles.choiceList}>
      {choices.map((choice) => <label className={styles.choice} key={choice.id}>
        <input type="radio" name={group} value={choice.id} checked={value === choice.id}
          onChange={() => onChange(choice.id)} />
        <span className={styles.choiceBody}>
          <span><strong>{choice.label}</strong>{choice.detail ? <small>{choice.detail}</small> : null}</span>
          <span className={styles.selectionMark} aria-hidden="true">{value === choice.id ? '✓' : '›'}</span>
        </span>
      </label>)}
    </div>
  </fieldset>;
}

function ServiceIcon({ code }: { code: string }) {
  // Decoration only; codes never select a service, template, price, or permission.
  const shape = code === 'checkup' || code === 'check_up'
    ? <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>
    : code === 'repair'
      ? <path d="m14 4-3 5 4 4 5-3a7 7 0 0 1-9 7l-5 5-4-4 5-5a7 7 0 0 1 7-9Z" />
      : code === 'deep_cleaning'
        ? <><path d="m16 2-5 9m-4 0h10l-2 10H3Zm0 4-2 5m6-5-1 5" /></>
        : code === 'anti_corrosive'
          ? <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Z" /><path d="m8 12 3 3 5-6" /></>
          : <><rect x="2" y="4" width="20" height="12" rx="2" /><path d="M5 12h14M7 19v3m5-3v3m5-3v3" /></>;
  return <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shape}</svg>;
}

export function FieldServiceCards({ services, value, disabled, onChange }: {
  services: readonly FieldAvailableService[];
  value: string;
  disabled: boolean;
  onChange: (id: string) => void;
}) {
  const group = useId();
  return <fieldset className={styles.choices} disabled={disabled}>
    <legend>¿Qué servicio se realizará?</legend>
    <p className={styles.help}>Elige el servicio específico del catálogo para este aire.</p>
    {services.length ? <div className={styles.serviceGrid}>
      {services.map((service) => <label className={styles.choice} key={service.id}>
        <input type="radio" name={group} value={service.id} checked={value === service.id}
          onChange={() => onChange(service.id)} />
        <span className={`${styles.choiceBody} ${styles.serviceBody}`}>
          <span className={styles.serviceIcon}><ServiceIcon code={service.bookingCode} /></span>
          <span><strong>{service.label}</strong><small>Servicio del catálogo</small></span>
          <span className={styles.selectionMark} aria-hidden="true">{value === service.id ? '✓' : '›'}</span>
        </span>
      </label>)}
    </div> : <p className={styles.notice} role="status">No hay servicios disponibles en el catálogo autorizado. Consulta con oficina.</p>}
  </fieldset>;
}

export function FieldAirContext({ job, visitAssetId }: { job: FieldExecutionJobDetail; visitAssetId: string }) {
  const air = job.visitAssets.find((candidate) => candidate.id === visitAssetId);
  if (!air) return null;
  const equipment = job.knownEquipment.find((candidate) => candidate.id === air.assetId);
  const technical = [equipment?.systemType, equipment?.btu ? `${equipment.btu} BTU/h` : '', equipment?.brand, equipment?.model].filter(Boolean).join(' · ');
  return <section className={styles.airContext} aria-label="Aire seleccionado">
    <ServiceIcon code="unit" />
    <div><small>{job.propertyName || job.address || 'Propiedad de la visita'}</small>
      <strong>Aire {air.sequence} · {air.locationLabel || equipment?.locationLabel || 'Área sin registrar'}</strong>
      <span>{technical || 'Datos técnicos no disponibles'}</span>
    </div>
  </section>;
}

export function fieldAirChoices(job: FieldExecutionJobDetail, allowedIds: readonly string[]): Choice[] {
  const allowed = new Set(allowedIds);
  return job.visitAssets.filter((air) => allowed.has(air.id)).map((air) => {
    const equipment = job.knownEquipment.find((candidate) => candidate.id === air.assetId);
    return { id: air.id, label: `Aire ${air.sequence} · ${air.locationLabel || equipment?.locationLabel || 'Área sin registrar'}`,
      detail: [equipment?.systemType, equipment?.btu ? `${equipment.btu} BTU/h` : ''].filter(Boolean).join(' · ') };
  });
}

export { styles as fieldServiceStyles };
