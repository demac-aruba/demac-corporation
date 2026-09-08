/** Product-validation contracts only. No network, storage, employee or scheduling writes. */
export type QuestionKind = 'select' | 'multiselect' | 'yesno' | 'text' | 'textarea' | 'number';
export interface Question {
  id: string; label: string; kind: QuestionKind; required: boolean;
  options?: string[];
  when?: { questionId: string; value: string };
}
export interface Vacancy {
  id: string; title: string; department: string; location: string;
  contract: string; summary: string; responsibilities: string[];
  requirements: string[]; status: 'Open' | 'Draft' | 'Paused' | 'Closed';
  cvRequired: boolean; version: number; questions: Question[];
}
export interface ProfilePhoto { dataUrl: string; name: string; size: number }
export interface ApplicationDraft {
  givenName: string; familyName: string; email: string; dialCode: string; phone: string;
  whatsapp: boolean; nationality: string; applyingFrom: string; residence: string;
  sameResidence: boolean; city: string; totalExperience: string; relevantExperience: string;
  languages: string[]; availability: string; answers: Record<string, string | string[]>;
  photo: ProfilePhoto | null; cv: File | null; documents: File[];
  noCv: boolean; privacy: boolean; futureTalent: boolean;
}
export const stages = ['New', 'In review', 'Shortlisted', 'Interview', 'Technical test', 'Offer', 'Hired', 'Not selected', 'Withdrawn'] as const;
export type Stage = typeof stages[number];
export interface PreviewApplication {
  id: string; vacancy: Vacancy; draft: ApplicationDraft; stage: Stage; createdAt: string;
  notes: { text: string; at: string }[]; timeline: { text: string; at: string }[];
}
export type Errors = Record<string, string>;
export const countryCodes = 'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'.split(' ');
export const dialingCodes = [ ['+297', 'Aruba'], ['+599', 'Curaçao / Caribbean Netherlands'], ['+1', 'US / Canada / Caribbean'], ['+31', 'Netherlands'], ['+58', 'Venezuela'], ['+57', 'Colombia'], ['+503', 'El Salvador'], ['+51', 'Peru'], ['+593', 'Ecuador'], ['+52', 'Mexico'], ['+34', 'Spain'], ['+44', 'United Kingdom'], ['+49', 'Germany'], ['+55', 'Brazil'], ['+54', 'Argentina'], ['+56', 'Chile'], ['+507', 'Panama'], ['+506', 'Costa Rica'], ['+502', 'Guatemala'], ['+504', 'Honduras'], ['+505', 'Nicaragua'], ['+63', 'Philippines'] ];
export function emptyDraft(): ApplicationDraft {
  return { givenName: '', familyName: '', email: '', dialCode: '+297', phone: '', whatsapp: true,
    nationality: '', applyingFrom: '', residence: '', sameResidence: true, city: '',
    totalExperience: '', relevantExperience: '', languages: [], availability: '', answers: {},
    photo: null, cv: null, documents: [], noCv: false, privacy: false, futureTalent: false };
}
const question = (id: string, label: string, kind: QuestionKind, options?: string[], required = true): Question => ({ id, label, kind, options, required });
const technical = [question('systems', 'Which systems have you worked on?', 'multiselect', ['Split units', 'Cassette units', 'VRF / VRV', 'Ducted systems']), question('drawings', 'Can you read technical drawings?', 'yesno'), question('project', 'Tell us briefly about a relevant project.', 'textarea', undefined, false)];
export function exampleVacancies(): Vacancy[] {
  const roles: { id: string; title: string; department: string; summary: string; questions: Question[]; helper?: boolean }[] = [
    { id: 'hvac-technician', title: 'HVAC Technician', department: 'Field Operations', summary: 'Install, service and diagnose air conditioning systems across Aruba.', questions: technical },
    { id: 'technician-helper', title: 'Technician Helper', department: 'Field Operations', summary: 'Support our technicians and develop your practical skills on the job.', helper: true, questions: [question('tools', 'How familiar are you with hand tools?', 'select', ['Just starting', 'Some experience', 'Confident']), question('team', 'Have you worked as part of a field team?', 'yesno'), question('learn', 'What would you like to learn?', 'textarea', undefined, false)] },
    { id: 'dispatcher', title: 'Dispatcher / Operator', department: 'Operations', summary: 'Help customers and coordinate clear, well-organized service schedules.', questions: [question('customer-service', 'Have you worked in customer service?', 'yesno'), question('tools', 'Which tools have you used?', 'multiselect', ['CRM', 'Scheduling software', 'WhatsApp Business', 'Spreadsheets', 'None yet']), question('scenario', 'A customer needs an earlier appointment. How would you help?', 'textarea')] },
    { id: 'accountant', title: 'Accountant', department: 'Finance', summary: 'Support accurate financial records, reconciliations and reporting.', questions: [question('software', 'Which accounting tools have you used?', 'multiselect', ['QuickBooks', 'Excel', 'Other']), question('processes', 'Which processes have you managed?', 'multiselect', ['Reconciliations', 'Accounts payable', 'Accounts receivable', 'Reporting']), question('education', 'Relevant studies or professional qualifications', 'text')] },
    { id: 'marketing', title: 'Marketing Coordinator', department: 'Marketing', summary: 'Create clear content and campaigns that connect DEMAC with customers.', questions: [question('channels', 'Which channels have you worked with?', 'multiselect', ['Facebook / Instagram', 'Google Ads', 'Email', 'Organic content']), question('portfolio', 'Portfolio or work sample link (optional)', 'text', undefined, false), question('campaign', 'Describe a campaign and how you measured its results.', 'textarea')] },
    { id: 'vrf-specialist', title: 'VRF Specialist', department: 'Technical', summary: 'Bring your experience in VRF installation, commissioning and diagnostics.', questions: [question('brands', 'Which VRF brands have you worked with?', 'multiselect', ['Daikin', 'LG', 'Mitsubishi', 'Midea', 'Other']), question('commissioning', 'Have you performed VRF commissioning?', 'yesno'), { ...question('commissioning-detail', 'What commissioning work did you perform?', 'textarea'), when: { questionId: 'commissioning', value: 'Yes' } }, question('drawings', 'Can you read technical drawings?', 'yesno'), question('certification', 'Relevant certifications (optional)', 'text', undefined, false)] },
    { id: 'ductwork', title: 'Ductwork Specialist', department: 'Technical', summary: 'Fabricate, install and insulate ductwork for cooling projects.', questions: [question('materials', 'Which duct types have you worked with?', 'multiselect', ['Sheet metal', 'Flexible', 'Pre-insulated', 'Other']), question('drawings', 'Can you work from installation drawings?', 'yesno'), question('tasks', 'Briefly describe your ductwork experience.', 'textarea')] },
    { id: 'project-manager', title: 'Project Manager', department: 'Project Management', summary: 'Coordinate project scope, people, progress and client communication.', questions: [question('team-size', 'Largest team you have coordinated', 'number'), question('tools', 'Which planning tools have you used?', 'text'), question('project', 'Describe a project challenge and how you handled it.', 'textarea')] },
    { id: 'supervisor', title: 'Supervisor', department: 'Field Operations', summary: 'Guide field teams and support consistent quality and safe working practices.', questions: [question('team-size', 'Largest team you have supervised', 'number'), question('specialty', 'Your main technical specialty', 'text'), question('quality', 'How do you check the quality of completed work?', 'textarea')] },
  ];
  return roles.map(role => ({ ...role, location: 'Aruba', contract: 'Full-time', status: 'Open', cvRequired: !role.helper, version: 1,
    responsibilities: [role.summary, 'Communicate clearly and keep accurate work records.', 'Follow agreed quality, safety and team procedures.'],
    requirements: role.helper ? ['Willingness to learn and follow instructions.', 'Reliable teamwork and communication.'] : ['Relevant experience in the responsibilities of the role.', 'Clear communication and a practical, organized approach.'],
    questions: role.questions.map(q => ({ ...q, options: q.options ? [...q.options] : undefined })) }));
}
export function visibleQuestions(vacancy: Vacancy, draft: ApplicationDraft): Question[] {
  return vacancy.questions.filter(q => !q.when || draft.answers[q.when.questionId] === q.when.value);
}
export function phoneInternational(draft: Pick<ApplicationDraft, 'dialCode' | 'phone'>): string {
  return `+${draft.dialCode.replace(/\D/g, '')}${draft.phone.replace(/\D/g, '')}`;
}
export function validateStep(draft: ApplicationDraft, vacancy: Vacancy, step: number, review = false): Errors {
  const errors: Errors = {};
  if (step === 0) {
    if (!draft.givenName.trim()) errors.givenName = 'Enter your first name.';
    if (!draft.familyName.trim()) errors.familyName = 'Enter your last name.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) errors.email = 'Enter a valid email address.';
    if (!/^\+?[1-9]\d{0,3}$/.test(draft.dialCode.trim())) errors.dialCode = 'Enter a country calling code, such as +297.';
    if (!/^[\d\s().-]+$/.test(draft.phone) || !/^\+[1-9]\d{6,14}$/.test(phoneInternational(draft))) errors.phone = 'Check the number and country code.';
    if (!countryCodes.includes(draft.nationality)) errors.nationality = 'Select your nationality.';
    if (!countryCodes.includes(draft.applyingFrom)) errors.applyingFrom = 'Select the country you are applying from.';
    if (!draft.sameResidence && !countryCodes.includes(draft.residence)) errors.residence = 'Select your country of residence.';
    if (!draft.city.trim()) errors.city = 'Enter your current city.';
  }
  if (step === 1) {
    for (const key of ['totalExperience', 'relevantExperience'] as const) {
      const value = Number(draft[key]);
      if (draft[key].trim() === '' || !Number.isFinite(value) || value < 0 || value > 70) errors[key] = 'Enter years of experience from 0 to 70.';
    }
    if (!errors.totalExperience && !errors.relevantExperience && Number(draft.relevantExperience) > Number(draft.totalExperience)) errors.relevantExperience = 'Relevant experience cannot exceed your total experience.';
    if (!draft.languages.length) errors.languages = 'Select at least one language.';
    if (!draft.availability) errors.availability = 'Select when you could start.';
    for (const q of visibleQuestions(vacancy, draft)) {
      const value = draft.answers[q.id];
      const missing = value === undefined || (Array.isArray(value) ? !value.length : !value.trim());
      if (q.required && missing) errors[`q-${q.id}`] = 'Please answer this question.';
      if (!missing && q.kind === 'number' && (Array.isArray(value) || !Number.isFinite(Number(value)) || Number(value) < 0)) errors[`q-${q.id}`] = 'Enter a number of zero or more.';
      if (!missing && ['select', 'multiselect', 'yesno'].includes(q.kind)) {
        const allowed = q.kind === 'yesno' ? ['Yes', 'No'] : (q.options ?? []);
        if ((Array.isArray(value) ? value : [value]).some(v => !allowed.includes(v))) errors[`q-${q.id}`] = 'Choose one of the available options.';
      }
    }
  }
  if (step === 2) {
    if (!draft.photo) errors.photo = 'Add a recent photo for your profile.';
    if (!draft.cv && (vacancy.cvRequired || !draft.noCv)) errors.cv = vacancy.cvRequired ? 'Select your CV to continue.' : 'Select a CV or choose “I do not have a CV”.';
    if (review && !draft.privacy) errors.privacy = 'Read the preview privacy information and acknowledge it.';
  }
  return errors;
}
export function fileError(file: Pick<File, 'name' | 'size'>, kind: 'cv' | 'document' | 'photo'): string | null {
  if (!file.size) return 'This file is empty. Please choose another file.';
  if (file.size > 10 * 1024 * 1024) return 'Choose a file smaller than 10 MB.';
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const allowed = kind === 'cv' ? ['pdf', 'docx'] : kind === 'photo' ? ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'] : ['pdf', 'jpg', 'jpeg', 'png', 'webp'];
  return allowed.includes(extension) ? null : `Use ${kind === 'cv' ? 'PDF or DOCX' : kind === 'photo' ? 'JPG, PNG, WebP or a supported HEIC image' : 'PDF, JPG, PNG or WebP'}.`;
}
export function totalFileBytes(draft: ApplicationDraft): number {
  return (draft.photo?.size ?? 0) + (draft.cv?.size ?? 0) + draft.documents.reduce((sum, file) => sum + file.size, 0);
}
export function copyForSubmission(draft: ApplicationDraft, vacancy?: Vacancy): ApplicationDraft {
  const visible = vacancy ? new Set(visibleQuestions(vacancy, draft).map(q => q.id)) : null;
  return { ...draft, email: draft.email.trim(), givenName: draft.givenName.trim(), familyName: draft.familyName.trim(), residence: draft.sameResidence ? draft.applyingFrom : draft.residence,
    answers: Object.fromEntries(Object.entries(draft.answers).filter(([id]) => !visible || visible.has(id)).map(([id, value]) => [id, Array.isArray(value) ? [...value] : value])), languages: [...draft.languages], documents: [...draft.documents] };
}
export function validateVacancy(vacancy: Vacancy): string | null {
  if (!vacancy.title.trim() || !vacancy.department.trim() || !vacancy.summary.trim()) return 'Enter the title, department and summary.';
  if (!vacancy.questions.length) return 'Add at least one role question.';
  const ids = new Set<string>();
  for (const q of vacancy.questions) {
    if (!q.id || ids.has(q.id) || !q.label.trim()) return 'Questions need unique identifiers and a label.';
    if (q.when && (!ids.has(q.when.questionId) || vacancy.questions.find(item => item.id === q.when?.questionId)?.kind !== 'yesno')) return 'A conditional question must refer to an earlier Yes / No question.';
    if (['select', 'multiselect'].includes(q.kind) && (!q.options?.length || q.options.some(v => !v.trim()) || new Set(q.options).size !== q.options.length)) return 'Choice questions need non-empty, unique options.';
    ids.add(q.id);
  }
  return null;
}
