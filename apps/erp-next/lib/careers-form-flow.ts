import { visibleQuestions } from '../../../functions/careers/form-contract.js';
import type { ApplicationDraft, Errors, Question, Vacancy } from './careers-preview';

/** Presentation/navigation only. Validation still comes from the existing shared
 * form contract and the server still owns submission. IDs never contain answers. */
export type ProfileField = 'givenName' | 'familyName' | 'email' | 'phone' | 'whatsapp'
  | 'nationality' | 'applyingFrom' | 'sameResidence' | 'residence' | 'city'
  | 'totalExperience' | 'relevantExperience' | 'languages' | 'availability';
export interface FormScreen {
  id: string;
  stage: 0 | 1 | 2;
  kind: 'profile' | 'role' | 'documents' | 'review';
  label: string;
  errorKeys: readonly string[];
  field?: ProfileField;
  question?: Question;
}
export interface FormTarget {
  step: number;
  question: string;
  reviewing: boolean;
  returnToReview?: boolean;
}
export type RequestedFormTarget = Partial<FormTarget>;

function profile(field: ProfileField, label: string, stage: 0 | 1, errorKeys: string[] = [field]): FormScreen {
  return { id: `profile:${field}`, stage, kind: 'profile', field, label, errorKeys };
}
export function formScreens(vacancy: Vacancy, draft: ApplicationDraft): FormScreen[] {
  const details = [
    profile('givenName', 'What is your first name?', 0),
    profile('familyName', 'What is your last name?', 0),
    profile('email', 'What is your email address?', 0),
    profile('phone', 'What is your phone number?', 0, ['dialCode', 'phone']),
    profile('whatsapp', 'Is this number also on WhatsApp?', 0),
    profile('nationality', 'What is your nationality?', 0),
    profile('applyingFrom', 'Which country are you applying from?', 0,
      draft.sameResidence ? ['applyingFrom', 'residence'] : ['applyingFrom']),
    profile('sameResidence', 'Do you also live in that country?', 0),
    ...(!draft.sameResidence ? [profile('residence', 'Which country do you live in?', 0)] : []),
    profile('city', 'Which city do you live in?', 0),
  ];
  const experience = [
    profile('totalExperience', 'How many years of total work experience do you have?', 1),
    profile('relevantExperience', 'How many years of experience are relevant to this role?', 1),
    ...visibleQuestions(vacancy.questions, draft.answers).map((question: Question): FormScreen => ({
      id: `role:${question.id}`, stage: 1, kind: 'role', label: question.label,
      question, errorKeys: [`q-${question.id}`, 'answers'],
    })),
    profile('languages', 'Which languages do you speak?', 1),
    profile('availability', 'When could you start?', 1),
  ];
  return [...details, ...experience,
    { id: 'documents', stage: 2, kind: 'documents', label: 'Photo & documents', errorKeys: ['photo', 'cv', 'documents'] },
    { id: 'review', stage: 2, kind: 'review', label: 'Review your application', errorKeys: ['privacy'] },
  ];
}
export function targetFor(screen: FormScreen, returnToReview = false): FormTarget {
  return { step: screen.stage, question: screen.id, reviewing: screen.kind === 'review',
    ...(returnToReview && screen.kind !== 'review' ? { returnToReview: true } : {}) };
}
export function screenErrors(screen: FormScreen, errors: Errors): Errors {
  return Object.fromEntries(screen.errorKeys.filter(key => Object.hasOwn(errors, key)).map(key => [key, errors[key]]));
}
export function firstPendingScreen(screens: readonly FormScreen[], errors: Errors): FormScreen | undefined {
  // Consent belongs on the review screen, not on the route leading to it.
  return screens.find(screen => screen.kind !== 'review' && Object.keys(screenErrors(screen, errors)).length > 0);
}
export function normalizeFormTarget(screens: readonly FormScreen[], requested: RequestedFormTarget, errors: Errors): FormTarget {
  if (!screens.length) throw new Error('The application has no screens.');
  let index = requested.reviewing ? screens.findIndex(screen => screen.kind === 'review')
    : requested.question ? screens.findIndex(screen => screen.id === requested.question)
    : screens.findIndex(screen => screen.stage === Math.max(0, Math.min(2, requested.step || 0)));
  if (index < 0) index = screens.indexOf(firstPendingScreen(screens, errors) || screens[screens.length - 1]);
  const earlier = firstPendingScreen(screens.slice(0, index), errors);
  return targetFor(earlier || screens[index], !!requested.returnToReview);
}
export function previousFormTarget(screens: readonly FormScreen[], current: FormScreen, editingReview = false): FormTarget | undefined {
  if (editingReview) return targetFor(screens.find(screen => screen.kind === 'review')!);
  const previous = screens[screens.findIndex(screen => screen.id === current.id) - 1];
  return previous ? targetFor(previous) : undefined;
}
export function questionProgress(screens: readonly FormScreen[], current: FormScreen) {
  const questions = screens.filter(screen => screen.kind === 'profile' || screen.kind === 'role');
  const stageQuestions = questions.filter(screen => screen.stage === current.stage);
  return { total: questions.length, position: questions.findIndex(screen => screen.id === current.id) + 1,
    stageTotal: stageQuestions.length, stagePosition: stageQuestions.findIndex(screen => screen.id === current.id) + 1 };
}
