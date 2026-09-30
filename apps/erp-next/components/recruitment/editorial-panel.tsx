'use client';
import { useId, useState } from 'react';
import { TEXT_FIELDS, LIST_FIELDS, emptyTranslation, alignTranslation, nextEditorialVersion, translationIssues, type EditorialTranslation } from '../../../../functions/careers/editorial-contract';
import s from './recruitment.module.css';
import { VacancyEditorPreview } from './vacancy-editor-preview';
import type { Vacancy } from '../../lib/careers-preview';

type Props<T extends Vacancy & { desired?: string[] }> = { vacancy: T; original?: T | null; onChange: (value: T) => void };
/** Shared by authenticated Recruitment and its explicitly isolated review fixture. */
export function EditorialPanel<T extends Vacancy & { desired?: string[] }>({ vacancy, original, onChange }: Props<T>) {
  const id = useId();
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const version = nextEditorialVersion(vacancy, original);
  const current = { ...vacancy, editorialVersion: version };
  const spanish = vacancy.translations?.es;
  const readyIssues = spanish ? translationIssues(current, { ...spanish, status: 'Approved', sourceVersion: version }) : [];
  const issues = translationIssues(current);
  const patch = (change: Partial<EditorialTranslation>) => {
    const next = { ...(spanish || emptyTranslation(current)), ...change, status: 'Draft' as const };
    onChange({ ...vacancy, translations: { es: next } });
  };
  return <section className={`${s.root} ${s.panel}`} data-editorial-panel>
    <div className={s.head}><div><h2>Editorial languages</h2><p className={s.muted}>One vacancy, one set of questions and two editorial versions. Candidate answers are never translated.</p></div><span className={s.pill}>English version {version}</span></div>
    <div className={s.tabs} role="group" aria-label="Editorial language">
      <button type="button" aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>English — Original</button>
      <button type="button" aria-pressed={language === 'es'} onClick={() => setLanguage('es')}>Español — Traducción</button>
    </div>
    {language === 'en' ? <div>
      <p>Edit the English original in the position and question fields above. Publication dates, openings, answer types and question identifiers are shared by both languages.</p>
      <p role="status">Spanish: {spanish ? issues.length ? 'Draft or needs review — not available publicly.' : 'Reviewed for this English version.' : 'Not added — this vacancy remains English only.'}</p>
    </div> : <div className={s.stack}>
      {!spanish ? <><p>Add a manual Spanish translation. You can save it unfinished as a draft.</p><button type="button" onClick={() => onChange({ ...vacancy, translations: { es: emptyTranslation(current) } })}>Add Spanish translation</button></> : <>
        <div className={s.notice} role="status"><strong>{issues.length ? 'Spanish is not ready for public use' : 'Spanish reviewed'}</strong><p>Translated against English version {spanish.sourceVersion}. Current English version: {version}.</p>{issues.map(issue => <p key={issue}>{issue}</p>)}</div>
        <p className={s.muted}>English source is shown above each Spanish field. These fields change labels only, never stored answer values or candidate documents.</p>
        <div lang="es" className={s.stack}>
          {(Object.keys(TEXT_FIELDS) as (keyof typeof TEXT_FIELDS)[]).map(key => <div key={key} className={s.field}>
            <label htmlFor={`${id}-${key}`}>{({ title: 'Título del puesto', department: 'Departamento', location: 'Ubicación', contract: 'Contratación', summary: 'Acerca del puesto' })[key]} · Español</label>
            <small lang="en" className={s.muted}>{vacancy[key]}</small>
            {key === 'summary' ? <textarea id={`${id}-${key}`} rows={4} maxLength={TEXT_FIELDS[key]} value={spanish[key]} onChange={event => patch({ [key]: event.target.value })}/> : <input id={`${id}-${key}`} maxLength={TEXT_FIELDS[key]} value={spanish[key]} onChange={event => patch({ [key]: event.target.value })}/>}
          </div>)}
          {LIST_FIELDS.map(key => <div key={key} className={s.field}>
            <label htmlFor={`${id}-${key}`}>{({ responsibilities: 'Responsabilidades', requirements: 'Requisitos esenciales', desired: 'Cualificaciones preferidas' })[key]} · Una por línea</label>
            <div lang="en" className={s.muted}>{(vacancy[key] || []).filter(Boolean).map((line, index) => <p key={index}>{index + 1}. {line}</p>)}</div>
            <textarea id={`${id}-${key}`} rows={3} value={spanish[key].join('\n')} onChange={event => patch({ [key]: event.target.value === '' ? [] : event.target.value.split('\n') })}/>
          </div>)}
          {vacancy.questions.map((question, index) => {
            const translated = spanish.questions.find(item => item.id === question.id);
            const options = question.kind === 'yesno' ? ['Yes', 'No'] : question.options || [];
            const changeQuestion = (change: Partial<EditorialTranslation['questions'][number]>) => {
              const updated = { id: question.id, label: translated?.label || '', help: translated?.help || '', optionLabels: translated?.optionLabels || {}, ...change };
              patch({ questions: translated ? spanish.questions.map(item => item.id === question.id ? updated : item) : [...spanish.questions, updated] });
            };
            return <section className={s.question} key={question.id}>
              <h3>Pregunta {index + 1}</h3><p lang="en">{question.label}</p>
              <div className={s.field}><label htmlFor={`${id}-${question.id}-label`}>Pregunta {index + 1} · Español</label><input id={`${id}-${question.id}-label`} maxLength={240} value={translated?.label || ''} onChange={event => changeQuestion({ label: event.target.value })}/></div>
              {question.help && <div className={s.field}><label htmlFor={`${id}-${question.id}-help`}>Ayuda {index + 1} · Español</label><small lang="en">{question.help}</small><textarea id={`${id}-${question.id}-help`} maxLength={600} value={translated?.help || ''} onChange={event => changeQuestion({ help: event.target.value })}/></div>}
              {options.map((option, optionIndex) => <div className={s.field} key={option}><label htmlFor={`${id}-${question.id}-option-${optionIndex}`}><span lang="en">{option}</span> · Español</label><input id={`${id}-${question.id}-option-${optionIndex}`} maxLength={120} value={translated?.optionLabels?.[option] || ''} onChange={event => changeQuestion({ optionLabels: { ...translated?.optionLabels, [option]: event.target.value } })}/></div>)}
            </section>;
          })}
        </div>
        <div className={s.actions}><button type="button" onClick={() => { if (window.confirm('Align Spanish with the current questions? Removed questions/options will be removed from this translation. Matching text is retained.')) onChange({ ...vacancy, translations: { es: alignTranslation(current, spanish) } }); }}>Align to current English questions</button></div>
        <label className={s.check}><input type="checkbox" checked={!issues.length} disabled={!!readyIssues.length} onChange={event => onChange({ ...vacancy, translations: { es: { ...spanish, status: event.target.checked ? 'Approved' : 'Draft', sourceVersion: version } } })}/>I reviewed this Spanish translation against the current English version.</label>
        <p className={s.muted}>Review does not publish or open the vacancy. Saving a draft is always separate from publishing.</p>
      </>}
    </div>}
    <VacancyEditorPreview vacancy={vacancy} editorialVersion={version}/>
  </section>;
}
