'use client';

import { useState } from 'react';
import type { FieldExecutionJobDetail } from '@/lib/field-authority';
import styles from './technician-field-home.module.css';

const SYSTEM_TYPES = ['Split wall mounted', 'Cassette', 'Floor ceiling', 'Central', 'VRF', 'Otro'];
const REFRIGERANTS = ['R22', 'R32', 'R410A'];
const VOLTAGES = ['110V', '220V', '380V'];
const LOCATION_SUGGESTIONS = [
  'Cuarto principal',
  'Sala',
  'Cocina',
  'Comedor',
  'Cuarto secundario',
  'Tercer cuarto',
  'Cuarto de huéspedes',
  'Oficina',
  'Laundry',
  'Garage',
  'Pasillo',
  'Apartamento',
];

export type EquipmentRegistrationInput = {
  locationLabel: string;
  systemType: string;
  brand: string;
  btu: number;
  refrigerant: string;
  voltage: string;
  qrCode: string;
  equipmentReference: File;
  indoorNameplate: File;
  outdoorNameplate: File;
};

function initialTextState() {
  return {
    locationLabel: '',
    systemType: 'Split wall mounted',
    brand: '',
    btu: '',
    refrigerant: 'R32',
    voltage: '220V',
    qrCode: '',
  };
}

export function EquipmentRegistrationControls({
  job,
  mutationBusy,
  registering,
  error,
  onRegister,
}: {
  job: FieldExecutionJobDetail;
  mutationBusy: boolean;
  registering: boolean;
  error: string | null;
  onRegister: (input: EquipmentRegistrationInput) => Promise<boolean>;
}) {
  const [form, setForm] = useState(initialTextState);
  const [equipmentReference, setEquipmentReference] = useState<File | null>(null);
  const [indoorNameplate, setIndoorNameplate] = useState<File | null>(null);
  const [outdoorNameplate, setOutdoorNameplate] = useState<File | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const available = Boolean(job.fieldVisit && job.canAddExistingAsset);

  const setField = (field: keyof ReturnType<typeof initialTextState>, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const reset = () => {
    setForm(initialTextState());
    setEquipmentReference(null);
    setIndoorNameplate(null);
    setOutdoorNameplate(null);
    setLocalError(null);
  };

  const submit = async () => {
    const btu = Number(form.btu.replace(/\D/g, ''));
    if (!form.locationLabel.trim()) return setLocalError('Escribe dónde está ubicado el A/C, por ejemplo Sala o Cuarto principal.');
    if (!form.systemType.trim()) return setLocalError('Selecciona el tipo de A/C.');
    if (!form.brand.trim()) return setLocalError('Registra la marca del A/C.');
    if (!Number.isSafeInteger(btu) || btu < 1000) return setLocalError('Registra una capacidad válida en BTU.');
    if (!form.refrigerant.trim()) return setLocalError('Selecciona el refrigerante.');
    if (!form.voltage.trim()) return setLocalError('Selecciona el voltaje.');
    if (!equipmentReference) return setLocalError('Toma o selecciona una foto general de referencia del A/C.');
    if (!indoorNameplate) return setLocalError('Toma o selecciona la foto de la placa indoor.');
    if (!outdoorNameplate) return setLocalError('Toma o selecciona la foto de la placa outdoor.');

    setLocalError(null);
    const success = await onRegister({
      locationLabel: form.locationLabel.trim(),
      systemType: form.systemType.trim(),
      brand: form.brand.trim(),
      btu,
      refrigerant: form.refrigerant.trim(),
      voltage: form.voltage.trim(),
      qrCode: form.qrCode.trim(),
      equipmentReference,
      indoorNameplate,
      outdoorNameplate,
    });
    if (success) reset();
  };

  return (
    <div className={styles.interventionGroup}>
      <div className={styles.plannedTitle}>REGISTRAR A/C NUEVO EN ESTA PROPIEDAD</div>
      <p className={styles.helper}>
        Registra el equipo por su ubicación física. Marca, BTU, refrigerante, voltaje y las tres fotos son obligatorios. El QR es opcional por ahora y se puede asociar más adelante al mismo A/C.
      </p>

      {available ? (
        <div className={styles.interventionForm}>
          <label>
            <span>Ubicación / título *</span>
            <input
              className={styles.select}
              disabled={mutationBusy}
              list="field-equipment-location-suggestions"
              value={form.locationLabel}
              onChange={(event) => setField('locationLabel', event.target.value)}
              placeholder="Ej. Sala, Cocina, Cuarto principal"
            />
            <datalist id="field-equipment-location-suggestions">
              {LOCATION_SUGGESTIONS.map((label) => <option key={label} value={label} />)}
            </datalist>
          </label>
          <label>
            <span>Tipo de A/C *</span>
            <select className={styles.select} disabled={mutationBusy} value={form.systemType} onChange={(event) => setField('systemType', event.target.value)}>
              {SYSTEM_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Marca *</span>
            <input className={styles.select} disabled={mutationBusy} value={form.brand} onChange={(event) => setField('brand', event.target.value)} placeholder="Ej. Adina, Gree, Innovair" />
          </label>
          <label>
            <span>BTU *</span>
            <input className={styles.select} disabled={mutationBusy} inputMode="numeric" value={form.btu} onChange={(event) => setField('btu', event.target.value)} placeholder="12000" />
          </label>
          <label>
            <span>Refrigerante *</span>
            <select className={styles.select} disabled={mutationBusy} value={form.refrigerant} onChange={(event) => setField('refrigerant', event.target.value)}>
              {REFRIGERANTS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>Voltaje *</span>
            <select className={styles.select} disabled={mutationBusy} value={form.voltage} onChange={(event) => setField('voltage', event.target.value)}>
              {VOLTAGES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <label style={{ gridColumn: '1 / -1' }}>
            <span>QR (opcional por ahora)</span>
            <input className={styles.select} disabled={mutationBusy} value={form.qrCode} onChange={(event) => setField('qrCode', event.target.value)} placeholder="Déjalo vacío hasta que DEMAC tenga stickers QR" />
          </label>
          <label>
            <span>Foto general de referencia *</span>
            <input className={styles.select} disabled={mutationBusy} type="file" accept="image/*" capture="environment" onChange={(event) => setEquipmentReference(event.target.files?.[0] ?? null)} />
            <small className={styles.helper}>{equipmentReference?.name || 'Sirve para reconocer físicamente cuál A/C fue registrado.'}</small>
          </label>
          <label>
            <span>Foto placa indoor *</span>
            <input className={styles.select} disabled={mutationBusy} type="file" accept="image/*" capture="environment" onChange={(event) => setIndoorNameplate(event.target.files?.[0] ?? null)} />
            <small className={styles.helper}>{indoorNameplate?.name || 'La placa indoor debe quedar documentada.'}</small>
          </label>
          <label>
            <span>Foto placa outdoor *</span>
            <input className={styles.select} disabled={mutationBusy} type="file" accept="image/*" capture="environment" onChange={(event) => setOutdoorNameplate(event.target.files?.[0] ?? null)} />
            <small className={styles.helper}>{outdoorNameplate?.name || 'La placa outdoor debe quedar documentada aunque esté desgastada.'}</small>
          </label>
          <div className={styles.actions} style={{ gridColumn: '1 / -1' }}>
            <button className={`${styles.action} ${styles.primary}`} disabled={mutationBusy} type="button" onClick={() => void submit()}>
              {registering ? 'Registrando A/C…' : 'Registrar y agregar a la visita'}
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.helper}>El registro de A/C se habilita después de llegar al sitio y sólo para una asignación con autoridad de agregar equipos.</p>
      )}
      {localError ? <div className={styles.mutationError}>{localError}</div> : null}
      {error ? <div className={styles.mutationError}>{error}</div> : null}
    </div>
  );
}
