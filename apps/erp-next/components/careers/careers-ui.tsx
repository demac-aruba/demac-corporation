'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { countryCodes } from '../../lib/careers-preview';
import s from './careers.module.css';

export function Field({ id, label, error, hint, children, optional = false }: { id: string; label: string; error?: string; hint?: string; children: ReactNode; optional?: boolean }) {
  return <div className={s.field}><label htmlFor={id}>{label}{optional && <span className={s.optional}> (optional)</span>}</label>{children}{hint && <small id={`${id}-hint`}>{hint}</small>}{error && <small className={s.error} id={`${id}-error`} role="alert">{error}</small>}</div>;
}
export function CountrySelect({ id, value, onChange, error }: { id: string; value: string; onChange: (value: string) => void; error?: string }) {
  const options = useMemo(() => {
    const names = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['en'], { type: 'region' }) : null;
    return countryCodes.map(code => ({ code, name: names?.of(code) || code })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  }, []);
  return <select id={id} value={value} onChange={event => onChange(event.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined}><option value="">Select country</option>{options.map(option => <option key={option.code} value={option.code}>{option.name}</option>)}</select>;
}
export function countryName(code: string): string {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) || code; } catch { return code; }
}
export function FileLink({ file }: { file: File }) {
  const [url, setUrl] = useState('');
  useEffect(() => { const local = URL.createObjectURL(file); setUrl(local); return () => URL.revokeObjectURL(local); }, [file]);
  return url ? <a href={url} download={file.name} className={s.textButton}>Open selected file ↗</a> : <span>Preparing file…</span>;
}
export function sizeLabel(bytes: number): string { return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`; }
export function Alert({ children }: { children: ReactNode }) { return <div className={s.alert} role="alert">{children}</div>; }
export function focusError(errors: Record<string, string>) {
  const id = Object.keys(errors)[0];
  requestAnimationFrame(() => { const target = document.getElementById(id); target?.focus(); target?.scrollIntoView({ block: 'center', behavior: 'auto' }); });
}
