import type { ApplicationDraft, Vacancy } from './careers-preview';

/** Only unchanged question definitions may keep answers after a form revision.
 * Contact details and locally selected files are retained; consent is revisited.
 */
export function recoverRevisedDraft(previous: Vacancy, next: Vacancy, draft: ApplicationDraft): ApplicationDraft {
  const definitions = new Map(previous.questions.map(question => [question.id, JSON.stringify(question)]));
  const unchanged = new Set(next.questions.filter(question => definitions.get(question.id) === JSON.stringify(question)).map(question => question.id));
  return {
    ...draft,
    answers: Object.fromEntries(Object.entries(draft.answers).filter(([key]) => unchanged.has(key))),
    privacy: false,
    futureTalent: false,
  };
}
