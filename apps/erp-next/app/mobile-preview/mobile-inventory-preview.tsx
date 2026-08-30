'use client';

import { useState } from 'react';
import styles from './mobile-preview.module.css';

const devices = [
  { id: 'standard', label: 'Standard phone', width: 390, height: 844 },
  { id: 'compact', label: 'Compact phone', width: 360, height: 800 },
  { id: 'large', label: 'Large phone', width: 430, height: 932 },
] as const;

type DeviceId = (typeof devices)[number]['id'];

export function MobileInventoryPreview() {
  const [deviceId, setDeviceId] = useState<DeviceId>('standard');
  const [landscape, setLandscape] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const device = devices.find((candidate) => candidate.id === deviceId) ?? devices[0];
  const viewport = landscape
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height };

  return (
    <main className={styles.shell}>
      <header className={styles.toolbar}>
        <div className={styles.heading}>
          <span className={styles.brandMark}>D</span>
          <div>
            <strong>Interactive mobile preview</strong>
            <span>Live ERP · Inventory Control</span>
          </div>
        </div>

        <div className={styles.controls}>
          <label className={styles.deviceSelect}>
            <span>Device</span>
            <select
              value={deviceId}
              onChange={(event) => setDeviceId(event.target.value as DeviceId)}
            >
              {devices.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label} · {candidate.width} × {candidate.height}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => setLandscape((current) => !current)}>
            Rotate
          </button>
          <button type="button" onClick={() => setReloadKey((current) => current + 1)}>
            Reload
          </button>
          <a href="/inventory/">
            Exit preview
          </a>
        </div>
      </header>

      <section className={styles.stage} aria-label="Interactive phone viewport">
        <div className={styles.deviceWrap}>
          <div className={styles.phone}>
            <div className={styles.speaker} aria-hidden="true" />
            <div
              className={styles.screen}
              style={{ width: viewport.width, height: viewport.height }}
            >
              <iframe
                key={reloadKey}
                className={styles.frame}
                src="/inventory/"
                title="DEMAC Inventory mobile preview"
              />
            </div>
          </div>
          <p className={styles.viewportLabel}>
            Live viewport · {viewport.width} × {viewport.height} px
          </p>
        </div>
      </section>
    </main>
  );
}
