'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { dialingCodes, fileError, phoneInternational, totalFileBytes, validateStep, visibleQuestions, type ApplicationDraft, type Errors, type Question, type Vacancy } from '../../lib/careers-preview';
import { prepareProfilePhoto } from './profile-photo';
import { Alert, CountrySelect, Field, countryName, focusError, sizeLabel } from './careers-ui';
import s from './careers.module.css';

type Props = {
  vacancy: Vacancy; draft: ApplicationDraft; step: number; reviewing: boolean;
  onChange: (draft: ApplicationDraft) => void; onStep: (step: number, reviewing?: boolean) => void;
  onBackToJob: () => void; onSubmit: () => string | null;
};
const titles = ['About you', 'Your experience', 'Photo & documents'];
function QuestionField({ question: q, value, error, onChange }: { question: Question; value: string | string[] | undefined; error?: string; onChange: (value: string | string[]) => void }) {
  const id = `q-${q.id}`;
  if (q.kind === 'multiselect' || q.kind === 'yesno') {
    const options = q.kind === 'yesno' ? ['Yes', 'No'] : (q.options || []);
    return <fieldset className={s.choiceField} id={id} tabIndex={-1} aria-describedby={error ? `${id}-error` : undefined}><legend>{q.label}{!q.required && <span className={s.optional}> (optional)</span>}</legend><div className={s.choices}>{options.map(option => {
      const checked = Array.isArray(value) ? value.includes(option) : value === option;
      return <label className={checked ? s.choiceSelected : s.choice} key={option}><input type={q.kind === 'yesno' ? 'radio' : 'checkbox'} name={id} checked={checked} onChange={() => onChange(q.kind === 'yesno' ? option : checked ? (Array.isArray(value) ? value.filter(v => v !== option) : []) : [...(Array.isArray(value) ? value : []), option])} />{option}</label>;
    })}</div>{error && <small className={s.error} id={`${id}-error`} role="alert">{error}</small>}</fieldset>;
  }
  const shared = { id, value: typeof value === 'string' ? value : '', 'aria-invalid': !!error, 'aria-describedby': error ? `${id}-error` : undefined, onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  return <Field id={id} label={q.label} optional={!q.required} error={error}>{q.kind === 'select' ? <select {...shared}><option value="">Select an answer</option>{q.options?.map(option => <option key={option} value={option}>{option}</option>)}</select> : q.kind === 'textarea' ? <textarea {...shared} rows={3} maxLength={1200} /> : <input {...shared} type={q.kind === 'number' ? 'number' : 'text'} min={q.kind === 'number' ? 0 : undefined} maxLength={q.kind === 'number' ? undefined : 240} />}</Field>;
}

export function ApplicationFunnel({ vacancy, draft, step, reviewing, onChange, onStep, onBackToJob, onSubmit }: Props) {
  const [errors, setErrors] = useState<Errors>({});
  const [fileIssue, setFileIssue] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [otherDial, setOtherDial] = useState(!dialingCodes.some(([code]) => code === draft.dialCode));
  const photoGeneration = useRef(0);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step, reviewing]);
  useEffect(() => () => { photoGeneration.current += 1; }, []);
  function patch<K extends keyof ApplicationDraft>(key: K, value: ApplicationDraft[K]) {
    onChange({ ...draft, [key]: value });
    if (errors[key]) setErrors(previous => { const next = { ...previous }; delete next[key]; return next; });
  }
  function move(next: number, review = false) { setErrors({}); setFileIssue(''); onStep(next, review); }
  function next() {
    const found = validateStep(draft, vacancy, step, reviewing);
    if (totalFileBytes(draft) > 30 * 1024 * 1024) found.cv = 'The combined files must be smaller than 30 MB.';
    if (Object.keys(found).length) { setErrors(found); focusError(found); return; }
    if (step < 2) { move(step + 1); return; }
    if (!reviewing) { move(2, true); return; }
    const all = { ...validateStep(draft, vacancy, 0), ...validateStep(draft, vacancy, 1), ...validateStep(draft, vacancy, 2, true) };
    if (Object.keys(all).length) { setErrors(all); return; }
    const issue = onSubmit();
    if (issue) setFileIssue(issue);
  }
  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const generation = ++photoGeneration.current;
    setPhotoBusy(true); setFileIssue('');
    try {
      const photo = await prepareProfilePhoto(file);
      if (generation !== photoGeneration.current) return;
      const updated = { ...latestDraft.current, photo };
      if (totalFileBytes(updated) > 30 * 1024 * 1024) throw new Error('The combined files must be smaller than 30 MB.');
      onChange(updated);
      setErrors(previous => { const nextErrors = { ...previous }; delete nextErrors.photo; return nextErrors; });
    } catch (error) {
      if (generation === photoGeneration.current) setFileIssue(error instanceof Error ? error.message : 'Unable to open this photo.');
    } finally { if (generation === photoGeneration.current) setPhotoBusy(false); }
  }
  function chooseFiles(event: ChangeEvent<HTMLInputElement>, kind: 'cv' | 'document') {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    setFileIssue('');
    for (const file of files) { const issue = fileError(file, kind); if (issue) { setFileIssue(`${file.name}: ${issue}`); return; } }
    const updated = kind === 'cv' ? { ...draft, cv: files[0], noCv: false } : { ...draft, documents: [...draft.documents, ...files] };
    if (updated.documents.length > 5) { setFileIssue('Select up to five supporting documents.'); return; }
    if (totalFileBytes(updated) > 30 * 1024 * 1024) { setFileIssue('The combined files must be smaller than 30 MB.'); return; }
    onChange(updated);
    setErrors(previous => { const nextErrors = { ...previous }; delete nextErrors.cv; return nextErrors; });
  }
  const input = (id: keyof ApplicationDraft, type = 'text', autoComplete?: string) => ({ id, type, autoComplete, value: String(draft[id] ?? ''), onChange: (event: ChangeEvent<HTMLInputElement>) => patch(id, event.target.value), 'aria-invalid': !!errors[id], 'aria-describedby': errors[id] ? `${id}-error` : undefined });
  return <div className={s.funnelLayout}>
    <aside className={s.roleAside}><span className={s.eyebrow}>YOU ARE APPLYING FOR</span><h2>{vacancy.title}</h2><p>{vacancy.location} · {vacancy.contract}</p><hr /><strong>Three simple steps.</strong><p>Tell us about yourself, share your experience and add your documents.</p><p>No account or password needed.</p><button className={s.textButton} type="button" onClick={onBackToJob}>← Back to role details</button></aside>
    <section className={s.formPanel} aria-label="Application form">
      <div className={s.mobileRole}>{vacancy.title}<button type="button" className={s.textButton} onClick={onBackToJob}>Role details</button></div>
      <nav className={s.steps} aria-label="Application progress">{titles.map((title, index) => <button key={title} type="button" disabled={index > step || photoBusy} onClick={() => move(index)} aria-current={index === step ? 'step' : undefined} className={index <= step ? s.stepActive : s.step}><span>{index < step ? '✓' : index + 1}</span><small>{index === 2 ? 'Documents' : title}</small></button>)}</nav>
      <div className={s.formHeading}><span className={s.eyebrow}>STEP {step + 1} OF 3{reviewing ? ' · FINAL REVIEW' : ''}</span><h1 ref={heading} tabIndex={-1}>{reviewing ? 'Ready to send?' : titles[step]}</h1><p>{reviewing ? 'Check your details. You can still make changes.' : step === 0 ? 'Let’s start with the best way to reach you.' : step === 1 ? 'A few questions about what you do best.' : 'Add a recent photo and your relevant documents.'}</p></div>
      {fileIssue && <Alert>{fileIssue}</Alert>}
      <form noValidate onSubmit={event => { event.preventDefault(); if (!photoBusy) next(); }}>
        {step === 0 && <div className={s.formFields}>
          <div className={s.twoColumns}><Field id="givenName" label="First name" error={errors.givenName}><input {...input('givenName', 'text', 'given-name')} maxLength={80} /></Field><Field id="familyName" label="Last name" error={errors.familyName}><input {...input('familyName', 'text', 'family-name')} maxLength={100} /></Field></div>
          <Field id="email" label="Email address" error={errors.email} hint="We will use this address for your application updates."><input {...input('email', 'email', 'email')} inputMode="email" maxLength={254} /></Field>
          <div className={s.phoneRow}><Field id="dialCode" label="Country code" error={errors.dialCode}><select id="dialCode" value={otherDial ? 'other' : draft.dialCode} onChange={event => { const other = event.target.value === 'other'; setOtherDial(other); patch('dialCode', other ? '' : event.target.value); }} aria-invalid={!!errors.dialCode}>{dialingCodes.map(([code, country]) => <option key={code} value={code}>{code} · {country}</option>)}<option value="other">Other code</option></select>{otherDial && <input type="tel" aria-label="Other country calling code" value={draft.dialCode} onChange={event => patch('dialCode', event.target.value)} placeholder="+…" maxLength={5} />}</Field><Field id="phone" label="Phone number" error={errors.phone}><input {...input('phone', 'tel', 'tel-national')} maxLength={24} /></Field></div>
          <label className={s.checkbox}><input type="checkbox" checked={draft.whatsapp} onChange={event => patch('whatsapp', event.target.checked)} />This number is also on WhatsApp</label>
          <Field id="nationality" label="Nationality" error={errors.nationality}><CountrySelect id="nationality" value={draft.nationality} onChange={value => patch('nationality', value)} error={errors.nationality} /></Field>
          <Field id="applyingFrom" label="Country you are applying from" error={errors.applyingFrom}><CountrySelect id="applyingFrom" value={draft.applyingFrom} onChange={value => patch('applyingFrom', value)} error={errors.applyingFrom} /></Field>
          <label className={s.checkbox}><input type="checkbox" checked={draft.sameResidence} onChange={event => patch('sameResidence', event.target.checked)} />I also live in this country</label>
          {!draft.sameResidence && <Field id="residence" label="Country of residence" error={errors.residence}><CountrySelect id="residence" value={draft.residence} onChange={value => patch('residence', value)} error={errors.residence} /></Field>}
          <Field id="city" label="City" error={errors.city}><input {...input('city', 'text', 'address-level2')} maxLength={120} /></Field>
        </div>}
        {step === 1 && <div className={s.formFields}>
          <div className={s.twoColumns}><Field id="totalExperience" label="Total years of work experience" error={errors.totalExperience}><input {...input('totalExperience', 'number')} min="0" max="70" step="0.5" inputMode="decimal" /></Field><Field id="relevantExperience" label="Years relevant to this role" error={errors.relevantExperience}><input {...input('relevantExperience', 'number')} min="0" max="70" step="0.5" inputMode="decimal" /></Field></div>
          {visibleQuestions(vacancy, draft).map(q => <QuestionField key={q.id} question={q} value={draft.answers[q.id]} error={errors[`q-${q.id}`]} onChange={value => { onChange({ ...draft, answers: { ...draft.answers, [q.id]: value } }); setErrors(previous => { const copy = { ...previous }; delete copy[`q-${q.id}`]; return copy; }); }} />)}
          <div id="languages" tabIndex={-1}><QuestionField question={{ id: 'languages', label: 'Which languages do you speak?', kind: 'multiselect', required: true, options: ['English', 'Spanish', 'Papiamento', 'Dutch', 'Other'] }} value={draft.languages} error={errors.languages} onChange={value => patch('languages', Array.isArray(value) ? value : [value])} /></div>
          <Field id="availability" label="When could you start?" error={errors.availability}><select id="availability" value={draft.availability} onChange={event => patch('availability', event.target.value)} aria-invalid={!!errors.availability}><option value="">Select availability</option><option>Immediately</option><option>Within 2 weeks</option><option>Within 1 month</option><option>More than 1 month</option><option>To be discussed</option></select></Field>
        </div>}
        {step === 2 && !reviewing && <div className={s.formFields}>
          <section className={s.uploadCard} aria-labelledby="photo-title"><div className={s.sectionHeading}><div><h2 id="photo-title">Your profile photo</h2><p>Required · A recent photo of you. It does not need to be professional.</p></div></div>
            <div className={s.photoRow}>{draft.photo ? <img className={s.photoPreview} src={draft.photo.dataUrl} alt="Your selected profile photo" /> : <div className={s.photoPlaceholder} aria-hidden="true">＋</div>}<div className={s.photoActions}>
              <label className={`${s.secondary} ${s.fileControl}`}>Select photo<input id="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={choosePhoto} disabled={photoBusy} aria-label="Select profile photo" /></label>
              <label className={`${s.textButton} ${s.fileControl}`}>Take a photo<input type="file" accept="image/*" capture="user" onChange={choosePhoto} disabled={photoBusy} aria-label="Take profile photo" /></label>
              {draft.photo && <button type="button" className={s.textButton} onClick={() => patch('photo', null)} disabled={photoBusy}>Remove photo</button>}
            </div></div>
            <small>JPG, PNG or WebP · Up to 10 MB. HEIC works only when this browser can open it; otherwise use JPG/PNG or the camera.</small>
            <p className={s.fileStatus} role="status">{photoBusy ? 'Preparing your photo…' : draft.photo ? '✓ Photo ready for review. Not sent to production.' : 'Your photo is used for your candidate profile, not automated scoring.'}</p>{errors.photo && <small className={s.error} role="alert">{errors.photo}</small>}
          </section>
          <section className={s.uploadCard}><h2>CV / Resume{!vacancy.cvRequired && <span className={s.optional}> (optional)</span>}</h2><p>PDF or DOCX · Up to 10 MB.</p>{draft.cv && <div className={s.fileRow}><span><strong>{draft.cv.name}</strong><small>{sizeLabel(draft.cv.size)} · Ready for review</small></span><button type="button" className={s.textButton} onClick={() => patch('cv', null)}>Remove</button></div>}
            <label className={`${s.secondary} ${s.fileControl}`}>{draft.cv ? 'Replace CV' : 'Select CV'}<input id="cv" type="file" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={event => chooseFiles(event, 'cv')} aria-label="Select CV" /></label>
            {!vacancy.cvRequired && <label className={s.checkbox}><input type="checkbox" checked={draft.noCv} onChange={event => onChange({ ...draft, noCv: event.target.checked, cv: event.target.checked ? null : draft.cv })} />I do not have a CV</label>}{errors.cv && <small className={s.error} role="alert">{errors.cv}</small>}
          </section>
          <section className={s.uploadCard}><h2>Certificates & other documents <span className={s.optional}>(optional)</span></h2><p>Courses, studies or specializations. Up to five files, 10 MB each.</p>{draft.documents.map((file, index) => <div key={`${file.name}-${index}`} className={s.fileRow}><span><strong>{file.name}</strong><small>{sizeLabel(file.size)} · Ready for review</small></span><button type="button" className={s.textButton} aria-label={`Remove ${file.name}`} onClick={() => patch('documents', draft.documents.filter((_, at) => at !== index))}>Remove</button></div>)}<label className={`${s.secondary} ${s.fileControl}`}>Add documents<input type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={event => chooseFiles(event, 'document')} aria-label="Add supporting documents" /></label></section>
          <p className={s.helper}>Preview only: files stay in this browser session. Nothing is uploaded or scanned. Please use test documents.</p>
        </div>}
        {step === 2 && reviewing && <div className={s.formFields}>
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2>Contact details</h2><button type="button" className={s.textButton} onClick={() => move(0)}>Edit</button></div><div className={s.profileHeading}>{draft.photo && <img className={s.avatar} src={draft.photo.dataUrl} alt="Your profile photo" />}<div><strong>{draft.givenName} {draft.familyName}</strong><p>{draft.email}</p><p>{phoneInternational(draft)}</p></div></div><p>{draft.city}, {countryName(draft.sameResidence ? draft.applyingFrom : draft.residence)}</p><p>Nationality: {countryName(draft.nationality)}</p></section>
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2>Experience</h2><button type="button" className={s.textButton} onClick={() => move(1)}>Edit</button></div><p>{draft.totalExperience} years total · {draft.relevantExperience} years relevant</p><p>{draft.languages.join(', ')} · {draft.availability}</p><dl className={s.answers}>{visibleQuestions(vacancy, draft).map(q => <div key={q.id}><dt>{q.label}</dt><dd>{Array.isArray(draft.answers[q.id]) ? (draft.answers[q.id] as string[]).join(', ') : draft.answers[q.id] || 'Not provided'}</dd></div>)}</dl></section>
          <section className={s.reviewCard}><div className={s.sectionHeading}><h2>Documents</h2><button type="button" className={s.textButton} onClick={() => move(2)}>Edit</button></div><p>✓ Recent profile photo selected</p><p>{draft.cv?.name || 'No CV provided for this optional-CV role'}</p>{draft.documents.map((file, index) => <p key={`${file.name}-${index}`}>{file.name}</p>)}</section>
          <details className={s.privacy}><summary>How this preview uses your information</summary><p>This is a product preview, not a live recruitment service. Details, photos and files remain in memory in this browser tab; they are not sent to DEMAC, a database or an email provider. Refreshing or closing this page clears this preview session. Use fictional contact information and test files. Production recruitment privacy and retention settings still require approval.</p></details>
          <label className={s.checkbox}><input id="privacy" type="checkbox" checked={draft.privacy} onChange={event => patch('privacy', event.target.checked)} aria-invalid={!!errors.privacy} />I have read the preview privacy information.</label>{errors.privacy && <small className={s.error} role="alert">{errors.privacy}</small>}
          <label className={s.checkbox}><input type="checkbox" checked={draft.futureTalent} onChange={event => patch('futureTalent', event.target.checked)} />Keep my profile for future openings (optional; simulated in preview).</label>
        </div>}
        <div className={s.formActions}><button className={s.secondary} type="button" disabled={photoBusy} onClick={() => reviewing ? move(2) : step > 0 ? move(step - 1) : onBackToJob()}>← Back</button><button className={s.primary} type="submit" disabled={photoBusy}>{photoBusy ? 'Preparing photo…' : reviewing ? 'Submit preview application' : step === 2 ? 'Review application →' : 'Continue →'}</button></div>
      </form>
    </section>
  </div>;
}
