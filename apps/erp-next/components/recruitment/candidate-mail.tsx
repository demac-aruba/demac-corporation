import { candidateMessage } from '../../../../functions/careers/mail-contract';
import type { CandidateMessage, CandidateMailSummary } from '../../../../functions/careers/mail-contract';

const states: Record<string, string> = {
  queued: 'Pending — waiting for the email service', sending: 'Processing — acceptance not confirmed',
  sent: 'Accepted by the email server — legacy record; inbox delivery is not confirmed',
  smtp_accepted: 'Accepted by the email server — inbox delivery is not confirmed',
  rejected: 'Rejected by the email server', failed: 'Could not be sent',
  delivery_unknown: 'Delivery uncertain — do not resend automatically', cancelled: 'Cancelled',
  unavailable: 'No email status recorded', preview: 'Preview only — not queued or sent',
};
export function CandidateMail({ summary, message, panelClass }: {
  summary: CandidateMailSummary; message?: CandidateMessage | null; panelClass: string;
}) {
  return <section className={panelClass} data-candidate-mail={summary.status}>
    <h2>Candidate confirmation email</h2>
    <p role="status">{states[summary.status] || 'Status requires review'}</p>
    <p>Language: <strong>{summary.locale === 'es' ? 'Español' : summary.locale === 'en' ? 'English' : 'Not recorded'}</strong>
      {summary.templateVersion && <> · Template {summary.templateVersion}</>}</p>
    <p>Receiving an application is separate from delivering an email. An uncertain delivery is not retried automatically.</p>
    {message && <details><summary>View the prepared confirmation</summary>
      <p><strong>To:</strong> {message.to}</p><p><strong>Subject:</strong> <span>{message.subject}</span></p>
      <iframe title="Prepared candidate confirmation email" sandbox="" referrerPolicy="no-referrer"
        srcDoc={message.html} style={{ width: '100%', minHeight: 540, border: '1px solid #dce5ef', borderRadius: 8 }}/>
      <details><summary>Plain-text version</summary><pre lang={message.locale} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{message.text}</pre></details>
    </details>}
    <p>Internal mailbox copy: deferred by DEMAC until the mailbox is created and verified. No internal message is sent.</p>
  </section>;
}

/** Explicit sample content, not an applicant or a delivery attempt. */
export function CandidateMailSamples({panelClass}:{panelClass:string}) {
  return <section className={panelClass}><h2>Confirmation templates · Test content</h2>
    <p>These are the exact versioned templates used by the existing mail queue. Previewing does not send an email.</p>
    {(['en','es'] as const).map(locale=>{
      const message=candidateMessage({reference:'PREVIEW-ONLY',profile:{givenName:'Test candidate',email:'candidate@example.test'},jobSnapshot:{title:'HVAC Technician'},submissionSnapshot:{localeAtSubmit:locale,title:locale==='es'?'Técnico HVAC':'HVAC Technician'}});
      return <details key={locale}><summary>{locale==='es'?'Español — Recibimos tu solicitud':'English — Application received'}</summary>
        <p><strong>Subject:</strong> <span>{message.subject}</span></p>
        <iframe title={`${locale} confirmation sample`} sandbox="" referrerPolicy="no-referrer" srcDoc={message.html} style={{width:'100%',minHeight:540,border:0}}/>
        <pre lang={locale} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{message.text}</pre>
      </details>;
    })}
  </section>;
}
