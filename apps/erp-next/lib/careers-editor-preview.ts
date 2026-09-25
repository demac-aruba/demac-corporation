import { translationIssues } from '../../../functions/careers/editorial-contract.js';
import type { Vacancy } from './careers-preview';

/** Local editorial simulation only. Never return this copy to an administrative save. */
export function editorPreviewState(vacancy: Vacancy, editorialVersion: number) {
  const copy = structuredClone(vacancy);
  copy.editorialVersion = editorialVersion;
  const spanish = copy.translations?.es;
  const originalSpanishStatus = spanish?.status || null;
  // A complete draft can be inspected before review. This applies only to this
  // detached rendering copy; it cannot approve or publish the source vacancy.
  const translated = spanish ? { ...spanish, status: 'Approved' as const, sourceVersion: editorialVersion } : undefined;
  const spanishIssues = translated ? translationIssues(copy, translated) : ['Add the Spanish translation.'];
  if (translated && !spanishIssues.length) copy.translations = { es: translated };
  return { vacancy: copy, spanishIssues, originalSpanishStatus };
}
