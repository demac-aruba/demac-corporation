export const QUESTION_KINDS: readonly ['select', 'multiselect', 'yesno', 'text', 'textarea', 'number', 'date', 'url'];
export type QuestionKind = typeof QUESTION_KINDS[number];
export interface FormQuestion {
  id: string; label: string; kind: QuestionKind; required: boolean;
  options?: string[]; when?: { questionId: string; value: string };
}
export const COUNTRY_CODES: readonly string[];
export const LIMITS: Readonly<{ givenName: number; familyName: number; email: number; city: number; text: number; textarea: number; years: number }>;
export type Validation<T = Record<string, unknown>> = { value: T; errors: Record<string, string> };
export function isDate(value: unknown): boolean;
export function isWebUrl(value: string): boolean;
export function visibleQuestions<T extends FormQuestion>(questions: T[], answers: unknown): T[];
export function validateDetails(input: unknown): Validation;
export function validateExperience(input: unknown, questions: FormQuestion[]): Validation;
export function validateAnswers(questions: FormQuestion[], answers: unknown): Validation<Record<string, string | string[]>>;
