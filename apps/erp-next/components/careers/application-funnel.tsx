'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { dialingCodes, fileError, phoneInternational, totalFileBytes, validateStep, visibleQuestions, type ApplicationDraft, type Errors, type Question, type Vacancy } from '../../lib/careers-preview';
import { prepareProfilePhoto } from './profile-photo';
import { Alert, CountrySelect, Field, countryName, focusError } from './careers-ui';
import { BackControl, CareerIcon, FunnelSteps, ReadyFile } from './careers-visuals';
import s from './careers.module.css';

type Props = { vacancy: Vacancy; draft: ApplicationDraft; step: number; reviewing: boolean; completed?: boolean;
  onChange: (draft: ApplicationDraft) => void; onStep: (step: number, reviewing?: boolean) => void;
  onBack: () => void; onBackToJob: () => void; onSubmit: () => string | null | Promise<string | null>;
  live?: { privacyText: string; status: string }; };
const titles = ['Your details', 'Your experience', 'Photo & documents'];
function QuestionField({ question: q, value, error, onChange }: { question: Question; value: string | string[] | undefined; error?: string; onChange: (value: string | string[]) => void }) {
  const id = `q-${q.id}`;
  if (q.kind === 'multiselect' || q.kind === 'yesno') {
    const options = q.kind === 'yesno' ? ['Yes', 'No'] : (q.options || []);
    return <fieldset className={s.choiceField} id={id} tabIndex={-1} aria-describedby={error ? `${id}-error` : undefined}><legend>{q.label}{!q.required && <span className={s.optional}> (optional)</span>}</legend><div className={s.choices}>{options.map(option => {
      const checked = Array.isArray(value) ? value.includes(option) : value === option;
      return <label className={checked ? s.choiceSelected : s.choice} key={option}><input type={q.kind === 'yesno' ? 'radio' : 'checkbox'} name={id} checked={checked} onChange={() => onChange(q.kind === 'yesno' ? option : checked ? (Array.isArray(value) ? value.filter(v => v !== option) : []) : [...(Array.isArray(value) ? value : []), option])}/>{option}</label>;
    })}</div>{error && <small className={s.error} id={`${id}-error`} role="alert">{error}</small>}</fieldset>;
  }
  const shared = { id, value: typeof value === 'string' ? value : '', 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined, onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  return <Field id={id} label={q.label} optional={!q.required} error={error}>{q.kind === 'select' ? <select {...shared}><option value="">Select an answer</option>{q.options?.map(option => <option key={option} value={option}>{option}</option>)}</select> : q.kind === 'textarea' ? <textarea {...shared} rows={3} maxLength={1200}/> : <input {...shared} type={q.kind === 'number' || q.kind === 'date' || q.kind === 'url' ? q.kind : 'text'} min={q.kind === 'number' ? 0 : undefined} maxLength={q.kind === 'number' ? undefined : 240}/>}</Field>;
}
export function ApplicationFunnel({ vacancy, draft, step, reviewing, completed = false, onChange, onStep, onBack, onBackToJob, onSubmit, live }: Props) {
  const [errors, setErrors] = useState<Errors>({});
  const [fileIssue, setFileIssue] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const inFlight = useRef(false);
  const busy = photoBusy || submitting;
  const [otherDial, setOtherDial] = useState(!dialingCodes.some(([code]) => code === draft.dialCode));
  const photoGeneration = useRef(0);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setErrors({}); setFileIssue(''); heading.current?.focus({ preventScroll: true }); }, [step, reviewing, vacancy.version]);
  useEffect(() => () => { photoGeneration.current += 1; }, []);
  function patch<K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) {
    if (completed) return;
    onChange({ ...draft, [key]: value });
    if (errors[key]) setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function move(next: number, review = false) { setErrors({}); setFileIssue(''); onStep(next, review); }
  async function next() {
    if (inFlight.current) return;
    if (completed) { await onSubmit(); return; }
    const found = validateStep(draft, vacancy, step, reviewing);
    if (totalFileBytes(draft) > 30 * 1024 * 1024) found.cv = 'The combined files must be smaller than 30 MB.';
    if (Object.keys(found).length) { setErrors(found); focusError(found); return; }
    if (step < 2) { move(step + 1); return; }
    if (!reviewing) { move(2, true); return; }
    const all = { ...validateStep(draft, vacancy, 0), ...validateStep(draft, vacancy, 1), ...validateStep(draft, vacancy, 2, true) };
    if (Object.keys(all).length) { setErrors(all); return; }
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
  const input = (id: keyof ApplicationDraft, type = 'text', autoComplete?: string) => ({ id, type, autoComplete, value: String(draft[id] ?? ''), onChange: (event: ChangeEvent<HTMLInputElement>) => patch(id, event.target.value), 'aria-invalid': !!errors[id], 'aria-describedby': errors[id] ? `${id}-error` : undefined });
  const requiredReady = Number(!!draft.photo) + Number(!!draft.cv || (!vacancy.cvRequired && draft.noCv));
  const backLabel = reviewing ? 'Back to documents' : step === 2 ? 'Back to experience' : step === 1 ? 'Back to your details' : 'Back to position details';
  return <div className={s.funnelLayout}>
    <aside className={s.roleAside}><div className={s.navigationRow} data-career-navrow><BackControl label="Back to position details" disabled={busy} onClick={onBackToJob}/><span>Position details</span></div><span className={s.eyebrow}>YOU ARE APPLYING FOR</span><h2>{vacancy.title}</h2><p>{vacancy.location} · {vacancy.contract}</p><hr/><strong>A few steps.<br/>A new opportunity.</strong><p>Share your experience and tell us what you can bring to the team.</p><small><CareerIcon name="lock"/>No account or password needed.</small></aside>
    <section className={s.formPanel} aria-label="Application form">
      <div className={s.mobileRole}><BackControl label="Back to position details" disabled={busy} onClick={onBackToJob}/><span><small>APPLYING FOR</small><strong>{vacancy.title}</strong></span></div>
      <FunnelSteps step={step} disabled={busy} onSelect={index => move(index)}/>
      <div className={s.formHeading}><span className={s.eyebrow}>STEP {step + 1} OF 3{reviewing ? ' · FINAL REVIEW' : ''}</span><h1 data-career-page-title ref={heading} tabIndex={-1}>{reviewing ? 'Review your application' : titles[step]}</h1><p>{reviewing ? 'Everything in one place. Make any final changes before you send.' : step === 0 ? 'Let’s start with the best way to reach you.' : step === 1 ? 'Tell us what you do best.' : 'Your profile photo, CV and relevant qualifications.'}</p></div>
      {completed && <div className={s.informationCard} role="status"><CareerIcon name="check"/><div><strong>{live ? 'This application has been received.' : 'This preview application is already completed.'}</strong><p>Your details remain available for review. Back and Forward will not create another application.</p></div></div>}
      {step === 0 && !completed && <div className={s.informationCard}><span className={s.iconTile}><CareerIcon name="person"/></span><div><strong>Let’s get to know you</strong><p>A few details so we can stay in touch.</p></div></div>}
      {fileIssue && <Alert>{fileIssue}</Alert>}
      <form noValidate onSubmit={event => { event.preventDefault(); if (!busy) void next(); }}>
        <fieldset className={s.formFieldset} disabled={completed || submitting} data-career-form-fields aria-label="Application details">
        {step === 0 && <div className={s.formFields}>
          <div className={s.twoColumns}><Field id="givenName" label="First name" error={errors.givenName}><input {...input('givenName', 'text', 'given-name')} maxLength={80}/></Field><Field id="familyName" label="Last name" error={errors.familyName}><input {...input('familyName', 'text', 'family-name')} maxLength={100}/></Field></div>
          <Field id="email" label="Email address" error={errors.email} hint="For updates about your application."><input {...input('email', 'email', 'email')} inputMode="email" maxLength={254}/></Field>
          <div className={s.phoneRow}><Field id="dialCode" label="Country code" error={errors.dialCode}><select id="dialCode" value={otherDial ? 'other' : draft.dialCode} onChange={event => { const other = event.target.value === 'other'; setOtherDial(other); patch('dialCode', other ? '' : event.target.value); }} aria-invalid={!!errors.dialCode}>{dialingCodes.map(([code, country]) => <option key={code} value={code}>{code} · {country}</option>)}<option value="other">Other code</option></select>{otherDial && <input type="tel" aria-label="Other country calling code" value={draft.dialCode} onChange={event => patch('dialCode', event.target.value)} placeholder="+…" maxLength={5}/>}</Field><Field id="phone" label="Phone number" error={errors.phone}><input {...input('phone', 'tel', 'tel-national')} maxLength={24}/></Field></div>
          <label className={s.checkbox}><input type="checkbox" checked={draft.whatsapp} onChange={event => patch('whatsapp', event.target.checked)}/>This number is also on WhatsApp</label>
          <Field id="nationality" label="Nationality" error={errors.nationality}><CountrySelect id="nationality" value={draft.nationality} onChange={value => patch('nationality', value)} error={errors.nationality}/></Field>
          <Field id="applyingFrom" label="Country you are applying from" error={errors.applyingFrom}><CountrySelect id="applyingFrom" value={draft.applyingFrom} onChange={value => patch('applyingFrom', value)} error={errors.applyingFrom}/></Field>
          <label className={s.checkbox}><input type="checkbox" checked={draft.sameResidence} onChange={event => patch('sameResidence', event.target.checked)}/>I also live in this country</label>
          {!draft.sameResidence && <Field id="residence" label="Country of residence" error={errors.residence}><CountrySelect id="residence" value={draft.residence} onChange={value => patch('residence', value)} error={errors.residence}/></Field>}
          <Field id="city" label="City" error={errors.city}><input {...input('city', 'text', 'address-level2')} maxLength={120}/></Field>
        </div>}
        {step === 1 && <div className={s.formFields}>
          <div className={s.twoColumns}><Field id="totalExperience" label="Total years of work experience" error={errors.totalExperience}><input {...input('totalExperience', 'number')} min="0" max="70" step="0.5" inputMode="decimal"/></Field><Field id="relevantExperience" label="Years relevant to this role" error={errors.relevantExperience}><input {...input('relevantExperience', 'number')} min="0" max="70" step="0.5" inputMode="decimal"/></Field></div>
          {visibleQuestions(vacancy, draft).map(q => <QuestionField key={q.id} question={q} value={draft.answers[q.id]} error={errors[`q-${q.id}`]} onChange={value => { onChange({ ...draft, answers: { ...draft.answers, [q.id]: value } }); setErrors(previous => { const copy = { ...previous }; delete copy[`q-${q.id}`]; return copy; }); }}/>) }
          <div id="languages" tabIndex={-1}><QuestionField question={{ id: 'languages', label: 'Which languages do you speak?', kind: 'multiselect', required: true, options: ['English', 'Spanish', 'Papiamento', 'Dutch', 'Other'] }} value={draft.languages} error={errors.languages} onChange={value => patch('languages', Array.isArray(value) ? value : [value])}/></div>
          <Field id="availability" label="When could you start?" error={errors.availability}><select id="availability" value={draft.availability} onChange={event => patch('availability', event.target.value)} aria-invalid={!!errors.availability}><option value="">Select availability</option><option>Immediately</option><option>Within 2 weeks</option><option>Within 1 month</option><option>More than 1 month</option><option>To be discussed</option></select></Field>
        </div>}
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
        {step === 2 && reviewing && <div className={s.formFields}>
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2><CareerIcon name="person"/>Contact details</h2><button type="button" className={s.textButton} onClick={() => move(0)}>Edit</button></div><div className={s.profileHeading}>{draft.photo && <img className={s.avatar} src={draft.photo.dataUrl} alt="Your profile photo"/>}<div><strong>{draft.givenName} {draft.familyName}</strong><p>{draft.email}</p><p>{phoneInternational(draft)}</p></div></div><p>{draft.city}, {countryName(draft.sameResidence ? draft.applyingFrom : draft.residence)}</p><p>Nationality: {countryName(draft.nationality)}</p></section>
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2><CareerIcon name="briefcase"/>Experience</h2><button type="button" className={s.textButton} onClick={() => move(1)}>Edit</button></div><p>{draft.totalExperience} years total · {draft.relevantExperience} years relevant</p><p>{draft.languages.join(', ')} · {draft.availability}</p><dl className={s.answers}>{visibleQuestions(vacancy, draft).map(q => <div key={q.id}><dt>{q.label}</dt><dd>{Array.isArray(draft.answers[q.id]) ? (draft.answers[q.id] as string[]).join(', ') : draft.answers[q.id] || 'Not provided'}</dd></div>)}</dl></section>
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2><CareerIcon name="file"/>Documents</h2><button type="button" className={s.textButton} onClick={() => move(2)}>Edit</button></div><p className={s.readyLine}><CareerIcon name="check"/>Recent profile photo selected</p><p className={s.readyLine}><CareerIcon name="check"/>{draft.cv?.name || 'CV optional for this role'}</p>{draft.documents.map((file, index) => <p className={s.readyLine} key={`${file.name}-${index}`}><CareerIcon name="check"/>{file.name}</p>)}</section>
          <details className={s.privacy}><summary>{live ? 'Recruitment privacy notice' : 'How this preview uses your information'}</summary><p style={{ whiteSpace: 'pre-wrap' }}>{live ? live.privacyText : 'This is a design preview, not a live recruitment service. Details, photos and files remain in memory in this browser tab. They are not sent to DEMAC, a database or an email provider. Refreshing or closing this page clears the session. Use fictional details and test files. Production privacy and retention settings still require approval.'}</p></details>
          <label className={s.checkbox}><input id="privacy" type="checkbox" checked={draft.privacy} onChange={event => patch('privacy', event.target.checked)} aria-invalid={!!errors.privacy}/>{live ? 'I have read the recruitment privacy notice.' : 'I have read the preview privacy information.'}</label>{errors.privacy && <small className={s.error} role="alert">{errors.privacy}</small>}
          <label className={s.checkbox}><input type="checkbox" checked={draft.futureTalent} onChange={event => patch('futureTalent', event.target.checked)}/>{live ? 'Keep my profile for future openings (optional).' : 'Keep my profile for future openings (optional; simulated in preview).'}</label>
        </div>}
        </fieldset>
        <div className={s.formActions}><BackControl label={backLabel} disabled={busy} onClick={onBack}/><button className={s.primary} type="submit" disabled={busy}>{submitting ? (live?.status || 'Submitting…') : photoBusy ? 'Preparing photo…' : completed ? 'View confirmation' : reviewing ? (live ? 'Submit application' : 'Submit preview application') : step === 2 ? 'Review application' : 'Continue'}{!photoBusy && <CareerIcon name="arrow"/>}</button></div>
      </form>
    </section>
  </div>;
}
