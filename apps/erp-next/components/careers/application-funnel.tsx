'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { fileError, totalFileBytes, validateApplication, type ApplicationDraft, type Errors, type Vacancy } from '../../lib/careers-preview';
import { formScreens, targetFor, screenErrors, previousFormTarget, questionProgress, type FormTarget, type FormScreen } from '../../lib/careers-form-flow';
import { prepareProfilePhoto } from './profile-photo';
import { Alert, countryName, focusError } from './careers-ui';
import { BackControl, CareerIcon, FunnelSteps, ReadyFile } from './careers-visuals';
import { FunnelQuestion } from './funnel-question';
import { useCareersLanguage } from './careers-language';
import { careersTemplate, careersFormErrors, careersIssue, careersIssueText, questionPresentation, vacancyPresentation, type CareersIssue } from '../../lib/careers-locale';
import s from './careers.module.css';

type Props = { vacancy: Vacancy; draft: ApplicationDraft; step: number; reviewing: boolean; question?: string; returnToReview?: boolean; completed?: boolean;
  onChange: (draft: ApplicationDraft) => void; onStep: (target: FormTarget) => void;
  onBack: (target?: FormTarget) => void; onBackToJob: () => void; onSubmit: () => string | CareersIssue | null | Promise<string | CareersIssue | null>;
  live?: { privacyText: string; status: string }; };

export function ApplicationFunnel({ vacancy, draft, step, reviewing, question, returnToReview = false, completed = false, onChange, onStep, onBack, onBackToJob, onSubmit, live }: Props) {
  const { locale, text } = useCareersLanguage();
  const [rawErrors, setErrors] = useState<Errors>({});
  const errors = careersFormErrors(locale, rawErrors, vacancy, !!live);
  const [fileIssue, setFileIssue] = useState<CareersIssue | null>(null);
  const presented = vacancyPresentation(vacancy, locale);
  const labelFor = (screen: FormScreen) => screen.question ? questionPresentation(vacancy, screen.question, locale).label : text(screen.label);
  const contentLocaleFor = (screen: FormScreen) => screen.question ? questionPresentation(vacancy, screen.question, locale).contentLocale : locale;
  const [photoBusy, setPhotoBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const busy = photoBusy || submitting;
  const photoGeneration = useRef(0);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const screens = formScreens(vacancy, draft);
  const active = screens.find(screen => reviewing ? screen.kind === 'review' : screen.id === question)
    || screens.find(screen => screen.stage === step)!;
  const progress = questionProgress(screens, active);
  const allErrors = validateApplication(draft, vacancy, reviewing);
  const stageComplete = [0, 1, 2].map(stage => !screens.some(screen => screen.stage === stage && screen.kind !== 'review' && Object.keys(screenErrors(screen, allErrors)).length > 0));
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setErrors({}); setFileIssue(null); heading.current?.focus({ preventScroll: true }); }, [active.id, vacancy.version]);
  useEffect(() => () => { photoGeneration.current += 1; }, []);
  function patch<K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) {
    if (completed) return;
    onChange({ ...draft, [key]: value });
    if (errors[key]) setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function move(screen: FormScreen, edit = false) { setErrors({}); setFileIssue(null); onStep(targetFor(screen, edit)); }
  async function next() {
    if (inFlight.current || photoBusy) return;
    if (completed) { await onSubmit(); return; }
    const found = reviewing ? allErrors : screenErrors(active, allErrors);
    if (Object.keys(found).length) {
      setErrors(found);
      const first = screens.find(screen => screen.kind !== 'review' && Object.keys(screenErrors(screen, found)).length > 0);
      if (reviewing && first) { onStep(targetFor(first, true)); return; }
      focusError(found); return;
    }
    if (!reviewing) {
      const nextScreen = returnToReview ? screens[screens.length - 1] : screens[screens.findIndex(screen => screen.id === active.id) + 1];
      move(nextScreen); return;
    }
    inFlight.current = true; setSubmitting(true);
    try { const issue = await onSubmit(); if (issue) setFileIssue(careersIssue(issue)); }
    catch (error) { setFileIssue(careersIssue(error)); }
    finally { inFlight.current = false; setSubmitting(false); }
  }
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || completed) return;
    const generation = ++photoGeneration.current;
    setPhotoBusy(true); setFileIssue(null);
    try {
      const photo = await prepareProfilePhoto(file);
      if (generation !== photoGeneration.current) return;
      const updated = { ...latestDraft.current, photo };
      if (totalFileBytes(updated) > 30 * 1024 * 1024) throw new Error('The combined files must be smaller than 30 MB.');
      onChange(updated);
      setErrors(previous => { const copy = { ...previous }; delete copy.photo; return copy; });
    } catch (error) { if (generation === photoGeneration.current) setFileIssue(careersIssue(error, 'Unable to open this photo.')); }
    finally { if (generation === photoGeneration.current) setPhotoBusy(false); }
  }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>, kind: 'cv' | 'document') {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length || completed) return;
    setFileIssue(null);
    for (const file of files) { const issue = fileError(file, kind); if (issue) { setFileIssue({ message: issue, fileName: file.name }); return; } }
    const updated = kind === 'cv' ? { ...draft, cv: files[0], noCv: false } : { ...draft, documents: [...draft.documents, ...files] };
    if (updated.documents.length > 5) { setFileIssue({ message: 'Select up to five supporting documents.' }); return; }
    if (totalFileBytes(updated) > 30 * 1024 * 1024) { setFileIssue({ message: 'The combined files must be smaller than 30 MB.' }); return; }
    onChange(updated);
    setErrors(previous => { const copy = { ...previous }; delete copy.cv; return copy; });
  }

  const requiredReady = Number(!!draft.photo) + Number(!!draft.cv || (!vacancy.cvRequired && draft.noCv));
  const previous = previousFormTarget(screens, active, returnToReview);
  const backLabel = returnToReview ? 'Back to review' : reviewing ? 'Back to documents' : previous ? 'Back to previous question' : 'Back to position details';
  function answerFor(screen: FormScreen): string {
    const value = screen.question ? draft.answers[screen.question.id] : screen.field ? draft[screen.field] : '';
    if (screen.field === 'phone') return `${draft.dialCode} ${draft.phone}`;
    if (['nationality', 'applyingFrom', 'residence'].includes(screen.field || '')) return countryName(String(value), locale);
    // Only configured selection labels are localized. Free text is never a dictionary key.
    if (screen.question && ['select', 'multiselect', 'yesno'].includes(screen.question.kind)) {
      const options = questionPresentation(vacancy, screen.question, locale).options;
      const display = (option: string) => options.find(item => item.value === option)?.label || option;
      return Array.isArray(value) ? value.map(display).join(', ') : value ? display(String(value)) : text('Not provided');
    }
    if (screen.field === 'languages') return (value as string[]).map(item => text(item)).join(', ');
    if (screen.field === 'availability') return value ? text(String(value)) : text('Not provided');
    return Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? text(value ? 'Yes' : 'No') : value !== '' && value != null ? String(value) : text('Not provided');
  }
  return <div className={s.funnelLayout} data-careers-form-flow="questions-v4">
    <section className={s.formPanel} aria-label={text('Application form')}>
      <div className={s.questionRole}><BackControl label="Back to position details" disabled={busy} onClick={onBackToJob}/><span><small>{text('APPLYING FOR')}</small><strong lang={presented.contentLocale}>{presented.job.title}</strong></span></div>
      <FunnelSteps step={active.stage} completed={stageComplete} disabled={busy} onSelect={stage => move(screens.find(screen => screen.stage === stage)!)}/>
      <div className={s.formHeading}><span className={s.eyebrow}>{active.kind === 'review' ? text('FINAL REVIEW') : active.kind === 'documents' ? text('PHOTO & DOCUMENTS') : careersTemplate(locale, 'QUESTION {position} OF {total} · {stagePosition} OF {stageTotal} IN THIS SECTION', progress)}</span><h1 id="career-question-heading" lang={contentLocaleFor(active)} data-career-page-title ref={heading} tabIndex={-1}>{labelFor(active)}</h1>{reviewing && <p>{text('Review your original answers. Edit any question before you send.')}</p>}</div>
      {completed && <div className={s.informationCard} role="status"><CareerIcon name="check"/><div><strong>{text(live ? 'This application has been received.' : 'This preview application is already completed.')}</strong><p>{text('Your details remain available for review. Back and Forward will not create another application.')}</p></div></div>}
      {fileIssue && <Alert>{careersIssueText(locale, fileIssue)}</Alert>}
      <form noValidate onKeyDown={event => {
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
      }} onSubmit={event => { event.preventDefault(); if (!busy) void next(); }}>
        <fieldset className={s.formFieldset} disabled={completed || submitting} data-career-form-fields aria-label={text('Application details')}>
        {(active.kind === 'profile' || active.kind === 'role') && <FunnelQuestion vacancy={vacancy} key={active.id} screen={active} draft={draft} errors={errors} onChange={updated => {
          if (!completed) { onChange(updated); setErrors({}); }
        }}/>}
        {step === 2 && !reviewing && <div className={s.documentStack}>
          <div className={s.sectionHeading}><h2>{text('Upload documents')}</h2><span className={requiredReady === 2 ? s.readyBadge : s.badge}>{careersTemplate(locale, '{ready} / 2 ready', { ready: requiredReady })}</span></div>
          <section className={s.uploadCard} aria-labelledby="photo-title"><div className={s.uploadHeading}><span className={s.iconTile}><CareerIcon name="person"/></span><div><h2 id="photo-title">{text('Profile photo')} <span className={s.requiredMark}>*</span></h2><p>{text('A recent photo of you. No professional photo needed.')}</p></div>{draft.photo && !photoBusy && <span className={s.greenCheck} aria-label={text('Photo selected')}><CareerIcon name="check"/></span>}</div>
            <div className={s.photoRow}>{draft.photo ? <img className={s.photoPreview} src={draft.photo.dataUrl} alt={text('Your selected profile photo')}/> : <div className={s.photoPlaceholder}><CareerIcon name="person"/></div>}<div className={s.photoActions}>
              <label className={`${s.secondary} ${s.fileControl}`}><CareerIcon name="upload"/>{text(draft.photo ? 'Replace photo' : 'Select photo')}<input id="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={choosePhoto} disabled={busy} aria-label={text('Select profile photo')}/></label>
              <label className={`${s.textButton} ${s.fileControl}`}><CareerIcon name="camera"/>{text('Take a photo')}<input type="file" accept="image/*" capture="user" onChange={choosePhoto} disabled={busy} aria-label={text('Take profile photo')}/></label>
              {draft.photo && <button type="button" className={s.textButton} onClick={() => patch('photo', null)} disabled={busy}>{text('Remove photo')}</button>}
            </div></div>
            <div className={s.fileStatus} role="status">{photoBusy ? <><span className={s.spinner}/>{text('Preparing photo…')}</> : draft.photo ? <><span className={s.statusDot}/>{text('Photo selected for review')}</> : text('JPG, PNG or WebP · Up to 10 MB')}</div>
            <details className={s.fileHelp}><summary>{text('Photo formats & privacy')}</summary><p>{text('HEIC is supported only when this browser can open it. Otherwise select JPG/PNG or use the camera.')} {text(live ? 'Your photo will be processed and stored privately when you submit. It is not used for automated scoring.' : 'The photo stays in this preview tab, is not uploaded, and is not used for automated scoring.')}</p></details>
            {errors.photo && <small className={s.error} role="alert">{errors.photo}</small>}
          </section>
          <section className={s.uploadCard}><div className={s.uploadHeading}><span className={s.iconTile}><CareerIcon name="file"/></span><div><h2>{text('CV / Resume')}{vacancy.cvRequired ? <span className={s.requiredMark}> *</span> : <span className={s.optional}>{text(' (optional)')}</span>}</h2><p>{text('PDF or DOCX · Up to 10 MB')}</p></div></div>
            {draft.cv && <ReadyFile file={draft.cv} onRemove={() => patch('cv', null)}/>}
            <label className={`${s.secondary} ${s.fileControl}`}><CareerIcon name="upload"/>{text(draft.cv ? 'Replace CV' : 'Select CV')}<input id="cv" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => chooseFiles(event, 'cv')} aria-label={text('Select CV')}/></label>
            {!vacancy.cvRequired && <label className={s.checkbox}><input type="checkbox" checked={draft.noCv} onChange={event => onChange({ ...draft, noCv: event.target.checked, cv: event.target.checked ? null : draft.cv })}/>{text('I do not have a CV')}</label>}
            {errors.cv && <small className={s.error} role="alert">{errors.cv}</small>}
          </section>
          <section className={s.uploadCard}><div className={s.uploadHeading}><span className={s.iconTile}><CareerIcon name="certificate"/></span><div><h2>{text('Certificates & courses')}</h2><p>{text('Optional · Studies, specializations or other documents')}</p></div></div>
            {draft.documents.map((file, index) => <ReadyFile key={`${file.name}-${index}`} file={file} onRemove={() => patch('documents', draft.documents.filter((_, at) => at !== index))}/>)}
            <div className={s.documentActions}><label className={`${s.secondary} ${s.fileControl}`}><CareerIcon name="upload"/>{text('Choose files')}{/* A general picker keeps PDF accessible on Android. */}<input id="supporting-files" type="file" multiple onChange={event => chooseFiles(event, 'document')} aria-label={text('Choose supporting files')}/></label><label className={`${s.textButton} ${s.fileControl}`}><CareerIcon name="camera"/>{text('Take photo')}<input type="file" accept="image/*" capture="environment" onChange={event => chooseFiles(event, 'document')} aria-label={text('Photograph a document')}/></label></div>
            <small>{text('PDF, JPG, PNG or WebP · Up to 5 files, 10 MB each')}</small>
          </section>
          <p className={s.previewNotice}><CareerIcon name="lock"/>{text(live ? 'Selected files will be uploaded and security-checked when you submit.' : 'Preview: selected files stay in this tab. Nothing is uploaded or scanned.')}</p>
        </div>}
        {reviewing && <div className={s.formFields}>
          {([0, 1] as const).map(stage => <section className={s.reviewCard} key={stage}>
            <div className={s.sectionHeading}><h2><CareerIcon name={stage === 0 ? 'person' : 'briefcase'}/>{text(stage === 0 ? 'Contact details' : 'Experience')}</h2></div>
            {stage === 0 && draft.photo && <img className={s.avatar} src={draft.photo.dataUrl} alt={text('Your profile photo')}/>}
            <dl className={`${s.answers} ${s.editableAnswers}`}>{screens.filter(screen => screen.stage === stage).map(screen => <div key={screen.id}>
              <dt lang={contentLocaleFor(screen)}>{labelFor(screen)}</dt><dd lang={screen.question ? ['select', 'multiselect', 'yesno'].includes(screen.question.kind) ? contentLocaleFor(screen) : '' : ['languages', 'availability', 'nationality', 'applyingFrom', 'residence', 'whatsapp', 'sameResidence'].includes(screen.field || '') ? locale : ''}>{answerFor(screen)}</dd><button type="button" className={s.textButton} aria-label={careersTemplate(locale, 'Edit {label}', { label: labelFor(screen) })} onClick={() => move(screen, true)}>{text('Edit')}</button>
            </div>)}</dl>
          </section>)}
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2><CareerIcon name="file"/>{text('Documents')}</h2><button type="button" className={s.textButton} onClick={() => move(screens.find(screen => screen.kind === 'documents')!, true)}>{text('Edit')}</button></div><p className={s.readyLine}><CareerIcon name="check"/>{text('Recent profile photo selected')}</p><p className={s.readyLine}><CareerIcon name="check"/>{draft.cv?.name || text('CV optional for this role')}</p>{draft.documents.map((file, index) => <p className={s.readyLine} key={`${file.name}-${index}`}><CareerIcon name="check"/>{file.name}</p>)}</section>
          <details className={s.privacy}><summary>{text(live ? 'Recruitment privacy notice' : 'How this preview uses your information')}</summary>{live && locale === 'es' && <p lang="es">{text('The privacy notice is shown in its configured original language; a reviewed Spanish version is still pending.')}</p>}<p lang={live ? '' : locale} style={{ whiteSpace: 'pre-wrap' }}>{live ? live.privacyText : text('This is a design preview, not a live recruitment service. Details, photos and files remain in memory in this browser tab. They are not sent to DEMAC, a database or an email provider. Refreshing or closing this page clears the session. Use fictional details and test files. Production privacy and retention settings still require approval.')}</p></details>
          <label className={s.checkbox}><input id="privacy" type="checkbox" checked={draft.privacy} onChange={event => patch('privacy', event.target.checked)} aria-invalid={!!errors.privacy}/>{text(live ? 'I have read the recruitment privacy notice.' : 'I have read the preview privacy information.')}</label>{errors.privacy && <small className={s.error} role="alert">{errors.privacy}</small>}
          <label className={s.checkbox}><input type="checkbox" checked={draft.futureTalent} onChange={event => patch('futureTalent', event.target.checked)}/>{text(live ? 'Keep my profile for future openings (optional).' : 'Keep my profile for future openings (optional; simulated in preview).')}</label>
        </div>}
        </fieldset>
        <div className={s.formActions}><BackControl label={backLabel} disabled={busy} onClick={() => onBack(previous)}/><button className={s.primary} type="submit" disabled={busy}>{submitting ? (live?.status || text('Submitting…')) : text(photoBusy ? 'Preparing photo…' : completed ? 'View confirmation' : reviewing ? (live ? 'Submit application' : 'Submit preview application') : returnToReview ? 'Return to review' : active.kind === 'documents' ? 'Review application' : 'Continue')}{!photoBusy && <CareerIcon name="arrow"/>}</button></div>
        <p className={s.previewNotice}><CareerIcon name="lock"/>{text('Your answers and selected files stay in this tab while you apply. Reloading or closing it clears this draft.')}</p>
      </form>
    </section>
  </div>;
}
