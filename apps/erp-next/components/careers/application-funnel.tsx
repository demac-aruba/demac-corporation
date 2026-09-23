'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { fileError, totalFileBytes, validateApplication, type ApplicationDraft, type Errors, type Vacancy } from '../../lib/careers-preview';
import { formScreens, targetFor, screenErrors, previousFormTarget, questionProgress, type FormTarget, type FormScreen } from '../../lib/careers-form-flow';
import { prepareProfilePhoto } from './profile-photo';
import { Alert, countryName, focusError } from './careers-ui';
import { BackControl, CareerIcon, FunnelSteps, ReadyFile } from './careers-visuals';
import { FunnelQuestion } from './funnel-question';
import s from './careers.module.css';

type Props = { vacancy: Vacancy; draft: ApplicationDraft; step: number; reviewing: boolean; question?: string; returnToReview?: boolean; completed?: boolean;
  onChange: (draft: ApplicationDraft) => void; onStep: (target: FormTarget) => void;
  onBack: (target?: FormTarget) => void; onBackToJob: () => void; onSubmit: () => string | null | Promise<string | null>;
  live?: { privacyText: string; status: string }; };

export function ApplicationFunnel({ vacancy, draft, step, reviewing, question, returnToReview = false, completed = false, onChange, onStep, onBack, onBackToJob, onSubmit, live }: Props) {
  const [errors, setErrors] = useState<Errors>({});
  const [fileIssue, setFileIssue] = useState('');
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
  useEffect(() => { setErrors({}); setFileIssue(''); heading.current?.focus({ preventScroll: true }); }, [active.id, vacancy.version]);
  useEffect(() => () => { photoGeneration.current += 1; }, []);
  function patch<K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) {
    if (completed) return;
    onChange({ ...draft, [key]: value });
    if (errors[key]) setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function move(screen: FormScreen, edit = false) { setErrors({}); setFileIssue(''); onStep(targetFor(screen, edit)); }
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
    try { const issue = await onSubmit(); if (issue) setFileIssue(issue); }
    catch (error) { setFileIssue(error instanceof Error ? error.message : 'Unable to submit. Please retry.'); }
    finally { inFlight.current = false; setSubmitting(false); }
  }
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file || completed) return;
    const generation = ++photoGeneration.current;
    setPhotoBusy(true); setFileIssue('');
    try {
      const photo = await prepareProfilePhoto(file);
      if (generation !== photoGeneration.current) return;
      const updated = { ...latestDraft.current, photo };
      if (totalFileBytes(updated) > 30 * 1024 * 1024) throw new Error('The combined files must be smaller than 30 MB.');
      onChange(updated);
      setErrors(previous => { const copy = { ...previous }; delete copy.photo; return copy; });
    } catch (error) { if (generation === photoGeneration.current) setFileIssue(error instanceof Error ? error.message : 'Unable to open this photo.'); }
    finally { if (generation === photoGeneration.current) setPhotoBusy(false); }
  }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>, kind: 'cv' | 'document') {
    const files = Array.from(event.target.files || []); event.target.value = '';
    if (!files.length || completed) return;
    setFileIssue('');
    for (const file of files) { const issue = fileError(file, kind); if (issue) { setFileIssue(`${file.name}: ${issue}`); return; } }
    const updated = kind === 'cv' ? { ...draft, cv: files[0], noCv: false } : { ...draft, documents: [...draft.documents, ...files] };
    if (updated.documents.length > 5) { setFileIssue('Select up to five supporting documents.'); return; }
    if (totalFileBytes(updated) > 30 * 1024 * 1024) { setFileIssue('The combined files must be smaller than 30 MB.'); return; }
    onChange(updated);
    setErrors(previous => { const copy = { ...previous }; delete copy.cv; return copy; });
  }

  const requiredReady = Number(!!draft.photo) + Number(!!draft.cv || (!vacancy.cvRequired && draft.noCv));
  const previous = previousFormTarget(screens, active, returnToReview);
  const backLabel = returnToReview ? 'Back to review' : reviewing ? 'Back to documents' : previous ? 'Back to previous question' : 'Back to position details';
  function answerFor(screen: FormScreen): string {
    const value = screen.question ? draft.answers[screen.question.id] : screen.field ? draft[screen.field] : '';
    if (screen.field === 'phone') return `${draft.dialCode} ${draft.phone}`;
    if (['nationality', 'applyingFrom', 'residence'].includes(screen.field || '')) return countryName(String(value));
    return Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value || 'Not provided');
  }
  return <div className={s.funnelLayout} data-careers-form-flow="questions-v4">
    <section className={s.formPanel} aria-label="Application form">
      <div className={s.questionRole}><BackControl label="Back to position details" disabled={busy} onClick={onBackToJob}/><span><small>APPLYING FOR</small><strong>{vacancy.title}</strong></span></div>
      <FunnelSteps step={active.stage} completed={stageComplete} disabled={busy} onSelect={stage => move(screens.find(screen => screen.stage === stage)!)}/>
      <div className={s.formHeading}><span className={s.eyebrow}>{active.kind === 'review' ? 'FINAL REVIEW' : active.kind === 'documents' ? 'PHOTO & DOCUMENTS' : `QUESTION ${progress.position} OF ${progress.total} · ${progress.stagePosition} OF ${progress.stageTotal} IN THIS SECTION`}</span><h1 id="career-question-heading" data-career-page-title ref={heading} tabIndex={-1}>{active.label}</h1>{reviewing && <p>Review your original answers. Edit any question before you send.</p>}</div>
      {completed && <div className={s.informationCard} role="status"><CareerIcon name="check"/><div><strong>{live ? 'This application has been received.' : 'This preview application is already completed.'}</strong><p>Your details remain available for review. Back and Forward will not create another application.</p></div></div>}
      {fileIssue && <Alert>{fileIssue}</Alert>}
      <form noValidate onKeyDown={event => {
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
      }} onSubmit={event => { event.preventDefault(); if (!busy) void next(); }}>
        <fieldset className={s.formFieldset} disabled={completed || submitting} data-career-form-fields aria-label="Application details">
        {(active.kind === 'profile' || active.kind === 'role') && <FunnelQuestion key={active.id} screen={active} draft={draft} errors={errors} onChange={updated => {
          if (!completed) { onChange(updated); setErrors({}); }
        }}/>}
        {step === 2 && !reviewing && <div className={s.documentStack}>
          <div className={s.sectionHeading}><h2>Upload documents</h2><span className={requiredReady === 2 ? s.readyBadge : s.badge}>{requiredReady} / 2 ready</span></div>
          <section className={s.uploadCard} aria-labelledby="photo-title"><div className={s.uploadHeading}><span className={s.iconTile}><CareerIcon name="person"/></span><div><h2 id="photo-title">Profile photo <span className={s.requiredMark}>*</span></h2><p>A recent photo of you. No professional photo needed.</p></div>{draft.photo && !photoBusy && <span className={s.greenCheck} aria-label="Photo selected"><CareerIcon name="check"/></span>}</div>
            <div className={s.photoRow}>{draft.photo ? <img className={s.photoPreview} src={draft.photo.dataUrl} alt="Your selected profile photo"/> : <div className={s.photoPlaceholder}><CareerIcon name="person"/></div>}<div className={s.photoActions}>
              <label className={`${s.secondary} ${s.fileControl}`}><CareerIcon name="upload"/>{draft.photo ? 'Replace photo' : 'Select photo'}<input id="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={choosePhoto} disabled={busy} aria-label="Select profile photo"/></label>
              <label className={`${s.textButton} ${s.fileControl}`}><CareerIcon name="camera"/>Take a photo<input type="file" accept="image/*" capture="user" onChange={choosePhoto} disabled={busy} aria-label="Take profile photo"/></label>
              {draft.photo && <button type="button" className={s.textButton} onClick={() => patch('photo', null)} disabled={busy}>Remove photo</button>}
            </div></div>
            <div className={s.fileStatus} role="status">{photoBusy ? <><span className={s.spinner}/>Preparing photo…</> : draft.photo ? <><span className={s.statusDot}/>Photo selected for review</> : 'JPG, PNG or WebP · Up to 10 MB'}</div>
            <details className={s.fileHelp}><summary>Photo formats & privacy</summary><p>HEIC is supported only when this browser can open it. Otherwise select JPG/PNG or use the camera. {live ? 'Your photo will be processed and stored privately when you submit. It is not used for automated scoring.' : 'The photo stays in this preview tab, is not uploaded, and is not used for automated scoring.'}</p></details>
            {errors.photo && <small className={s.error} role="alert">{errors.photo}</small>}
          </section>
          <section className={s.uploadCard}><div className={s.uploadHeading}><span className={s.iconTile}><CareerIcon name="file"/></span><div><h2>CV / Resume{vacancy.cvRequired ? <span className={s.requiredMark}> *</span> : <span className={s.optional}> (optional)</span>}</h2><p>PDF or DOCX · Up to 10 MB</p></div></div>
            {draft.cv && <ReadyFile file={draft.cv} onRemove={() => patch('cv', null)}/>}
            <label className={`${s.secondary} ${s.fileControl}`}><CareerIcon name="upload"/>{draft.cv ? 'Replace CV' : 'Select CV'}<input id="cv" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => chooseFiles(event, 'cv')} aria-label="Select CV"/></label>
            {!vacancy.cvRequired && <label className={s.checkbox}><input type="checkbox" checked={draft.noCv} onChange={event => onChange({ ...draft, noCv: event.target.checked, cv: event.target.checked ? null : draft.cv })}/>I do not have a CV</label>}
            {errors.cv && <small className={s.error} role="alert">{errors.cv}</small>}
          </section>
          <section className={s.uploadCard}><div className={s.uploadHeading}><span className={s.iconTile}><CareerIcon name="certificate"/></span><div><h2>Certificates & courses</h2><p>Optional · Studies, specializations or other documents</p></div></div>
            {draft.documents.map((file, index) => <ReadyFile key={`${file.name}-${index}`} file={file} onRemove={() => patch('documents', draft.documents.filter((_, at) => at !== index))}/>)}
            <div className={s.documentActions}><label className={`${s.secondary} ${s.fileControl}`}><CareerIcon name="upload"/>Choose files{/* A general picker keeps PDF accessible on Android. */}<input id="supporting-files" type="file" multiple onChange={event => chooseFiles(event, 'document')} aria-label="Choose supporting files"/></label><label className={`${s.textButton} ${s.fileControl}`}><CareerIcon name="camera"/>Take photo<input type="file" accept="image/*" capture="environment" onChange={event => chooseFiles(event, 'document')} aria-label="Photograph a document"/></label></div>
            <small>PDF, JPG, PNG or WebP · Up to 5 files, 10 MB each</small>
          </section>
          <p className={s.previewNotice}><CareerIcon name="lock"/>{live ? 'Selected files will be uploaded and security-checked when you submit.' : 'Preview: selected files stay in this tab. Nothing is uploaded or scanned.'}</p>
        </div>}
        {reviewing && <div className={s.formFields}>
          {([0, 1] as const).map(stage => <section className={s.reviewCard} key={stage}>
            <div className={s.sectionHeading}><h2><CareerIcon name={stage === 0 ? 'person' : 'briefcase'}/>{stage === 0 ? 'Contact details' : 'Experience'}</h2></div>
            {stage === 0 && draft.photo && <img className={s.avatar} src={draft.photo.dataUrl} alt="Your profile photo"/>}
            <dl className={`${s.answers} ${s.editableAnswers}`}>{screens.filter(screen => screen.stage === stage).map(screen => <div key={screen.id}>
              <dt>{screen.label}</dt><dd>{answerFor(screen)}</dd><button type="button" className={s.textButton} aria-label={`Edit ${screen.label}`} onClick={() => move(screen, true)}>Edit</button>
            </div>)}</dl>
          </section>)}
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2><CareerIcon name="file"/>Documents</h2><button type="button" className={s.textButton} onClick={() => move(screens.find(screen => screen.kind === 'documents')!, true)}>Edit</button></div><p className={s.readyLine}><CareerIcon name="check"/>Recent profile photo selected</p><p className={s.readyLine}><CareerIcon name="check"/>{draft.cv?.name || 'CV optional for this role'}</p>{draft.documents.map((file, index) => <p className={s.readyLine} key={`${file.name}-${index}`}><CareerIcon name="check"/>{file.name}</p>)}</section>
          <details className={s.privacy}><summary>{live ? 'Recruitment privacy notice' : 'How this preview uses your information'}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{live ? live.privacyText : 'This is a design preview, not a live recruitment service. Details, photos and files remain in memory in this browser tab. They are not sent to DEMAC, a database or an email provider. Refreshing or closing this page clears the session. Use fictional details and test files. Production privacy and retention settings still require approval.'}</p></details>
          <label className={s.checkbox}><input id="privacy" type="checkbox" checked={draft.privacy} onChange={event => patch('privacy', event.target.checked)} aria-invalid={!!errors.privacy}/>{live ? 'I have read the recruitment privacy notice.' : 'I have read the preview privacy information.'}</label>{errors.privacy && <small className={s.error} role="alert">{errors.privacy}</small>}
          <label className={s.checkbox}><input type="checkbox" checked={draft.futureTalent} onChange={event => patch('futureTalent', event.target.checked)}/>{live ? 'Keep my profile for future openings (optional).' : 'Keep my profile for future openings (optional; simulated in preview).'}</label>
        </div>}
        </fieldset>
        <div className={s.formActions}><BackControl label={backLabel} disabled={busy} onClick={() => onBack(previous)}/><button className={s.primary} type="submit" disabled={busy}>{submitting ? (live?.status || 'Submitting…') : photoBusy ? 'Preparing photo…' : completed ? 'View confirmation' : reviewing ? (live ? 'Submit application' : 'Submit preview application') : returnToReview ? 'Return to review' : active.kind === 'documents' ? 'Review application' : 'Continue'}{!photoBusy && <CareerIcon name="arrow"/>}</button></div>
        <p className={s.previewNotice}><CareerIcon name="lock"/>Your answers and selected files stay in this tab while you apply. Reloading or closing it clears this draft.</p>
      </form>
    </section>
  </div>;
}
