import type { FormQuestion } from './form-contract';
import type { EditorialVacancy } from './editorial-contract';
export const PRESENTATION_VERSION: string;
export const PROFILE_PROMPTS: Readonly<Record<string, string>>;
export const PROFILE_CHOICES: Readonly<{ yesno: string[]; languages: string[]; availability: string[] }>;
export const PROFILE_SPANISH: Readonly<Record<string, string>>;
export type SubmittedValue = string | number | boolean | null | (string | number)[];
export interface SubmittedRow {
  id: string; questionId?: string; label: string; help?: string; kind: string; required?: boolean;
  contentLocale: 'en' | 'es'; options: { value: string | boolean; label: string }[]; value: SubmittedValue;
}
export interface SubmissionSnapshot {
  schemaVersion: 1; presentationVersion: string; localeAtSubmit: 'en' | 'es'; contentLocale: 'en' | 'es';
  vacancyVersion: number; editorialVersion: number; title: string; fields: SubmittedRow[]; questions: SubmittedRow[];
  privacy: { version: string; text: string; contentLocale: 'en' | 'es' | null; acknowledged: boolean; futureTalent: boolean };
}
export function profileCopy(locale: 'en' | 'es', text: string): string;
export function presentedQuestion(job: EditorialVacancy, question: FormQuestion, locale: 'en' | 'es'): {
  contentLocale: 'en' | 'es'; label: string; help: string; options: { value: string; label: string }[];
};
export function createSubmissionSnapshot(job: EditorialVacancy & { version: number }, raw: object, canonical: object, locale: 'en' | 'es', version: string, privacy: { text: string; version: string; contentLocale?: 'en' | 'es' | null }): SubmissionSnapshot;
export function submittedAnswerText(row: SubmittedRow): string;
