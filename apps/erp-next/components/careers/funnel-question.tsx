'use client';

import { useState, type ChangeEvent } from 'react';
import { dialingCodes, type ApplicationDraft, type Errors, type Question } from '../../lib/careers-preview';
import type { FormScreen, ProfileField } from '../../lib/careers-form-flow';
import { CountrySelect, Field } from './careers-ui';
import { CareerIcon } from './careers-visuals';
import s from './careers.module.css';

const textFields = { givenName: { autoComplete: 'given-name', maxLength: 80 }, familyName: { autoComplete: 'family-name', maxLength: 100 }, email: { autoComplete: 'email', maxLength: 254 }, city: { autoComplete: 'address-level2', maxLength: 120 } };
interface Props { screen: FormScreen; draft: ApplicationDraft; errors: Errors; onChange: (draft: ApplicationDraft) => void }
/** One conceptual question. Option values and answer text are never rewritten. */
export function FunnelQuestion({ screen, draft, errors, onChange }: Props) {
  const [otherDial, setOtherDial] = useState(!dialingCodes.some(([code]) => code === draft.dialCode));
  const patch = (field: ProfileField | 'dialCode', value: string | string[] | boolean) => onChange({ ...draft, [field]: value });
  const errorId = (id: string) => errors[id] ? `${id}-error` : undefined;
  const message = (id: string) => errors[id] ? <small className={s.error} id={`${id}-error`} role="alert">{errors[id]}</small> : null;
  const input = (field: ProfileField, type = 'text', autoComplete?: string) => ({
    id: field, type, autoComplete, value: String(draft[field] ?? ''),
    onChange: (event: ChangeEvent<HTMLInputElement>) => patch(field, event.target.value),
    'aria-labelledby': 'career-question-heading', 'aria-invalid': !!errors[field], 'aria-describedby': errorId(field),
  });
  function choices(id: string, options: readonly string[], value: string | string[], multiple: boolean, set: (value: string | string[]) => void) {
    return <fieldset className={s.choiceField} id={id} tabIndex={-1} aria-labelledby="career-question-heading" aria-describedby={errorId(id)} aria-invalid={!!errors[id]}>
      <div className={s.questionChoices}>{options.map(option => {
        const checked = Array.isArray(value) ? value.includes(option) : value === option;
        return <label className={checked ? s.choiceSelected : s.choice} key={option}>
          <input type={multiple ? 'checkbox' : 'radio'} name={id} checked={checked}
            onChange={() => set(multiple ? checked ? (value as string[]).filter(item => item !== option) : [...(Array.isArray(value) ? value : []), option] : option)}/>
          <span>{option}</span>{checked && <CareerIcon name="check"/>}
        </label>;
      })}</div>{message(id)}
    </fieldset>;
  }
  function roleQuestion(question: Question) {
    const id = `q-${question.id}`, value = draft.answers[question.id];
    const set = (answer: string | string[]) => onChange({ ...draft, answers: { ...draft.answers, [question.id]: answer } });
    if (question.kind === 'multiselect' || question.kind === 'yesno') return choices(id,
      question.kind === 'yesno' ? ['Yes', 'No'] : question.options || [],
      question.kind === 'multiselect' ? Array.isArray(value) ? value : [] : typeof value === 'string' ? value : '',
      question.kind === 'multiselect', set);
    const shared = { id, value: typeof value === 'string' ? value : '', 'aria-labelledby': 'career-question-heading',
      'aria-invalid': !!errors[id], 'aria-describedby': errorId(id),
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(event.target.value) };
    return <div className={s.field}>{question.kind === 'select' ? <select {...shared}><option value="">Select an answer</option>{question.options?.map(option => <option key={option} value={option}>{option}</option>)}</select>
      : question.kind === 'textarea' ? <textarea {...shared} rows={5} maxLength={1200}/>
      : <input {...shared} type={['number', 'date', 'url'].includes(question.kind) ? question.kind : 'text'}
        inputMode={question.kind === 'number' ? 'decimal' : undefined} min={question.kind === 'number' ? 0 : undefined}
        step={question.kind === 'number' ? 'any' : undefined} maxLength={question.kind === 'number' ? undefined : 240}/>} {message(id)}</div>;
  }
  if (screen.kind === 'role' && screen.question) return <div className={s.activeQuestion} data-career-question={screen.id}>
    {!screen.question.required && <p className={s.helper}>Optional — you may continue without an answer.</p>}
    {screen.question.kind === 'multiselect' && <p className={s.helper}>Select all that apply, then continue.</p>}
    {roleQuestion(screen.question)}
  </div>;
  const field = screen.field;
  let control;
  if (field === 'phone') control = <div className={s.phoneRow}>
    <Field id="dialCode" label="Country code" error={errors.dialCode}>
      <select id="dialCode" value={otherDial ? 'other' : draft.dialCode} onChange={event => {
        const other = event.target.value === 'other'; setOtherDial(other); patch('dialCode', other ? '' : event.target.value);
      }} aria-invalid={!!errors.dialCode} aria-describedby={errorId('dialCode')}>
        {dialingCodes.map(([code, country]) => <option key={code} value={code}>{code} · {country}</option>)}<option value="other">Other code</option>
      </select>{otherDial && <input type="tel" aria-label="Other country calling code" value={draft.dialCode} onChange={event => patch('dialCode', event.target.value)} placeholder="+…" maxLength={5}/>}
    </Field>
    <Field id="phone" label="Phone number" error={errors.phone}><input {...input('phone', 'tel', 'tel-national')} aria-labelledby={undefined} maxLength={24}/></Field>
  </div>;
  else if (field === 'whatsapp' || field === 'sameResidence') control = choices(field, ['Yes', 'No'], draft[field] ? 'Yes' : 'No', false, value => patch(field, value === 'Yes'));
  else if (field === 'languages') control = <><p className={s.helper}>Select all that apply, then continue.</p>{choices('languages', ['English', 'Spanish', 'Papiamento', 'Dutch', 'Other'], draft.languages, true, value => patch('languages', Array.isArray(value) ? value : [value]))}</>;
  else if (field === 'availability') control = choices('availability', ['Immediately', 'Within 2 weeks', 'Within 1 month', 'More than 1 month', 'To be discussed'], draft.availability, false, value => patch('availability', String(value)));
  else if (field === 'nationality' || field === 'applyingFrom' || field === 'residence') control = <Field id={field} label={field === 'nationality' ? 'Nationality' : 'Country'} error={errors[field]}>
    <CountrySelect id={field} value={draft[field]} onChange={value => patch(field, value)} error={errors[field]}/>
  </Field>;
  else if (field) control = <div className={s.field}>{field === 'totalExperience' || field === 'relevantExperience' ?
    <input {...input(field, 'number')} min="0" max="70" step="0.5" inputMode="decimal"/>
    : <input {...input(field, field === 'email' ? 'email' : 'text', textFields[field as keyof typeof textFields]?.autoComplete)}
      maxLength={textFields[field as keyof typeof textFields]?.maxLength}/>}{message(field)}</div>;
  return <div className={s.activeQuestion} data-career-question={screen.id}>{control}</div>;
}
