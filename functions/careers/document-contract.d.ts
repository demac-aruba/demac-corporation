export type SupportingCategory = 'document'|'diploma'|'certificate'|'id';
export interface DocumentRequirement { category: SupportingCategory; required: boolean; helpEn: string; helpEs: string; reviewedSource: string }
export interface DocumentJob { documentRequirements?: DocumentRequirement[] }
export interface CategorizedDocument { kind: string; category?: SupportingCategory }
export const CATEGORIES: readonly SupportingCategory[];
export function parseDocumentRequirements(raw: unknown): DocumentRequirement[];
export function requirementsFor(job: DocumentJob): DocumentRequirement[];
export function categoryLabel(category: SupportingCategory,locale?: 'en'|'es'): string;
export function requirementPresentation(item: DocumentRequirement,locale?: 'en'|'es'): {label:string;help:string;contentLocale:string;translationPending:boolean};
export function documentTranslationIssues(job: DocumentJob): string[];
export function categoryFor(kind:string,raw:unknown): SupportingCategory|undefined;
export function uploadIdentityMaterial(kind:string,hash:string,category?:SupportingCategory):string;
export function validateCategory(job:DocumentJob,category:SupportingCategory,idAllowed?:boolean):void;
export function missingDocumentCategories(job:DocumentJob,documents:CategorizedDocument[]):SupportingCategory[];
export function validateDocuments(job:DocumentJob,documents:CategorizedDocument[],idAllowed?:boolean):void;
