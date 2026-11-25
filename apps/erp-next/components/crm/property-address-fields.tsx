'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { suggestArubaServiceAddresses, type DemacAddressSuggestion } from '@/lib/booking-intelligence/address';
import { composePropertyAddress, selectPropertyAddress, splitPropertyAddress, type PropertyAddressDraft } from '@/lib/property-address-draft';
import styles from './property-editor.module.css';

type Props = {
  draft: PropertyAddressDraft;
  zone: string;
  onChange: (draft: PropertyAddressDraft, value: { address?: string; zone?: string; neighborhood?: string }) => void;
};

export function PropertyAddressFields({ draft, zone, onChange }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const local = useMemo(() => suggestArubaServiceAddresses(draft.street, 6), [draft.street]);
  const [remote, setRemote] = useState<{ query: string; rows: DemacAddressSuggestion[]; failed: boolean } | null>(null);
  const query = splitPropertyAddress(draft.street).street.trim();
  const apiKey = process.env.NEXT_PUBLIC_GEOAPIFY_API_KEY;
  useEffect(() => {
    if (!open || local.length || query.length < 3 || !apiKey) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({ text: query, filter: 'countrycode:aw', format: 'json', limit: '6', apiKey });
        const response = await fetch('https://api.geoapify.com/v1/geocode/autocomplete?' + params, { signal: controller.signal });
        if (!response.ok) throw new Error('Map search unavailable');
        const data = await response.json() as { results: Array<{ street?: string; city?: string; suburb?: string; district?: string; country_code?: string; result_type?: string; name?: string }> };
        const rows: DemacAddressSuggestion[] = [];
        for (const place of data.results) {
          if (place.country_code !== 'aw') continue;
          const canonical = place.street || (['city', 'suburb', 'district'].includes(place.result_type || '') ? place.name : '');
          if (!canonical) continue;
          const neighborhood = place.suburb || place.district || place.city || '';
          if (rows.some(row => row.canonical === canonical && row.neighborhood === neighborhood)) continue;
          const locality = [place.suburb, place.district, place.city].filter(Boolean).flatMap(label =>
            suggestArubaServiceAddresses(label!, 1).filter(row => row.canonical.toLowerCase() === label!.toLowerCase() && row.neighborhood.toLowerCase() === label!.toLowerCase())
          )[0];
          rows.push({ canonical, neighborhood, operationalZone: locality?.operationalZone || '', demacSector: locality?.demacSector || '', source: 'unknown', score: 0 });
        }
        if (!controller.signal.aborted) setRemote({ query, rows, failed: false });
      } catch {
        if (!controller.signal.aborted) setRemote({ query, rows: [], failed: true });
      }
    }, 400);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiKey, local, open, query]);
  const suggestions = local.length ? local : remote?.query === query ? remote.rows : [];
  const visible = open && suggestions.length > 0;
  const choose = (suggestion: DemacAddressSuggestion) => {
    const selected = selectPropertyAddress(draft, suggestion);
    onChange(selected.draft, { address: selected.address, zone: selected.zone, neighborhood: selected.neighborhood });
    setOpen(false); setActive(-1);
  };

  return <>
    <div className={styles.full} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <label className={styles.field} htmlFor={`${id}-street`}><span>Calle / barrio *</span></label>
      <input id={`${id}-street`} className={styles.addressInput} required role="combobox" autoComplete="off"
        aria-autocomplete="list" aria-expanded={visible} aria-controls={visible ? `${id}-options` : undefined}
        aria-activedescendant={visible && active >= 0 ? `${id}-option-${active}` : undefined}
        aria-describedby={`${id}-help`} value={draft.street} placeholder="Empieza a escribir una dirección de Aruba…"
        onFocus={() => { setOpen(true); setActive(-1); }}
        onChange={(event) => {
          const next = { ...draft, street: event.target.value };
          // Only an exact canonical/alias match can fill the zone without a selection.
          const exact = suggestArubaServiceAddresses(next.street, 6).find((item) => item.score === 100);
          const selected = exact ? selectPropertyAddress(next, exact) : null;
          onChange(next, { address: selected?.address ?? composePropertyAddress(next), zone: selected?.zone ?? '', neighborhood: selected?.neighborhood ?? '' });
          setOpen(true); setActive(-1);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault(); event.stopPropagation(); setOpen(false); setActive(-1);
          } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && suggestions.length) {
            event.preventDefault(); setOpen(true);
            setActive((current) => event.key === 'ArrowDown' ? (current + 1) % suggestions.length : (current <= 0 ? suggestions.length : current) - 1);
          } else if (event.key === 'Enter' && visible) {
            event.preventDefault(); choose(suggestions[active >= 0 ? active : 0]);
          }
        }} />
      {visible ? <div id={`${id}-options`} className={styles.addressOptions} role="listbox" aria-label="Direcciones de Aruba">
        {suggestions.map((suggestion, index) => <button id={`${id}-option-${index}`} key={JSON.stringify([suggestion.canonical, suggestion.neighborhood])}
          type="button" role="option" aria-selected={active === index} tabIndex={-1}
          onPointerDown={(event) => event.preventDefault()} onClick={() => choose(suggestion)}>
          <strong>{suggestion.canonical}</strong><span>{suggestion.neighborhood || 'Aruba'} · {suggestion.operationalZone || suggestion.demacSector || 'Zona por confirmar'}</span>
        </button>)}
      </div> : null}
      <p id={`${id}-help`} className={styles.addressHint}>
        {!zone.trim() && draft.street.trim().length >= 2 && !suggestions.length
          ? apiKey && open && query.length >= 3 && remote?.query !== query ? 'Buscando en el mapa…' : remote?.query === query && remote.failed ? 'Mapa no disponible. Puedes confirmar la zona manualmente.' : 'Sin coincidencias. Puedes escribir la dirección y confirmar la zona manualmente.'
          : !open && !zone.trim() && draft.street.trim().length >= 2 ? 'Zona pendiente. Selecciona una sugerencia o escribe la zona manualmente.' : 'Selecciona una dirección para completar el barrio y la zona.'}
      </p>
      {apiKey && !local.length && remote?.query === query && remote.rows.length > 0 ? <small><a href="https://www.geoapify.com/">Geoapify</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a></small> : null}
    </div>
    <label className={styles.field}><span>Número / letra de casa</span><input value={draft.house} placeholder="Ej. 54 C, 175K, 23-B"
      onChange={(event) => {
        const exact = suggestions.find((item) => item.score === 100);
        const next = { street: exact?.canonical || splitPropertyAddress(draft.street).street, house: event.target.value };
        onChange(next, { address: composePropertyAddress(next) });
      }} /></label>
    <label className={styles.field}><span>Zona *</span><input required value={zone} placeholder="Se completa al elegir la dirección"
      onChange={(event) => onChange(draft, { zone: event.target.value })} /></label>
  </>;
}
