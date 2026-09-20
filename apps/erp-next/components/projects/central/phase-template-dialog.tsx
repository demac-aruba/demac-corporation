'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { CentralProject, ProjectPhasePlan } from '@/lib/projects/registry-types';
import { minutesLabel, type RegistryRequest } from '@/lib/projects/registry-client-core';
import { PlanDialog } from './project-plan-dialog';
import s from './projects-central.module.css';

type Template = { id: string; name: string; description: string; active: boolean; version: number; projectType: string; phaseCount: number; plannedVanMinutes: number };
type Library = { source: 'company_phase_templates'; libraryVersion: number; templates: Template[] };
type Preview = { mode: 'template_application_preview'; projectId: string; projectVersion: number; templateId: string;
  templateVersion: number; templateName: string; canApply: boolean; blockers: string[]; phases: ProjectPhasePlan[];
  totalPlannedVanMinutes: number; digest: string };
type Props = { project: CentralProject; request: RegistryRequest; canManage: boolean; busy: boolean; onClose: () => void;
  onSave: (action: string, data: Record<string, unknown>) => Promise<void> };
export function PhaseTemplateDialog({ project, request, canManage, busy, onClose, onSave }: Props) {
  const [mode, setMode] = useState<'apply' | 'save' | 'manage'>('apply');
  const [library, setLibrary] = useState<Library | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [reason, setReason] = useState('');
  const [replacement, setReplacement] = useState(false);
  useEffect(() => {
    let current = true; const controller = new AbortController();
    void request<Library>({ action: 'list_phase_templates', data: {} }, controller.signal).then(value => {
      if (value.source !== 'company_phase_templates' || !Number.isSafeInteger(value.libraryVersion)
          || value.libraryVersion < 0 || !Array.isArray(value.templates)) throw new Error('The shared template library could not be verified.');
      if (current) setLibrary(value);
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Templates unavailable.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [request]);
  const template = library?.templates.find(item => item.id === selected);
  useEffect(() => {
    setPreview(null); setReplacement(false);
    if (mode !== 'apply' || !template?.active) { setPreviewLoading(false); return; }
    let current = true; const controller = new AbortController(); setError(''); setPreviewLoading(true);
    void request<Preview>({ action: 'preview_phase_template', data: { projectId: project.id,
      templateId: template.id, expectedTemplateVersion: template.version } }, controller.signal).then(value => {
      if (value.mode !== 'template_application_preview' || value.projectId !== project.id || value.projectVersion !== project.version
          || value.templateId !== template.id || value.templateVersion !== template.version || !Array.isArray(value.phases)
          || !Array.isArray(value.blockers) || typeof value.canApply !== 'boolean' || !/^[a-f0-9]{64}$/.test(value.digest)) {
        throw new Error('The Project or template changed. Refresh before applying.');
      }
      if (current) setPreview(value);
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : 'Template preview failed.'); })
      .finally(() => { if (current) setPreviewLoading(false); });
    return () => { current = false; controller.abort(); };
  }, [request, project.id, project.version, mode, template?.id, template?.version, template?.active]);
  const ready = !busy && canManage && library && reason.trim() && !previewLoading
    && (mode === 'apply' ? preview?.canApply : mode === 'save' ? project.phases.length > 0 && name.trim() && (!selected || replacement) : Boolean(template));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!ready || !library) return; setError('');
    try {
      const common = { projectId: project.id, expectedVersion: project.version, reason };
      if (mode === 'apply' && template && preview) await onSave('apply_phase_template', { ...common, templateId: template.id,
        expectedTemplateVersion: template.version, previewDigest: preview.digest });
      else if (mode === 'save') await onSave('save_phase_template', { ...common, expectedLibraryVersion: library.libraryVersion,
        templateId: selected || null, name, description, replacementConfirmed: replacement });
      else if (mode === 'manage' && template) await onSave('set_phase_template_active', { ...common,
        expectedLibraryVersion: library.libraryVersion, templateId: template.id, active: !template.active });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The template operation could not be verified.'); }
  };
  return <PlanDialog title="Company phase templates" busy={busy} onClose={onClose}>
    <form className={s.form} onSubmit={event => void submit(event)}>
      <p className={s.notice}>Templates are optional planning aids. Applying one appends editable phases with new identities. It never copies completed work, changes existing phase history, or reserves the agenda.</p>
      <label>Template operation<select aria-label="Template operation" disabled={busy} value={mode} onChange={event => {
        setMode(event.target.value as typeof mode); setSelected(''); setError(''); setReplacement(false);
      }}><option value="apply">Apply saved template</option><option value="save">Save these phases as a template</option><option value="manage">Archive or restore a template</option></select></label>
      {loading && <p role="status">Loading shared company templates…</p>}
      {library && <label>{mode === 'save' ? 'Save as new or replace a template' : 'Company template'}
        <select aria-label="Company template" disabled={busy} value={selected} onChange={event => { setSelected(event.target.value); setReplacement(false); }}>
          <option value="">{mode === 'save' ? 'New company template' : 'Select a template'}</option>
          {library.templates.filter(item => mode !== 'apply' || item.active).map(item => <option key={item.id} value={item.id}>
            {item.name} · v{item.version}{item.active ? '' : ' · archived'}</option>)}
        </select>
      </label>}
      {mode === 'save' && <>
        <p>{project.phases.length} current phases will be copied. Dates, manager assignments and actual work are excluded.</p>
        <label>Template name<input required maxLength={160} value={name} disabled={busy || !canManage} onChange={event => setName(event.target.value)}/></label>
        <label>Template description<textarea maxLength={1000} value={description} disabled={busy || !canManage} onChange={event => setDescription(event.target.value)}/></label>
        {selected && <label className={s.check}><input type="checkbox" checked={replacement} disabled={busy || !canManage}
          onChange={event => setReplacement(event.target.checked)}/>Replace this library template with the current phases. Existing Projects using an earlier copy must remain unchanged.</label>}
      </>}
      {previewLoading && <p role="status">Checking the proposed phases…</p>}
      {mode === 'apply' && preview && <section>
        <h3>{preview.templateName}</h3><p>After applying: {minutesLabel(preview.totalPlannedVanMinutes)} of phase estimates against {minutesLabel(project.budget.currentMinutes)} Project estimate.</p>
        {preview.phases.map(phase => <p key={phase.id}>{phase.name} · {minutesLabel(phase.plannedVanMinutes)}</p>)}
        {preview.blockers.length > 0 && <p className={s.warning}>Review planning allocations before applying: {preview.blockers.join(', ').replaceAll('_', ' ')}. This is not a restriction on booking additional work beyond an estimate.</p>}
      </section>}
      {mode === 'manage' && template && <p className={s.warning}>{template.active ? 'Archive' : 'Restore'} “{template.name}” in the company library. No Project or historical template record will be deleted.</p>}
      <label>Reason for this template operation<textarea required maxLength={1000} disabled={busy || !canManage} value={reason} onChange={event => setReason(event.target.value)}/></label>
      {error && <p role="alert" className={s.error}>{error}</p>}
      <button type="submit" className={s.primary} disabled={!ready}>{mode === 'apply' ? 'Apply template phases' : mode === 'save' ? 'Save company template' : template?.active ? 'Archive template' : 'Restore template'}</button>
    </form>
  </PlanDialog>;
}
