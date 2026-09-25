export interface CandidateMessage {
  schemaVersion: 1; kind: 'candidate-confirmation'; templateVersion: string;
  locale: 'en' | 'es'; to: string; subject: string; text: string; html: string;
}
export interface CandidateMailSummary {
  kind: 'candidate-confirmation'; status: string; locale: 'en' | 'es' | null;
  templateVersion: string | null; attempts: number;
}
export const CANDIDATE_TEMPLATE_VERSION: string;
export function candidateMessage(application: {
  reference: string; profile: { givenName: string; email: string };
  jobSnapshot: { title: string }; submissionSnapshot?: { localeAtSubmit: string; title: string };
}): CandidateMessage;
export function mailSummary(job: { status?: string; attempts?: number; message?: CandidateMessage } | undefined): CandidateMailSummary;
