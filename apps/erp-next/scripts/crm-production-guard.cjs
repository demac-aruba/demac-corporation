const { existsSync, readdirSync, readFileSync } = require('node:fs');
const { dirname, extname, join, relative, resolve } = require('node:path');

const appRoot = resolve(__dirname, '..');
const scanRoots = [
  resolve(appRoot, 'components', 'crm'),
  resolve(appRoot, 'app', '(erp)', 'crm'),
];
const sourceExtensions = new Set(['.css', '.ts', '.tsx']);

const forbidden = [
  {
    reason: 'browser-only CRM data dependency',
    pattern: /from\s+['"][^'"]*(?:browser-store|browser-crm|browser-customer-events)['"]/gi,
  },
  {
    reason: 'browser-only persistence API',
    pattern: /\b(?:browserKeys|loadBrowserValue|saveBrowserValue|localStorage)\b/g,
  },
  {
    reason: 'seeded CRM fixture symbol',
    pattern: /\b(?:initialCustomers|initialContacts|initialSites|initialAssets|seededDemoCustomers|fallbackMasterData)\b/g,
  },
  {
    reason: 'known CRM fixture identity',
    pattern: /\b(?:C-1042|C-0887|C-1201|C-1118|C-0741)\b|ABC Aruba N\.V\.|Ocean View Villas|Renaissance Engineering|Maria Croes/gi,
  },
  {
    reason: 'demo or browser-only label',
    pattern: /Browser Test Customers|Persisted on this device|Structured demo intelligence|browser records|browser test workspace|saved locally|browser-persistent test data|Firebase not connected|Preview merge completed|Firebase has not been changed/gi,
  },
  {
    reason: 'preview-only CRM UI or CSS artifact',
    pattern: /\b(?:previewNotice|tabPreview)\b/g,
  },
];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function lineNumber(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

const files = scanRoots.flatMap(sourceFiles);
const violations = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const rule of forbidden) {
    rule.pattern.lastIndex = 0;
    for (const match of source.matchAll(rule.pattern)) {
      violations.push({
        file: relative(appRoot, file).replaceAll('\\', '/'),
        line: lineNumber(source, match.index ?? 0),
        reason: rule.reason,
        value: match[0],
      });
    }
  }

  if (extname(file) !== '.tsx') continue;
  const styleImport = source.match(/import\s+styles\s+from\s+['"]([^'"]+\.module\.css)['"]/);
  if (!styleImport) continue;
  const stylesheet = resolve(dirname(file), styleImport[1]);
  if (!existsSync(stylesheet)) {
    violations.push({
      file: relative(appRoot, file).replaceAll('\\', '/'),
      line: lineNumber(source, styleImport.index ?? 0),
      reason: 'missing CSS module',
      value: styleImport[1],
    });
    continue;
  }
  const css = readFileSync(stylesheet, 'utf8');
  const references = source.matchAll(/styles\.([A-Za-z_][A-Za-z0-9_]*)/g);
  const checked = new Set();
  for (const reference of references) {
    const className = reference[1];
    if (checked.has(className)) continue;
    checked.add(className);
    const selector = new RegExp(`\\.${className}(?![A-Za-z0-9_-])`);
    if (!selector.test(css)) {
      violations.push({
        file: relative(appRoot, file).replaceAll('\\', '/'),
        line: lineNumber(source, reference.index ?? 0),
        reason: 'CSS module class is referenced but not defined',
        value: className,
      });
    }
  }
}

if (violations.length) {
  console.error('CRM production guard failed. Remove browser-only/demo CRM artifacts:');
  for (const violation of violations) {
    console.error(`- ${violation.file}:${violation.line} [${violation.reason}] ${JSON.stringify(violation.value)}`);
  }
  process.exitCode = 1;
} else {
  console.log(`CRM production guard passed (${files.length} files scanned).`);
}
