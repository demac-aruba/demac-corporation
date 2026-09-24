import { availableLocales } from '../../../functions/careers/editorial-contract.js';
import type { Vacancy } from './careers-preview';

export type CareersLocale = 'en' | 'es';
export const CAREERS_LOCALE_KEY = 'demac-careers-language';
export function isCareersLocale(value: unknown): value is CareersLocale { return value === 'en' || value === 'es'; }
/** Query values are exact. Only browser BCP-47 preferences accept regional suffixes. */
export function resolveCareersLocale(query: unknown, saved: unknown, languages: readonly string[] = []): CareersLocale {
  if (isCareersLocale(query)) return query;
  if (isCareersLocale(saved)) return saved;
  for (const language of languages) {
    const base = typeof language === 'string' ? language.toLowerCase().split('-')[0] : '';
    if (isCareersLocale(base)) return base;
  }
  return 'en';
}
export function localeUrl(href: string, locale: CareersLocale): string {
  const url = new URL(href);
  url.searchParams.set('lang', locale);
  return `${url.pathname}${url.search}${url.hash}`;
}
export function vacancyPresentation<T extends Vacancy>(job: T, locale: CareersLocale): { job: T; contentLocale: CareersLocale } {
  // Always derive availability from the approved source revision; never trust a cached flag.
  if (locale !== 'es' || !availableLocales(job).includes('es') || !job.translations?.es) return { job, contentLocale: 'en' };
  const es = job.translations.es;
  // Presentation only. Keep the canonical job, question IDs, option values, status and counts untouched.
  return { contentLocale: 'es', job: { ...job, title: es.title, department: es.department, location: es.location, contract: es.contract,
    summary: es.summary, responsibilities: es.responsibilities, requirements: es.requirements, desired: es.desired } };
}
const spanish: Record<string, string> = {
  'Careers': 'Empleos', 'Contact': 'Contacto', 'Open positions': 'Vacantes disponibles',
  'Search positions': 'Buscar puestos', 'Search jobs, keywords…': 'Buscar puestos, palabras clave…',
  'Department': 'Departamento', 'All departments': 'Todos los departamentos', 'Clear filters': 'Limpiar filtros',
  'open position': 'vacante disponible', 'open positions': 'vacantes disponibles', 'Explore opportunities': 'Explora oportunidades',
  'View position': 'Ver puesto', 'View': 'Ver', 'Preview': 'Vista previa', 'Apply now': 'Aplicar ahora',
  'Applications are temporarily unavailable': 'Las solicitudes no están disponibles temporalmente',
  'No matching positions': 'No hay puestos que coincidan', 'No openings at the moment': 'No hay vacantes en este momento',
  'Try another keyword or department.': 'Prueba otra palabra clave o departamento.',
  'Please check back for future opportunities.': 'Vuelve más adelante para consultar nuevas oportunidades.',
  'Reset search': 'Restablecer búsqueda', 'Layout preview · These sample roles are not live job advertisements.': 'Vista previa de diseño · Estos puestos de muestra no son ofertas de empleo reales.',
  'Back to open positions': 'Volver a las vacantes', 'Back': 'Atrás', 'Location': 'Ubicación', 'Type': 'Tipo', 'Experience': 'Experiencia',
  'About the role': 'Acerca del puesto', 'What you’ll do': 'Tus responsabilidades', 'What we’re looking for': 'Lo que buscamos',
  'Preferred qualifications': 'Cualificaciones deseables', 'Documents to prepare': 'Documentos que debes preparar',
  'Please prepare the following for your application:': 'Prepara lo siguiente para tu solicitud:',
  'A recent profile photo. No professional photo needed.': 'Una foto reciente para tu perfil. No necesita ser profesional.',
  'Updated CV / Resume': 'CV / Hoja de vida actualizada', ' (optional)': ' (opcional)',
  'Relevant certificates or courses, when available (optional).': 'Certificados o cursos relacionados, cuando estén disponibles (opcional).',
  'No account or password needed': 'No necesitas cuenta ni contraseña', 'View confirmation': 'Ver confirmación',
  'Continue application': 'Continuar solicitud', 'Review application': 'Revisar solicitud',
  'Position information is available in English.': 'La información de este puesto está disponible en inglés.',
  'Application form currently available in English. Language selection will not clear your answers or files.': 'El formulario está disponible por ahora en inglés. Cambiar el idioma no borra tus respuestas ni archivos.',
  'Opening Careers…': 'Abriendo Empleos…', 'Loading opportunities…': 'Cargando oportunidades…',
  'Try again': 'Reintentar', 'Careers footer': 'Pie de página de Empleos', 'All rights reserved.': 'Todos los derechos reservados.',
};
/** Only for fixed UI copy. Never pass candidate answers or editorial content here. */
export function careersText(locale: CareersLocale, key: string): string { return locale === 'es' && Object.hasOwn(spanish, key) ? spanish[key] : key; }
