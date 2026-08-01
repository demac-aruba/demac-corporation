const fs = require('fs');
const path = require('path');

const inputPath = process.argv[2];
const outputPath = process.argv[3] || path.join('functions', 'data', 'papiamento-aruba-vocabulary-2009.json');

if (!inputPath) {
  throw new Error('Usage: node scripts/buildPapiamentoArubaVocabulary.cjs <pdftotext-layout.txt> [output.json]');
}

const source = fs.readFileSync(inputPath, 'utf8').normalize('NFC');
const entries = new Set();

for (const rawLine of source.split(/\r?\n/)) {
  const line = rawLine.replace(/\f/g, '').trim();
  if (!line) continue;
  if (/^P\s+\d+\s*\/\s*72$/i.test(line)) continue;
  if (/^Vocabulario\s+di\s+Papiamento$/i.test(line)) continue;
  if (/^Vocabulario di Papiamento\s+Aruba 2009\s+www\.papiamento\.aw$/i.test(line)) continue;
  if (/^(ANEXO|Vocabulario|di|Papiamento)$/i.test(line)) continue;

  for (const column of line.split(/\s{2,}/)) {
    const entry = column.trim();
    if (!entry || /^P\s+\d+\s*\/\s*72$/i.test(entry)) continue;
    if (/^Vocabulario di Papiamento/i.test(entry)) continue;
    entries.add(entry);
  }
}

const words = new Set();
for (const entry of entries) {
  for (const token of entry.toLocaleLowerCase('pap-AW').match(/\p{L}+(?:[-'’]\p{L}+)*/gu) || []) {
    words.add(token);
  }
}

const payload = {
  source: 'Departamento di Enseñansa Aruba',
  sourceUrl: 'https://www.ea.aw/pages/wp-content/uploads/pdf/doc-pub/p/papiamento_Vocabulario-di-Papiamento-2009.pdf',
  referenceSite: 'https://papiamento.aw',
  orthography: 'Papiamento di Aruba',
  orthographyVersion: 'April 2009',
  retrievedAt: '2026-08-01',
  entryCount: entries.size,
  wordCount: words.size,
  words: [...words].sort((first, second) => first.localeCompare(second, 'pap-AW')),
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(payload)}\n`);
console.log(`Wrote ${payload.entryCount} official entries and ${payload.wordCount} searchable words to ${outputPath}.`);
