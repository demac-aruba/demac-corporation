import type { LocationDraft, PropertyLocationData } from './property-locations';

export type PropertyEditorValue = {
  requestId?: string; id?: string; expectedUpdatedAt?: string;
  name: string; type: string; address: string; zone: string; neighborhood: string;
  accessInstructions: string; notes: string;
  locations?: { expectedVersion: number; rows: LocationDraft[]; areas?: LocationDraft[] };
};
export type DwellingDraft = LocationDraft & { key: string };
export const emptyPropertyEditor: PropertyEditorValue = {
  name: '', type: 'Casa', address: '', zone: '', neighborhood: '', accessInstructions: '', notes: '',
};
export const dwellingTypeLabels = { main_house: 'Casa principal', main_office: 'Oficina principal', apartment: 'Apartamento', annex: 'Anexo' };
export function newDwelling(type: NonNullable<LocationDraft['type']>, rows: DwellingDraft[]): DwellingDraft {
  const prefix = type === 'main_house' ? 'CP' : type === 'main_office' ? 'OF' : type === 'annex' ? 'AN' : 'A';
  const used = new Set(rows.map((row) => row.code.trim().toUpperCase()));
  let number = 1;
  const main = type === 'main_house' || type === 'main_office';
  while (used.has(main && number === 1 ? prefix : `${prefix}-${String(number).padStart(2, '0')}`)) number++;
  return { key: crypto.randomUUID(), code: main && number === 1 ? prefix : `${prefix}-${String(number).padStart(2, '0')}`,
    name: `${dwellingTypeLabels[type]}${main ? '' : ` ${number}`}`, type, contactIds: [], accessInstructions: '' };
}
export function dwellingDrafts(data: PropertyLocationData): DwellingDraft[] {
  const rank = (type: string) => type === 'main_house' || type === 'main_office' ? 0 : type === 'apartment' ? 1 : 2;
  return [...data.dwellings].sort((a, b) => rank(a.type) - rank(b.type) || a.code.localeCompare(b.code, 'en', { numeric: true })).map((row) => ({ ...row, key: row.id,
    contactIds: data.assignments.filter((assignment) => assignment.dwellingId === row.id).map((assignment) => assignment.contactId) }));
}
function editable(row: LocationDraft) {
  return { ...(row.id ? { id: row.id } : {}), name: row.name.trim(), code: row.code.trim(), type: row.type,
    accessInstructions: row.accessInstructions?.trim() || '', contactIds: [...(row.contactIds || [])].sort() };
}
export function changedDwellings(rows: DwellingDraft[], original: DwellingDraft[]): LocationDraft[] {
  return rows.filter((row) => !row.id || JSON.stringify(editable(row)) !== JSON.stringify(editable(original.find((item) => item.id === row.id) || row)))
    .map(editable);
}
export function validateDwellingDrafts(rows: DwellingDraft[]) {
  const codes = new Set<string>();
  for (const row of rows) {
    if (!row.name.trim() || !row.code.trim()) return 'Cada vivienda necesita un nombre y un código.';
    const code = row.code.trim().normalize('NFKC').toLocaleLowerCase('en').replace(/\s+/g, ' ');
    if (codes.has(code)) return `El código «${row.code}» está repetido en esta propiedad.`;
    codes.add(code);
  }
  return '';
}
