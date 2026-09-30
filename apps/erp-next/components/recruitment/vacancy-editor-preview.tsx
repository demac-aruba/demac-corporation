'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { editorPreviewState } from '../../lib/careers-editor-preview';
import { emptyDraft, validateVacancy, validateApplication, type ApplicationDraft, type Vacancy } from '../../lib/careers-preview';
import { formScreens, targetFor, normalizeFormTarget, type FormTarget } from '../../lib/careers-form-flow';
import { vacancyPresentation } from '../../lib/careers-locale';
import { CareersLanguage } from '../careers/careers-language';
import { ApplicationFunnel } from '../careers/application-funnel';
import { VacancyProfile, ApplicationReceipt } from '../careers/careers-pages';
import shared from '../careers/careers.module.css';
import s from './vacancy-editor-preview.module.css';

type Preview = ReturnType<typeof editorPreviewState>;
export function VacancyEditorPreview({ vacancy, editorialVersion }: { vacancy: Vacancy; editorialVersion: number }) {
  const [opened, setOpened] = useState<{ preview: Preview; locale: 'en' | 'es' } | null>(null);
  const preview = editorPreviewState(vacancy, editorialVersion);
  const englishIssue = validateVacancy(vacancy);
  return <div className={s.launch} data-editor-preview-controls>
    <h3>Preview the current vacancy</h3>
    <p>Review the same position and question components used by candidates, including unsaved edits. No vacancy, application, file or email is saved.</p>
    <div className={s.controls}>
      <button type="button" disabled={!!englishIssue} onClick={() => setOpened({ preview, locale: 'en' })}>Preview in English</button>
      <button type="button" disabled={!!englishIssue || !!preview.spanishIssues.length} onClick={() => setOpened({ preview, locale: 'es' })}>Previsualizar en español</button>
    </div>
    {englishIssue && <p role="status">{englishIssue}</p>}
    {!englishIssue && !!preview.spanishIssues.length && <p>Spanish preview requires complete translated vacancy fields. It does not require publication or a configured mailbox.</p>}
    {opened && createPortal(<PreviewDialog initial={opened.locale} preview={opened.preview} onClose={() => setOpened(null)}/>, document.body)}
  </div>;
}

function PreviewDialog({ initial, preview, onClose }: { initial: 'en' | 'es'; preview: Preview; onClose: () => void }) {
  const [locale, setLocale] = useState(initial);
  const [draft, setDraft] = useState<ApplicationDraft>(emptyDraft);
  const [view, setView] = useState<'role' | 'form' | 'receipt'>('role');
  const firstTarget = () => targetFor(formScreens(preview.vacancy, emptyDraft())[0]);
  const [target, setTarget] = useState<FormTarget>(firstTarget);
  const dialog = useRef<HTMLDialogElement>(null), label = useId(), note = useId();
  const vacancy = preview.vacancy;
  const show = (next: FormTarget) => { setTarget(normalizeFormTarget(formScreens(vacancy, draft), next, validateApplication(draft, vacancy))); setView('form'); dialog.current?.scrollTo({ top: 0, behavior: 'instant' }); };
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);
  // The portal is outside the editor form. Escape/close discards only simulated
  // candidate data, never the vacancy draft behind the native modal's focus trap.
  return <dialog ref={dialog} className={s.dialog} aria-labelledby={label} aria-describedby={note}
    onCancel={event => { event.preventDefault(); onClose(); }} onSubmit={event => event.stopPropagation()} data-editor-candidate-preview>
    <header className={s.toolbar}><div><h2 id={label}>Candidate-view preview · Not published</h2><p id={note}>Use fictional details and test files. Closing this preview clears its simulated answers and keeps your vacancy edits.</p></div>
      <div className={s.controls}><button type="button" lang="en" aria-pressed={locale === 'en'} onClick={() => setLocale('en')}>English</button><button type="button" lang="es" disabled={!!preview.spanishIssues.length} aria-pressed={locale === 'es'} onClick={() => setLocale('es')}>Español</button><button type="button" onClick={onClose}>Close preview</button></div>
    </header>
    <CareersLanguage locale={locale} onChange={setLocale}><div lang={locale} className={`${shared.root} ${s.surface}`}>
      <p className={s.notice}>{locale === 'es' ? 'Vista de revisión del contenido actual. No aprueba la traducción ni publica la vacante.' : 'Reviewing the current edited content. This does not approve a translation or publish the vacancy.'}</p>
      {view === 'role' && <VacancyProfile vacancy={vacancy} onBack={onClose} onApply={() => show(target)} applyLabel="Apply now"/>}
      {view === 'form' && <ApplicationFunnel vacancy={vacancy} draft={draft} step={target.step} reviewing={!!target.reviewing} question={target.question} returnToReview={target.returnToReview}
        onChange={setDraft} onStep={show} onBackToJob={() => setView('role')} onBack={previous => previous ? show(previous) : setView('role')}
        onSubmit={() => { setView('receipt'); dialog.current?.scrollTo({ top: 0, behavior: 'instant' }); return null; }}/>}
      {view === 'receipt' && <ApplicationReceipt preview reference="PREVIEW-NOT-SAVED" email={draft.email} jobTitle={vacancyPresentation(vacancy, locale).job.title} onExplore={() => { setView('role'); setDraft(emptyDraft()); setTarget(firstTarget()); }}/>}
    </div></CareersLanguage>
  </dialog>;
}
