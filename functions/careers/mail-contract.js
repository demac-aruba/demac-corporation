'use strict';
/** Immutable message content, shared with the isolated review UI. No provider, I/O or AI.
 * The sender is resolved only from verified server settings by infrastructure.js.
 * Never alter an existing version: introduce a new version for future submissions.
 */
const CANDIDATE_TEMPLATE_VERSION = 'careers-candidate-v1';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const line = value => String(value ?? '').replace(/[\r\n]+/g, ' ');
function candidateMessage(application) {
  const snapshot = application.submissionSnapshot;
  const locale = snapshot?.localeAtSubmit === 'es' ? 'es' : 'en';
  const es = locale === 'es';
  const title = snapshot?.title || application.jobSnapshot.title;
  const name = application.profile.givenName;
  const reference = application.reference;
  const heading = es ? 'Recibimos tu solicitud' : 'Application received';
  const greeting = es ? `Hola ${name},` : `Hello ${name},`;
  const thanks = es
    ? `Gracias por tu interés en DEMAC Professional Cooling Solutions. Recibimos tu solicitud para ${title}.`
    : `Thank you for your interest in DEMAC Professional Cooling Solutions. We received your application for ${title}.`;
  const next = es
    ? 'Nuestro equipo de reclutamiento revisará tu información y te contactará si tu solicitud avanza a la siguiente etapa.'
    : 'Our recruitment team will review your information and contact you if your application advances to the next stage.';
  const sign = es ? 'Equipo de Reclutamiento DEMAC' : 'DEMAC Recruitment Team';
  const refLabel = es ? 'Referencia' : 'Reference';
  const text = `${greeting}\n\n${thanks}\n\n${refLabel}: ${reference}\n\n${next}\n\n${sign}`;
  // Table-based email layout; all declared content is escaped, no remote assets or tracking.
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(heading)}</title></head><body style="margin:0;background:#f4f7fb;color:#082b54;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border:1px solid #dce5ef;border-radius:12px;overflow:hidden"><tr><td style="padding:24px;background:#062a53;color:#fff"><strong style="font-size:28px">DEMAC</strong><br><span style="font-size:12px;letter-spacing:1px">PROFESSIONAL COOLING SOLUTIONS</span></td></tr><tr><td style="padding:28px 24px"><h1 style="font-size:26px;line-height:1.25;margin:0 0 24px">${escape(heading)}</h1><p>${escape(greeting)}</p><p style="line-height:1.6">${escape(thanks)}</p><p style="padding:18px;background:#eef5fc;border-radius:8px;overflow-wrap:anywhere">${escape(refLabel)}: <strong>${escape(reference)}</strong></p><p style="line-height:1.6">${escape(next)}</p><p style="margin-top:28px">${escape(sign)}</p></td></tr></table></td></tr></table></body></html>`;
  return { schemaVersion: 1, kind: 'candidate-confirmation', templateVersion: CANDIDATE_TEMPLATE_VERSION,
    locale, to: application.profile.email, subject: `${heading} — ${line(title)}`, text, html };
}
function mailSummary(job) {
  return { kind: 'candidate-confirmation', status: job?.status || 'unavailable',
    locale: job?.message?.locale || null, templateVersion: job?.message?.templateVersion || null,
    attempts: job?.attempts || 0 };
}
module.exports = { CANDIDATE_TEMPLATE_VERSION, candidateMessage, mailSummary };
