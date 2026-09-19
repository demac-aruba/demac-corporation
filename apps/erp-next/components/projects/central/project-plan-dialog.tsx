'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { loadBookingMasterReferenceData, type BookingCustomer, type BookingProperty } from '@/lib/live-scheduling-booking-data';
import type { CentralProject, ProjectPhasePlan } from '@/lib/projects/registry-types';
import s from './projects-central.module.css';

type SavePlan = (action: string, data: Record<string, unknown>) => Promise<void>;
const fieldsetStyle = { border: 0, padding: 0, margin: 0, minWidth: 0, display: 'grid', gap: '1rem' };
const value = (form: FormData, name: string) => String(form.get(name) ?? '').trim();

export function PlanDialog({ title, busy, onClose, children }: {
  title: string; busy: boolean; onClose: () => void; children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    box.current?.focus();
    return () => before?.focus();
  }, []);

  // Closing a form never cancels/replaces a sent command. Recovery stays in the workspace.
  return <div className={s.overlay}>
    <div ref={box} className={s.dialog} role="dialog" aria-modal="true" aria-label={title} aria-busy={busy} tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); onClose(); }
        if (event.key !== 'Tab') return;
        const elements = Array.from(box.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? []);
        const first = elements[0];
        const last = elements.at(-1);
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      }}>
      <header>
        <h2>{title}</h2>
        <button className={s.button} type="button" onClick={onClose} aria-label="Close dialog">×</button>
      </header>
      {busy && <p className={s.notice}>The operation is protected against duplicate submission. You may close this form to view its status or retry the exact request in the workspace.</p>}
      {children}
    </div>
  </div>;
}

export function MetadataDialog({ project, busy, onClose, onSave }: {
  project?: CentralProject; busy: boolean; onClose: () => void; onSave: SavePlan;
}) {
  const formId = useId();
  const [customers, setCustomers] = useState<BookingCustomer[]>([]);
  const [properties, setProperties] = useState<BookingProperty[]>([]);
  const [query, setQuery] = useState('');
  const [customer, setCustomer] = useState('');
  const [property, setProperty] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(!project);

  useEffect(() => {
    if (project) return;
    let active = true;
    void loadBookingMasterReferenceData().then(data => {
      if (!active) return;
      setCustomers(data.clients.filter(row => row.active !== false));
      setProperties(data.properties.filter(row => row.active !== false));
    }).catch(() => {
      if (active) setError('CRM references could not be loaded. No customer or property was created.');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [project]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const fields = {
      name: value(form, 'name'), type: value(form, 'type'), description: value(form, 'description'),
      technicianInstructions: value(form, 'technicianInstructions'),
      startsOn: value(form, 'startsOn'), estimatedCompletionOn: value(form, 'estimatedCompletionOn'),
    };
    try {
      if (project) {
        await onSave('edit_metadata', { projectId: project.id, expectedVersion: project.version, patch: fields });
      } else {
        const minutes = Number(value(form, 'hours')) * 60;
        if (!Number.isSafeInteger(minutes) || minutes < 1) throw Error('Enter estimated Van time with whole-minute precision.');
        if (!customer || !property) throw Error('Select the canonical customer and property.');
        await onSave('create_plan', { ...fields, customerId: customer, propertyId: property, budgetedVanMinutes: minutes, phases: [] });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The plan could not be saved.');
    }
  };

  return <PlanDialog title={project ? 'Edit project plan' : 'Create shared project'} busy={busy} onClose={onClose}>
    <form className={s.form} onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} style={fieldsetStyle}>
        {!project && <>
          <p className={s.notice}>Creates a shared planning record only. This does not reserve Van time, create a customer or change the live agenda.</p>
          <label>Find existing customer<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search canonical CRM" disabled={loading}/></label>
          <div className={s.search}>
            {customers.filter(row => `${row.name} ${row.company ?? ''}`.toLowerCase().includes(query.toLowerCase())).slice(0, 10).map(row =>
              <button type="button" className={s.button} aria-pressed={customer === row.id} key={row.id}
                onClick={() => { setCustomer(row.id); setProperty(''); }}>{customer === row.id ? '✓ ' : ''}{row.company || row.name}</button>)}
          </div>
          <label>Service property<select aria-label="Service property" value={property} onChange={event => setProperty(event.target.value)} required>
            <option value="">Select the customer's property</option>
            {properties.filter(row => row.clientId === customer).map(row => <option key={row.id} value={row.id}>{row.name || row.address || row.id}</option>)}
          </select></label>
        </>}
        <div className={s.formGrid}>
          <label>Project name<input name="name" defaultValue={project?.name} maxLength={160} required/></label>
          <label>Project type<select aria-label="Project type" name="type" defaultValue={project?.type ?? 'VRF Project'}>
            {['VRF Project', 'Installation Project', 'Service Project', 'Maintenance Contract', 'Other Project'].map(type => <option key={type}>{type}</option>)}
          </select></label>
          <label>Start date<input name="startsOn" type="date" defaultValue={project?.startsOn} required/></label>
          <label>Estimated completion<input name="estimatedCompletionOn" type="date" defaultValue={project?.estimatedCompletionOn} required/></label>
        </div>
        {!project && <label>Estimated Van hours<input aria-label="Estimated Van hours" name="hours" type="number" min="1" step="1" required/>
          <small className={s.muted}>Planning estimate, not person-hours or a hard booking limit.</small>
        </label>}
        {/* Explicit labels exclude a populated textarea's content from its accessible name. */}
        <div className={s.form}>
          <label htmlFor={`${formId}-description`}>Scope / description</label>
          <textarea id={`${formId}-description`} name="description" maxLength={3000} defaultValue={project?.description ?? ''}/>
        </div>
        <div className={s.form}>
          <label htmlFor={`${formId}-instructions`}>Technician instructions</label>
          <textarea id={`${formId}-instructions`} name="technicianInstructions" maxLength={2000} defaultValue={project?.technicianInstructions ?? ''}/>
        </div>
        {project && <p className={s.muted}>Customer, property, original estimate, phases and operational history are not changed by this form.</p>}
        {error && <p role="alert" className={s.error}>{error}</p>}
        <div className={s.actions}>
          <button className={s.button} type="button" onClick={onClose}>Cancel</button>
          <button className={s.primary} disabled={loading} type="submit">{busy ? 'Saving…' : 'Save project'}</button>
        </div>
      </fieldset>
    </form>
  </PlanDialog>;
}

export function PhaseDialog({ project, phase, busy, onClose, onSave }: {
  project: CentralProject; phase?: ProjectPhasePlan; busy: boolean; onClose: () => void; onSave: SavePlan;
}) {
  const formId = useId();
  const [method, setMethod] = useState<ProjectPhasePlan['progressMethod']>(phase?.progressMethod ?? 'approval');
  const [error, setError] = useState('');
  const [items, setItems] = useState(phase?.checklist ?? []);
  const id = useRef(phase?.id ?? `PH-${crypto.randomUUID()}`);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const minutes = Number(value(form, 'hours')) * 60;
      if (!Number.isSafeInteger(minutes) || minutes < 1) throw Error('Enter a positive whole-minute phase estimate.');
      const next: ProjectPhasePlan = {
        ...phase, id: id.current, name: value(form, 'name'), scopeOfWork: value(form, 'scope'),
        completionCriteria: value(form, 'criteria'), plannedVanMinutes: minutes,
        dependencies: form.getAll('dependency').map(String), progressMethod: method,
        unitsPlanned: method === 'units' ? Number(value(form, 'units')) : phase?.unitsPlanned ?? 0,
        checklist: items,
      };
      const phases = phase ? project.phases.map(item => item.id === phase.id ? next : item) : [...project.phases, next];
      await onSave('set_phases', { projectId: project.id, expectedVersion: project.version, phases });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The phase could not be saved.');
    }
  };

  return <PlanDialog title={phase ? 'Edit phase' : 'Add custom phase'} busy={busy} onClose={onClose}>
    <form className={s.form} onSubmit={event => void submit(event)}>
      <fieldset disabled={busy} style={fieldsetStyle}>
        <label>Phase name<input name="name" defaultValue={phase?.name} maxLength={160} required/></label>
        <div className={s.formGrid}>
          <label>Estimated Van hours<input aria-label="Estimated Van hours" name="hours" type="number" min="0.1" step="0.1" defaultValue={phase ? phase.plannedVanMinutes / 60 : undefined} required/></label>
          <label>Completion method<select aria-label="Completion method" value={method} onChange={event => setMethod(event.target.value as ProjectPhasePlan['progressMethod'])}>
            <option value="approval">Explicit approval</option><option value="units">Completed units</option>
            <option value="checklist">Checklist evidence</option><option value="hours">Recorded hours</option>
          </select></label>
        </div>
        <div className={s.form}>
          <label htmlFor={`${formId}-scope`}>Scope of work</label>
          <textarea id={`${formId}-scope`} name="scope" defaultValue={phase?.scopeOfWork} maxLength={2000} required/>
        </div>
        <div className={s.form}>
          <label htmlFor={`${formId}-criteria`}>Completion criteria</label>
          <textarea id={`${formId}-criteria`} name="criteria" defaultValue={phase?.completionCriteria} maxLength={2000} required/>
        </div>
        {method === 'units' && <label>Planned units<input name="units" type="number" step="1" min="1" defaultValue={phase?.unitsPlanned || 1} required/></label>}
        {method === 'checklist' && <div>
          <strong>Checklist plan</strong>
          {items.map((item, index) => <label key={item.id}>Item {index + 1}
            <input value={item.label} maxLength={500} required
              onChange={event => setItems(current => current.map(row => row.id === item.id ? { ...row, label: event.target.value } : row))}/>
          </label>)}
          <button type="button" className={s.button} disabled={items.length >= 100}
            onClick={() => setItems(current => [...current, { id: `CL-${crypto.randomUUID()}`, label: '' }])}>Add checklist item</button>
          <p className={s.muted}>Existing item IDs are preserved. This editor does not delete or renumber checklist history.</p>
        </div>}
        <div>Prerequisite phases
          {project.phases.filter(item => item.id !== phase?.id).map(item => <label className={s.check} key={item.id}>
            <input type="checkbox" name="dependency" value={item.id} defaultChecked={phase?.dependencies.includes(item.id)}/>{item.name}
          </label>)}
        </div>
        <p className={s.notice}>Defines planned work only. It does not mark work complete or reserve the agenda. Existing phase details are preserved.</p>
        {error && <p className={s.error} role="alert">{error}</p>}
        <div className={s.actions}>
          <button className={s.button} type="button" onClick={onClose}>Cancel</button>
          <button className={s.primary} type="submit">Save phase</button>
        </div>
      </fieldset>
    </form>
  </PlanDialog>;
}
