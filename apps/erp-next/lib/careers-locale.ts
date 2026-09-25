import { availableLocales } from '../../../functions/careers/editorial-contract.js';
import type { Vacancy, Question, Errors } from './careers-preview';

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
  'The selected file cannot be read.': 'No se puede leer el archivo seleccionado.',
  "What is your first name?": "¿Cuál es tu nombre?",
  "What is your last name?": "¿Cuáles son tus apellidos?",
  "What is your email address?": "¿Cuál es tu correo electrónico?",
  "What is your phone number?": "¿Cuál es tu número de teléfono?",
  "Is this number also on WhatsApp?": "¿Este número también tiene WhatsApp?",
  "What is your nationality?": "¿Cuál es tu nacionalidad?",
  "Which country are you applying from?": "¿Desde qué país estás aplicando?",
  "Do you also live in that country?": "¿También resides en ese país?",
  "Which country do you live in?": "¿En qué país resides?",
  "Which city do you live in?": "¿En qué ciudad resides?",
  "How many years of total work experience do you have?": "¿Cuántos años de experiencia laboral tienes en total?",
  "How many years of experience are relevant to this role?": "¿Cuántos años de experiencia tienes en trabajos relacionados con este puesto?",
  "Which languages do you speak?": "¿Qué idiomas hablas?",
  "When could you start?": "¿Cuándo podrías comenzar?",
  "Photo & documents": "Foto y documentos",
  "Review your application": "Revisa tu solicitud",
  "Select an answer": "Selecciona una respuesta",
  "Optional — you may continue without an answer.": "Opcional: puedes continuar sin responder.",
  "Select all that apply, then continue.": "Selecciona todas las opciones que correspondan y luego continúa.",
  "Country code": "Código de país",
  "Other code": "Otro código",
  "Other country calling code": "Otro código telefónico internacional",
  "Phone number": "Número de teléfono",
  "Nationality": "Nacionalidad",
  "Country": "País",
  "Select country": "Selecciona un país",
  "Yes": "Sí",
  "No": "No",
  "English": "Inglés",
  "Spanish": "Español",
  "Papiamento": "Papiamento",
  "Dutch": "Neerlandés",
  "Other": "Otro",
  "Immediately": "Inmediatamente",
  "Within 2 weeks": "Dentro de 2 semanas",
  "Within 1 month": "Dentro de 1 mes",
  "More than 1 month": "En más de 1 mes",
  "To be discussed": "Por acordar",
  "Curaçao / Caribbean Netherlands": "Curazao / Caribe Neerlandés",
  "US / Canada / Caribbean": "EE. UU. / Canadá / Caribe",
  "Netherlands": "Países Bajos",
  "Peru": "Perú",
  "Mexico": "México",
  "Spain": "España",
  "United Kingdom": "Reino Unido",
  "Germany": "Alemania",
  "Brazil": "Brasil",
  "Panama": "Panamá",
  "Philippines": "Filipinas",
  "Back to review": "Volver a la revisión",
  "Back to documents": "Volver a los documentos",
  "Back to previous question": "Volver a la pregunta anterior",
  "Back to position details": "Volver al puesto",
  "Application form": "Formulario de solicitud",
  "Application details": "Datos de la solicitud",
  "APPLYING FOR": "SOLICITUD PARA",
  "FINAL REVIEW": "REVISIÓN FINAL",
  "PHOTO & DOCUMENTS": "FOTO Y DOCUMENTOS",
  "QUESTION {position} OF {total} · {stagePosition} OF {stageTotal} IN THIS SECTION": "PREGUNTA {position} DE {total} · {stagePosition} DE {stageTotal} EN ESTA SECCIÓN",
  "Review your original answers. Edit any question before you send.": "Revisa tus respuestas originales. Puedes editar cualquier respuesta antes de enviar.",
  "This application has been received.": "Esta solicitud ya fue recibida.",
  "This preview application is already completed.": "Esta solicitud de prueba ya está completada.",
  "Your details remain available for review. Back and Forward will not create another application.": "Tus datos siguen disponibles para revisión. Atrás y Adelante no crearán otra solicitud.",
  "Upload documents": "Adjunta tus documentos",
  "{ready} / 2 ready": "{ready} / 2 listos",
  "Profile photo": "Foto de perfil",
  "A recent photo of you. No professional photo needed.": "Una foto reciente tuya. No necesita ser profesional.",
  "Photo selected": "Foto seleccionada",
  "Your selected profile photo": "Tu foto de perfil seleccionada",
  "Your profile photo": "Tu foto de perfil",
  "Replace photo": "Reemplazar foto",
  "Select photo": "Elegir foto",
  "Select profile photo": "Elegir foto de perfil",
  "Take a photo": "Tomar una foto",
  "Take profile photo": "Tomar foto de perfil",
  "Remove photo": "Eliminar foto",
  "Preparing photo…": "Preparando foto…",
  "Photo selected for review": "Foto seleccionada para revisión",
  "JPG, PNG or WebP · Up to 10 MB": "JPG, PNG o WebP · Hasta 10 MB",
  "Photo formats & privacy": "Formatos de foto y privacidad",
  "HEIC is supported only when this browser can open it. Otherwise select JPG/PNG or use the camera.": "HEIC solo es compatible cuando este navegador puede abrirlo. De lo contrario, elige JPG/PNG o usa la cámara.",
  "Your photo will be processed and stored privately when you submit. It is not used for automated scoring.": "Tu foto se procesará y guardará de forma privada cuando envíes la solicitud. No se utiliza para evaluaciones automáticas.",
  "The photo stays in this preview tab, is not uploaded, and is not used for automated scoring.": "La foto permanece en esta pestaña de prueba, no se sube al servidor ni se utiliza para evaluaciones automáticas.",
  "CV / Resume": "CV / Hoja de vida",
  "PDF or DOCX · Up to 10 MB": "PDF o DOCX · Hasta 10 MB",
  "Replace CV": "Reemplazar CV",
  "Select CV": "Elegir CV",
  "I do not have a CV": "No tengo CV",
  "Certificates & courses": "Certificados y cursos",
  "Optional · Studies, specializations or other documents": "Opcional · Estudios, especializaciones u otros documentos",
  "Choose files": "Elegir archivos",
  "Choose supporting files": "Elegir archivos adicionales",
  "Take photo": "Tomar foto",
  "Photograph a document": "Fotografiar un documento",
  "PDF, JPG, PNG or WebP · Up to 5 files, 10 MB each": "PDF, JPG, PNG o WebP · Hasta 5 archivos de 10 MB cada uno",
  "Selected files will be uploaded and security-checked when you submit.": "Los archivos seleccionados se subirán y se comprobará su seguridad cuando envíes la solicitud.",
  "Preview: selected files stay in this tab. Nothing is uploaded or scanned.": "Vista previa: los archivos seleccionados permanecen en esta pestaña. No se suben ni se analizan.",
  "Contact details": "Datos de contacto",
  "Documents": "Documentos",
  "Edit": "Editar",
  "Edit {label}": "Editar {label}",
  "Recent profile photo selected": "Foto de perfil reciente seleccionada",
  "CV optional for this role": "CV opcional para este puesto",
  "Recruitment privacy notice": "Aviso de privacidad de reclutamiento",
  "How this preview uses your information": "Cómo usa tus datos esta vista previa",
  "This is a design preview, not a live recruitment service. Details, photos and files remain in memory in this browser tab. They are not sent to DEMAC, a database or an email provider. Refreshing or closing this page clears the session. Use fictional details and test files. Production privacy and retention settings still require approval.": "Esta es una vista previa de diseño, no un servicio de reclutamiento activo. Los datos, fotos y archivos permanecen en la memoria de esta pestaña. No se envían a DEMAC, a una base de datos ni a un proveedor de correo. Al actualizar o cerrar esta página se borra la sesión. Utiliza datos ficticios y archivos de prueba. La política de privacidad y conservación para producción aún requiere aprobación.",
  "I have read the recruitment privacy notice.": "He leído el aviso de privacidad de reclutamiento.",
  "I have read the preview privacy information.": "He leído la información de privacidad de esta vista previa.",
  "Keep my profile for future openings (optional).": "Conservar mi perfil para futuras vacantes (opcional).",
  "Keep my profile for future openings (optional; simulated in preview).": "Conservar mi perfil para futuras vacantes (opcional; simulado en esta vista previa).",
  "Submitting…": "Enviando…",
  "Submit application": "Enviar solicitud",
  "Submit preview application": "Enviar solicitud de prueba",
  "Return to review": "Volver a la revisión",
  "Continue": "Continuar",
  "Your answers and selected files stay in this tab while you apply. Reloading or closing it clears this draft.": "Tus respuestas y archivos seleccionados permanecen en esta pestaña mientras aplicas. Si la recargas o cierras, se borra este borrador.",
  "Not provided": "Sin respuesta",
  "Selected for review": "Seleccionado para revisión",
  "Remove {name}": "Eliminar {name}",
  "Application progress": "Progreso de la solicitud",
  "Your details": "Tus datos",
  "Documents & review": "Documentos y revisión",
  "Step {step}: {label}": "Paso {step}: {label}",
  ", completed": ", completado",
  "This role’s questions are available in English. Your answers will not be translated.": "Las preguntas de este puesto están disponibles en inglés. Tus respuestas no se traducirán.",
  "The privacy notice is shown in its configured original language; a reviewed Spanish version is still pending.": "El aviso de privacidad se muestra en su versión original configurada; su versión española revisada aún está pendiente.",
  "Enter your first name.": "Escribe tu nombre.",
  "Enter your last name.": "Escribe tus apellidos.",
  "Enter your current city.": "Escribe tu ciudad actual.",
  "Enter a valid email address.": "Escribe un correo electrónico válido.",
  "Enter a country calling code, such as +297.": "Escribe un código telefónico internacional, por ejemplo +297.",
  "Check the number and country code.": "Revisa el número y el código de país.",
  "Select Yes or No.": "Selecciona Sí o No.",
  "Select a country from the list.": "Selecciona un país de la lista.",
  "This question type is unavailable. Contact recruitment.": "Este tipo de pregunta no está disponible. Contacta al equipo de reclutamiento.",
  "Choose valid options from the list.": "Elige opciones válidas de la lista.",
  "Enter a valid answer within the allowed length.": "Escribe una respuesta válida dentro del límite de longitud.",
  "Choose one of the available options.": "Elige una de las opciones disponibles.",
  "Enter a number of zero or more.": "Escribe un número igual o mayor que cero.",
  "Enter a valid calendar date.": "Escribe una fecha válida.",
  "Enter a valid http or https web address.": "Escribe una dirección web válida que comience por http o https.",
  "Enter years of experience from 0 to 70.": "Escribe los años de experiencia, entre 0 y 70.",
  "Relevant experience cannot exceed your total experience.": "La experiencia relacionada no puede superar tu experiencia total.",
  "Select at least one language without duplicates.": "Selecciona al menos un idioma, sin duplicados.",
  "Select when you could start.": "Selecciona cuándo podrías comenzar.",
  "Check the role answers.": "Revisa las respuestas del puesto.",
  "Add a recent photo for your profile.": "Añade una foto reciente para tu perfil.",
  "Select your CV to continue.": "Selecciona tu CV para continuar.",
  "Select a CV or choose “I do not have a CV”.": "Selecciona un CV o marca «No tengo CV».",
  "Read the preview privacy information and acknowledge it.": "Lee y acepta la información de privacidad de esta vista previa.",
  "Read the recruitment privacy notice and acknowledge it.": "Lee y acepta el aviso de privacidad de reclutamiento.",
  "The combined files must be smaller than 30 MB.": "El tamaño total de los archivos debe ser menor de 30 MB.",
  "Select up to five supporting documents.": "Selecciona un máximo de cinco documentos adicionales.",
  "This file is empty. Please choose another file.": "Este archivo está vacío. Elige otro archivo.",
  "Choose a file smaller than 10 MB.": "Elige un archivo de menos de 10 MB.",
  "Use PDF or DOCX.": "Usa PDF o DOCX.",
  "Use JPG, PNG, WebP or a supported HEIC image.": "Usa JPG, PNG, WebP o una imagen HEIC compatible.",
  "Use PDF, JPG, PNG or WebP.": "Usa PDF, JPG, PNG o WebP.",
  "The photo took too long to open. Try a smaller JPG or PNG. Your answers are still here.": "La foto tardó demasiado en abrirse. Prueba con un JPG o PNG más pequeño. Tus respuestas se conservan.",
  "This browser could not open that photo. Choose JPG or PNG, or take a new photo. Your answers are still here.": "Este navegador no pudo abrir esa foto. Elige JPG o PNG, o toma otra foto. Tus respuestas se conservan.",
  "Choose a photo with no more than 32 megapixels.": "Elige una foto de hasta 32 megapíxeles.",
  "Photo preview is unavailable. Try another browser without closing this form.": "La vista previa de la foto no está disponible. Puedes probar otro navegador sin cerrar este formulario.",
  "Unable to prepare this photo.": "No se pudo preparar esta foto.",
  "Unable to open this photo.": "No se pudo abrir esta foto.",
  "Unable to submit. Please retry.": "No se pudo enviar. Reinténtalo.",
  "Application completed": "Solicitud de prueba completada",
  "Application received": "¡Solicitud recibida!",
  "Thank you for applying to join the DEMAC team.": "Gracias por postularte para formar parte del equipo DEMAC.",
  "You completed the preview application for": "Completaste la solicitud de prueba para",
  "We have received your application for": "Hemos recibido tu solicitud para",
  "Reference number": "Número de referencia",
  "Your email": "Tu correo electrónico",
  "Preview only. No email has been sent and no live application has been saved.": "Solo vista previa. No se ha enviado ningún correo ni se ha guardado una candidatura real.",
  "Selection process · Live applications": "Proceso de selección · Solicitudes reales",
  "What happens next?": "¿Qué sucede después?",
  "Our team reviews your application.": "Nuestro equipo revisa tu solicitud.",
  "We contact qualified candidates.": "Contactamos a los candidatos que cumplen con el perfil.",
  "If selected, we invite you to the next stage.": "Si eres seleccionado, te invitamos a la siguiente etapa.",
  "Explore positions": "Explorar vacantes",
  "Test information only. Refreshing or closing the tab clears this session.": "Solo información de prueba. Al actualizar o cerrar la pestaña se borra esta sesión.",
  "Your application is saved. Submission does not confirm email delivery.": "Tu solicitud está guardada. El envío de la solicitud no confirma la entrega del correo.",
  "Preparing application…": "Preparando solicitud…",
  "Saving application…": "Guardando solicitud…",
  "Processing document {current} / {total}…": "Procesando documento {current} / {total}…",
  "Reload the current vacancy information before applying.": "Actualiza la información del puesto antes de aplicar.",
  "Careers is temporarily unavailable.": "El servicio de Empleos no está disponible temporalmente.",
  "This position is no longer accepting applications. Your local answers have not been sent or deleted.": "Este puesto ya no acepta solicitudes. Tus respuestas locales no se han enviado ni eliminado.",
  "The position or privacy notice changed. Your contact details and selected documents are preserved. Review the current questions and consent before submitting.": "El puesto o el aviso de privacidad cambió. Tus datos de contacto y documentos seleccionados se conservan. Revisa las preguntas y el consentimiento actuales antes de enviar.",
  "This position or its privacy notice was updated. Review the latest version without losing your contact details or selected files.": "Este puesto o su aviso de privacidad se actualizó. Revisa la versión más reciente sin perder tus datos de contacto ni archivos seleccionados.",
  "Review updated position": "Revisar puesto actualizado",
  "Unable to refresh the position. Your answers are still here.": "No se pudo actualizar el puesto. Tus respuestas se conservan.",
  "Select a role before applying.": "Selecciona un puesto antes de aplicar.",
  "This preview vacancy is no longer open. Your answers are still available in this session.": "Esta vacante de prueba ya no está abierta. Tus respuestas se conservan en esta sesión.",
  "Please review all required answers and file limits before submitting.": "Revisa todas las respuestas obligatorias y los límites de archivo antes de enviar.",
  "Leave this preview? The application details in this session will be cleared.": "¿Salir de esta vista previa? Se borrarán los datos de la solicitud de esta sesión.",
  "Preview V4 · Test data only": "Vista previa V4 · Solo datos de prueba",
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

/** Interpolate only after selecting fixed copy; values are never translation keys. */
export function careersTemplate(locale: CareersLocale, key: string, values: Record<string, string | number>): string {
  return careersText(locale, key).replace(/\{([A-Za-z]+)\}/g, (match, name: string) => Object.hasOwn(values, name) ? String(values[name]) : match);
}
export function questionPresentation(job: Vacancy, question: Question, locale: CareersLocale) {
  const contentLocale = vacancyPresentation(job, locale).contentLocale;
  const translated = contentLocale === 'es' ? job.translations?.es?.questions.find(item => item.id === question.id) : undefined;
  const values = question.kind === 'yesno' ? ['Yes', 'No'] : question.options || [];
  return { contentLocale, label: translated?.label || question.label, help: translated?.help || question.help || '',
    options: values.map(value => ({ value, label: translated?.optionLabels[value] || value })) };
}
/** Display errors without changing the shared validator, field keys or canonical options. */
export function careersFormErrors(locale: CareersLocale, errors: Errors, vacancy: Vacancy, live = false): Errors {
  return Object.fromEntries(Object.entries(errors).map(([key, original]) => {
    if (key === 'privacy' && live) return [key, careersText(locale, 'Read the recruitment privacy notice and acknowledge it.')];
    const question = key.startsWith('q-') ? vacancy.questions.find(q => `q-${q.id}` === key) : undefined;
    if (question && original === `Answer: ${question.label}`) return [key, `${locale === 'es' ? 'Responde' : 'Answer'}: ${questionPresentation(vacancy, question, locale).label}`];
    return [key, careersText(locale, original)];
  }));
}
export type CareersIssue = { message: string; code?: string; fileName?: string };
export function careersIssue(error: unknown, fallback = 'Unable to submit. Please retry.'): CareersIssue {
  if (typeof error === 'string') return { message: error };
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return { message: error.message, ...('code' in error && typeof error.code === 'string' ? { code: error.code } : {}) };
  }
  return { message: fallback };
}
const publicErrorMessages: Record<string, string> = {
  'connection-error': 'La conexión se interrumpió. Reinténtalo; una solicitud ya recibida no se duplicará.',
  'version-conflict': 'El puesto cambió. Revisa la versión actualizada antes de enviar; tus datos y archivos se conservan.',
  'privacy-version': 'El aviso de privacidad cambió. Revisa la versión actualizada antes de enviar.',
  'vacancy-closed': 'Este puesto ya no acepta solicitudes. Tus respuestas permanecen en esta pestaña.',
  'setup-required': 'Las solicitudes no están disponibles temporalmente. Tus respuestas se conservan en esta pestaña.',
  'not-configured': 'El servicio de Empleos no está disponible temporalmente.',
  'rate-limited': 'Se han realizado demasiados intentos. Espera un momento antes de reintentar.',
  'invalid-session': 'No se pudo verificar la sesión. Reintenta el envío sin cerrar esta pestaña.',
  'file-limit': 'Se superó un límite de archivos. Revisa la cantidad y el tamaño antes de reintentar.',
  'too-large': 'El archivo o la solicitud supera el tamaño permitido.',
  'invalid-image': 'No se pudo leer esta imagen. Selecciona una foto válida en un formato permitido.',
  'unsafe-file': 'El archivo no superó la revisión de seguridad. Selecciona otro archivo.',
  'scanner-unavailable': 'No se pudo completar la revisión de seguridad del archivo. Inténtalo de nuevo más tarde.',
  'service-unavailable': 'El servicio no está disponible temporalmente. Reintenta sin cerrar esta pestaña.',
  'intake-paused': 'La recepción de solicitudes está pausada. Tus datos se conservan en esta pestaña.',
  'upload-busy': 'El archivo sigue procesándose. Espera un momento antes de reintentar.',
  'upload-conflict': 'No se pudo confirmar el estado del archivo. Reintenta sin cerrar esta pestaña.',
  'permission-denied': 'No tienes permiso para realizar esta operación.',
  'origin-denied': 'Esta página no está autorizada para realizar la operación.',
  'not-found': 'El recurso solicitado ya no está disponible.',
  'invalid-input': 'Revisa los datos y archivos de la solicitud antes de reintentar.',
};
export function careersIssueText(locale: CareersLocale, issue: CareersIssue): string {
  const fixed = careersText(locale, issue.message);
  const message = locale === 'en' || fixed !== issue.message ? fixed : issue.code
    ? publicErrorMessages[issue.code] || 'No se pudo completar esta operación. Revisa tus respuestas y archivos e inténtalo de nuevo. Tus datos permanecen en esta pestaña.'
    : 'No se pudo completar esta operación. Inténtalo de nuevo sin cerrar esta pestaña.';
  return issue.fileName ? `${issue.fileName}: ${message}` : message;
}
