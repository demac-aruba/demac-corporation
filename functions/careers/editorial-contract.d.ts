import type { FormQuestion } from './form-contract';
export interface EditorialTranslation {
  status: 'Draft' | 'Approved'; sourceVersion: number;
  title: string; department: string; location: string; contract: string; summary: string;
  responsibilities: string[]; requirements: string[]; desired: string[];
  questions: { id: string; label: string; help?: string; optionLabels: Record<string, string> }[];
}
export interface EditorialVacancy {
  title: string; department: string; location: string; contract: string; summary: string;
  responsibilities: string[]; requirements: string[]; desired?: string[];
  questions: FormQuestion[]; cvRequired: boolean; photoRequired?: boolean;
  editorialVersion?: number; translations?: { es?: EditorialTranslation };
}
export const TEXT_FIELDS: Readonly<Record<'title' | 'department' | 'location' | 'contract' | 'summary', number>>;
export const LIST_FIELDS: readonly ['responsibilities', 'requirements', 'desired'];
export function nextEditorialVersion(job: EditorialVacancy, previous?: EditorialVacancy | null): number;
export function parseTranslations(value: unknown): { es?: EditorialTranslation };
export function translationIssues(job: EditorialVacancy, translation?: EditorialTranslation): string[];
export function reconcileEditorial<T extends EditorialVacancy>(job: T, previous?: EditorialVacancy | null): T & { editorialVersion: number; translations: { es?: EditorialTranslation } };
export function availableLocales(job: EditorialVacancy): ('en' | 'es')[];
export function publicTranslations(job: EditorialVacancy): { es?: EditorialTranslation };
export function emptyTranslation(job: EditorialVacancy, version?: number): EditorialTranslation;
export function alignTranslation(job: EditorialVacancy, translation: EditorialTranslation): EditorialTranslation;
