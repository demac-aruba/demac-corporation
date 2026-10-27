'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '../auth/auth-provider';
import { useDialogFocus } from './use-dialog-focus';
import { loadPropertyLocations, type PropertyDwelling } from '../../lib/property-locations';
import { alertCategoryLabels, alertStatusLabels, alertDate, listCustomerAlerts, mutateCustomerAlert, newAlertRequestId, customerAlertHistory, type AlertList, type CustomerAlert, type AlertEvent } from '../../lib/customer-alerts';
import styles from './customer-alerts.module.css';

export function AlertDialog({ title, onClose, busy, children }: { title: string; onClose: () => void; busy: boolean; children: ReactNode }) {
  const ref = useDialogFocus(true, onClose, busy);
  return createPortal(<div className={styles.overlay}><section ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}><header className={styles.head}><div><h2>{title}</h2><p className={styles.muted}>Solo uso interno · Historial del cliente</p></div><button type="button" className={styles.close} onClick={onClose} disabled={busy} aria-label="Cerrar alertas">×</button></header>{children}</section></div>, document.body);
}

function AlertEditor({ list, propertyId: initialProperty, dwellingId: initialDwelling, onClose, onSaved }: { list: AlertList; propertyId?: string; dwellingId?: string; onClose: () => void; onSaved: () => void }) {
  const [category, setCategory] = useState<CustomerAlert['category']>('debt');
  const [comment, setComment] = useState('');
  const [propertyId, setProperty] = useState(initialProperty || '');
  const [dwellingId, setDwelling] = useState(initialDwelling || '');
  const [dwellings, setDwellings] = useState<PropertyDwelling[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [phone, setPhone] = useState(true), [address, setAddress] = useState(Boolean(initialProperty));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<Record<string, unknown> | null>(null);
  const property = list.properties.find(p => p.id === propertyId);
  useEffect(() => {
    let active = true; setDwellings([]);
    if (!property?.hasIndependentDwellings) { setLocationsLoading(false); return; }
    setLocationsLoading(true);
    void loadPropertyLocations(list.customer.id, property.id).then(result => { if (active) setDwellings(result.dwellings.filter(d => d.active !== false)); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLocationsLoading(false); });
    return () => { active = false; };
  }, [list.customer.id, property?.id, property?.hasIndependentDwellings]);
  const save = async () => {
    if (busy) return;
    setBusy(true); setError('');
    const requestId = pending.current?.requestId || newAlertRequestId();
    const data = pending.current || { id: requestId, requestId, customerId: list.customer.id, propertyId, dwellingId, category, comment, matchPhone: phone, matchAddress: address };
    pending.current = data;
    try { await mutateCustomerAlert('create_customer_alert', data); onSaved(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se confirmó el guardado. Reintenta para verificar.'); }
    finally { setBusy(false); }
  };
  const locked = busy || pending.current !== null;
  return <AlertDialog title="Registrar alerta" onClose={onClose} busy={busy}>
    <div className={styles.identity}><strong>{list.customer.name}</strong><small>{list.customer.phone || 'Sin teléfono principal'}</small></div>
    <div className={styles.form}>
      <label>Motivo *<select value={category} disabled={locked} onChange={e => setCategory(e.target.value as CustomerAlert['category'])}>{Object.entries(alertCategoryLabels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Comentario *<textarea maxLength={4000} value={comment} disabled={locked} onChange={e => setComment(e.target.value)} placeholder="Describe lo ocurrido y qué debe revisar el próximo operador."/></label>
      <label>Propiedad relacionada<select value={propertyId} disabled={locked} onChange={e => { setProperty(e.target.value); setDwelling(''); setAddress(Boolean(e.target.value)); }}><option value="">Sin propiedad relacionada</option>{list.properties.map(p => <option key={p.id} value={p.id}>{p.address || p.name}</option>)}</select></label>
      {property?.hasIndependentDwellings ? <label>Apartamento / unidad<select value={dwellingId} disabled={locked || locationsLoading} onChange={e => setDwelling(e.target.value)}><option value="">{locationsLoading ? 'Cargando unidades…' : 'Selecciona la unidad'}</option>{dwellings.map(d => <option value={d.id} key={d.id}>{d.name} · {d.code}</option>)}</select></label> : null}
      <strong>Detectar coincidencias al agendar</strong>
      <label className={styles.check}><input type="checkbox" checked={phone} disabled={locked} onChange={e => setPhone(e.target.checked)}/>Teléfono / WhatsApp del cliente</label>
      <label className={styles.check}><input type="checkbox" checked={address} disabled={locked || !propertyId} onChange={e => setAddress(e.target.checked)}/>Dirección de la propiedad y unidad seleccionadas</label>
    </div>
    <div className={styles.info}><strong>La alerta pertenece al cliente.</strong><div>Una coincidencia de dirección requiere verificar quién vive allí. Un nuevo ocupante puede desvincularse sin borrar el antecedente del cliente anterior.</div></div>
    <p className={styles.muted}>Estado inicial: Activa · Autor y fecha se guardan automáticamente.</p>
    {error ? <div className={styles.error} role="alert">{error}{pending.current ? <p>Reintentar conserva la misma solicitud para evitar duplicados.</p> : null}</div> : null}
    <footer className={styles.footer}><small className={styles.muted}>No se envía al cliente.</small><button type="button" className={styles.button} disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className={styles.primary} onClick={() => void save()} disabled={busy || comment.trim().length < 5 || (address && (!propertyId || (property?.hasIndependentDwellings && !dwellingId))) || locationsLoading}>{busy ? 'Guardando…' : pending.current ? 'Reintentar guardado' : 'Guardar alerta'}</button></footer>
  </AlertDialog>;
}

function AlertCard({ alert, onChanged }: { alert: CustomerAlert; onChanged: () => void }) {
  const [events, setEvents] = useState<AlertEvent[] | null>(null);
  const [status, setStatus] = useState<CustomerAlert['status'] | ''>(''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const pending = useRef<Record<string, unknown> | null>(null);
  const change = async () => {
    if (busy) return; setBusy(true); setError('');
    pending.current ||= { id: alert.id, requestId: newAlertRequestId(), expectedVersion: alert.version, status, reason };
    try { await mutateCustomerAlert('set_customer_alert_status', pending.current); pending.current = null; setStatus(''); setEvents(null); onChanged(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se confirmó el cambio.'); }
    finally { setBusy(false); }
  };
  return <article className={styles.card}><div><span className={styles.badge}>{alertCategoryLabels[alert.category]}</span><span className={styles.badge}>{alertStatusLabels[alert.status]}</span></div><p className={styles.comment}>{alert.comment}</p>{alert.address ? <p className={styles.muted}>{alert.address}</p> : null}<p className={styles.muted}>{alert.createdBy.name} · {alertDate(alert.createdAt)}</p>
    <div className={styles.actions}><button className={styles.button} type="button" onClick={() => { setError(''); void customerAlertHistory(alert.id).then(r => setEvents(r.events)).catch(e => setError(e.message)); }}>Ver historial</button>{(['resolved','invalidated','active'] as const).filter(s => s !== alert.status).map(s => <button key={s} type="button" className={styles.button} onClick={() => { pending.current = null; setReason(''); setStatus(s); }}>{s === 'resolved' ? 'Resolver' : s === 'invalidated' ? 'Invalidar' : 'Reactivar'}</button>)}</div>
    {events ? <div><p className={styles.muted}>Últimos 50 movimientos como máximo</p>{events.map(e => <div className={styles.history} key={e.id}><strong>{e.actor.name}</strong> · {alertDate(e.at)}<div>{e.action === 'create_customer_alert' ? 'Alerta registrada' : e.decision === 'different_customer' ? 'Otro cliente / nuevo ocupante verificado' : e.decision === 'continue' ? 'Operador decidió continuar' : e.decision === 'decline' ? 'Operador decidió no agendar' : e.after ? `Estado: ${alertStatusLabels[e.after.status]}` : 'Cambio registrado'}</div>{e.reason ? <p>{e.reason}</p> : null}</div>)}</div> : null}
    {status ? <AlertDialog title="Cambiar estado de la alerta" busy={busy} onClose={() => setStatus('')}><p>Nuevo estado: <strong>{alertStatusLabels[status]}</strong>. El comentario y su historial se conservan.</p><div className={styles.form}><label>Motivo del cambio *<textarea value={reason} disabled={busy || !!pending.current} maxLength={2000} onChange={e => setReason(e.target.value)}/></label></div>{error ? <div className={styles.error} role="alert">{error}</div> : null}<footer className={styles.footer}><button className={styles.button} disabled={busy} onClick={() => setStatus('')}>Cancelar</button><button className={styles.primary} disabled={busy || reason.trim().length < 5} onClick={() => void change()}>{busy ? 'Guardando…' : 'Guardar cambio'}</button></footer></AlertDialog> : error ? <div className={styles.error} role="alert">{error}</div> : null}
  </article>;
}

export function CustomerAlertManager({ customerId, propertyId, dwellingId, expanded = false }: { customerId: string; propertyId?: string; dwellingId?: string; expanded?: boolean }) {
  const { principal } = useAuth();
  const allowed = principal.active && principal.capabilities.has('scheduling.manage');
  const [list, setList] = useState<AlertList | null>(null), [error, setError] = useState('');
  const [editor, setEditor] = useState(false), [showAll, setShowAll] = useState(expanded), [revision, refresh] = useState(0);
  useEffect(() => {
    let active = true; setList(null); setError(''); setEditor(false);
    if (allowed && customerId) void listCustomerAlerts(customerId).then(r => { if (active) setList(r); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [allowed, customerId, principal.userId, revision]);
  useEffect(() => { setShowAll(expanded); }, [expanded, customerId]);
  if (!allowed || !customerId) return null;
  const active = list?.alerts.filter(a => a.status === 'active') || [];
  return <section className={styles.panel} aria-label="Alertas internas del cliente"><header className={styles.head}><div><h3>Alertas del cliente{list ? ` · ${active.length} activa${active.length === 1 ? '' : 's'}` : ''}</h3><p className={styles.muted}>Comentarios internos compartidos con CRM y Scheduling.</p></div><button className={styles.warning} type="button" disabled={!list} onClick={() => setEditor(true)}>+ Registrar alerta</button></header>{error ? <div className={styles.error} role="alert">{error}<button className={styles.button} onClick={() => refresh(v => v + 1)}>Reintentar</button></div> : !list ? <p className={styles.muted}>Consultando alertas…</p> : <>{(showAll ? list.alerts : active).map(alert => <AlertCard key={`${alert.id}:${alert.version}`} alert={alert} onChanged={() => refresh(v => v + 1)}/>)}{!active.length ? <p className={styles.muted}>Sin alertas activas.</p> : null}<button type="button" className={styles.button} onClick={() => setShowAll(v => !v)}>{showAll ? 'Ver solo activas' : `Ver historial de alertas (${list.alerts.length})`}</button></>}{editor && list ? <AlertEditor list={list} propertyId={propertyId} dwellingId={dwellingId} onClose={() => { setEditor(false); refresh(v => v + 1); }} onSaved={() => { setEditor(false); refresh(v => v + 1); }}/> : null}</section>;
}
