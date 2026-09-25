/** Display-only excerpt. Stored editorial text and submission evidence stay untouched. */
export function careersExcerpt(value: string, limit = 180): string {
  const plain = value.replace(/\s+/g, ' ').trim();
  if (plain.length <= limit) return plain;
  const prefix = plain.slice(0, limit - 1);
  const word = prefix.lastIndexOf(' ');
  return `${prefix.slice(0, word > limit / 2 ? word : prefix.length).trimEnd()}…`;
}
