'use client';

import { useState } from 'react';
import type { FieldKnownEquipment, FieldVisitAsset } from '@/lib/field-authority';
import styles from './field-qr-lookup.module.css';

function normalizedQr(value: string | undefined) {
  return String(value ?? '').trim();
}

export function FieldQrLookup({
  equipment,
  visitAssets,
  canAttach,
  busy,
  attachingAssetId,
  onAttach,
}: {
  equipment: FieldKnownEquipment[];
  visitAssets: FieldVisitAsset[];
  canAttach: boolean;
  busy: boolean;
  attachingAssetId: string | null;
  onAttach: (assetId: string, qrCode: string) => Promise<boolean>;
}) {
  const [qrCode, setQrCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  async function identify() {
    const presentedQr = normalizedQr(qrCode);
    setMessage(null);
    if (presentedQr.length < 3) {
      setMessage('Escanea o escribe un QR válido.');
      return;
    }
    if (!canAttach) {
      setMessage('Field Authority no permite agregar equipos en el estado actual de la visita.');
      return;
    }

    const matches = equipment.filter((item) => item.active && normalizedQr(item.qrCode) === presentedQr);
    if (matches.length !== 1) {
      setMessage(matches.length > 1
        ? 'El QR no es único en esta propiedad. Oficina debe corregir la asociación antes de usarlo.'
        : 'Este QR no identifica un equipo activo autorizado para esta propiedad. Usa el alta completa si es un A/C nuevo.');
      return;
    }

    const match = matches[0];
    if (visitAssets.some((item) => item.assetId === match.id)) {
      setMessage(`${match.locationLabel || 'El equipo'} ya está incluido en esta visita.`);
      return;
    }

    const attached = await onAttach(match.id, qrCode.trim());
    if (attached) {
      setQrCode('');
      setMessage(`${match.locationLabel || 'Equipo'} identificado y agregado a la visita.`);
    }
  }

  return (
    <div className={styles.card}>
      <div>
        <strong>Identificar por QR</strong>
        <p>Opcional. Solo busca equipos ya registrados para esta propiedad; no reemplaza el alta completa de un A/C nuevo.</p>
      </div>
      <div className={styles.controls}>
        <label>
          <span>QR del equipo</span>
          <input
            autoComplete="off"
            disabled={busy}
            onChange={(event) => {
              setQrCode(event.target.value);
              setMessage(null);
            }}
            placeholder="Escanea o escribe el código"
            value={qrCode}
          />
        </label>
        <button disabled={busy || qrCode.trim().length < 3} onClick={() => void identify()} type="button">
          {attachingAssetId ? 'Validando…' : 'Identificar y agregar'}
        </button>
      </div>
      {message ? <p className={styles.message} role="status">{message}</p> : null}
    </div>
  );
}
