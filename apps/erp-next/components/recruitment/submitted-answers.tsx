import { submittedAnswerText, type SubmissionSnapshot, type SubmittedRow } from '../../../../functions/careers/submission-contract.js';

/** Read only the persisted snapshot. React escapes text; never inject answer HTML. */
export function SubmittedAnswers({ snapshot, panelClass, answersClass }: {
  snapshot: SubmissionSnapshot; panelClass: string; answersClass: string;
}) {
  const rows = (items: SubmittedRow[]) => <dl className={answersClass}>{items.map(row => <div key={row.id} data-submitted-question={row.id}>
    <dt lang={row.contentLocale}>{row.label}</dt>
    <dd lang="" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{submittedAnswerText(row) || '—'}</dd>
  </div>)}</dl>;
  return <>
    <section className={panelClass} data-submitted-locale={snapshot.localeAtSubmit}>
      <h2>Submitted details</h2>
      <p>Application language: <strong>{snapshot.localeAtSubmit === 'es' ? 'Español' : 'English'}</strong></p>
      <p>Form version {snapshot.vacancyVersion} · Editorial version {snapshot.editorialVersion}</p>
      <p>Original submission. Candidate text is not translated or corrected. Country values retain their original codes.</p>
      {rows(snapshot.fields)}
    </section>
    <section className={panelClass}><h2>Role answers</h2>{rows(snapshot.questions)}</section>
  </>;
}
