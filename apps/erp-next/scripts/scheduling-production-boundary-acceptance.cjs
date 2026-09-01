const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const routeRoot = path.join(appRoot, 'app');
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const forbiddenProductionModules = new Set([
  'components/scheduling/booking-copilot.tsx',
  'components/scheduling/booking-drawer.tsx',
  'components/scheduling/dispatch-workspace.tsx',
  'components/scheduling/scheduling-overview-v2.tsx',
  'lib/booking-intelligence/copilot.ts',
  'lib/legacy-scheduling-simulator-fixtures.ts',
  'lib/scheduling-appointment-lifecycle.ts',
].map((relativePath) => path.join(appRoot, relativePath)));
const legacySolverOwnerModules = new Set([
  'lib/scheduling.ts',
  'lib/scheduling-capacity.ts',
].map((relativePath) => path.join(appRoot, relativePath)));
const legacySolverSymbol = /\b(?:findCandidateSlots[A-Za-z0-9_]*|findSupportReflowPlansForDay)\b/;

function fail(message) {
  throw new Error(`Scheduling production-boundary acceptance failed: ${message}`);
}

function collectRouteEntries(directory) {
  const entries = [];
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, item.name);
    if (item.isDirectory()) entries.push(...collectRouteEntries(absolute));
    else if (/^(page|layout|route)\.(?:ts|tsx|js|jsx)$/.test(item.name)) entries.push(absolute);
  }
  return entries;
}

function resolveSource(importer, specifier) {
  if (!(specifier.startsWith('.') || specifier.startsWith('@/'))) return undefined;
  const base = specifier.startsWith('@/')
    ? path.join(appRoot, specifier.slice(2))
    : path.resolve(path.dirname(importer), specifier);
  const candidates = [
    base,
    ...sourceExtensions.map((extension) => `${base}${extension}`),
    ...sourceExtensions.map((extension) => path.join(base, `index${extension}`)),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

function localImports(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const specifiers = [];
  const staticImport = /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const expression of [staticImport, dynamicImport]) {
    let match;
    while ((match = expression.exec(source))) specifiers.push(match[1]);
  }
  return specifiers.map((specifier) => resolveSource(filePath, specifier)).filter(Boolean);
}

function sourceWithoutCommentsAndStrings(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\r\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

function broadlyImportsLegacySolverOwner(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const broadSpecifiers = [];
  const namespaceOrDefaultImport = /\bimport\s+(?!type\s+)(?!\{)(?:[^'";]+?)\s+from\s+['"]([^'"]+)['"]/g;
  const exportAll = /\bexport\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  const commonJsRequire = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const expression of [namespaceOrDefaultImport, exportAll, dynamicImport, commonJsRequire]) {
    let match;
    while ((match = expression.exec(source))) broadSpecifiers.push(match[1]);
  }
  return broadSpecifiers.some((specifier) => legacySolverOwnerModules.has(resolveSource(filePath, specifier)));
}

const entries = collectRouteEntries(routeRoot);
const visited = new Set();
const queue = entries.map((entry) => ({ file: entry, chain: [entry] }));
while (queue.length) {
  const current = queue.shift();
  if (visited.has(current.file)) continue;
  visited.add(current.file);
  if (forbiddenProductionModules.has(current.file)) {
    const trace = current.chain.map((item) => path.relative(appRoot, item)).join(' -> ');
    fail(`a production route reaches a quarantined simulator module: ${trace}`);
  }
  for (const dependency of localImports(current.file)) {
    queue.push({ file: dependency, chain: [...current.chain, dependency] });
  }
}

for (const filePath of visited) {
  if (legacySolverOwnerModules.has(filePath)) continue;
  const source = fs.readFileSync(filePath, 'utf8');
  const symbolMatch = sourceWithoutCommentsAndStrings(source).match(legacySolverSymbol);
  if (symbolMatch) {
    fail(`production code references quarantined solver symbol ${symbolMatch[0]} in ${path.relative(appRoot, filePath)}`);
  }
  if (broadlyImportsLegacySolverOwner(filePath)) {
    fail(`production code broadly imports a legacy solver owner module from ${path.relative(appRoot, filePath)}`);
  }
}

const schedulingSource = fs.readFileSync(path.join(appRoot, 'lib/scheduling.ts'), 'utf8');
const capacitySource = fs.readFileSync(path.join(appRoot, 'lib/scheduling-capacity.ts'), 'utf8');
if (/\bpreviewVans\b/.test(schedulingSource) || /\bpreviewVans\b/.test(capacitySource)) {
  fail('a core scheduling helper still owns a static previewVans registry');
}
if (/vans\s*:\s*(?:readonly\s+)?VanResource\[\]\s*=/.test(`${schedulingSource}\n${capacitySource}`)) {
  fail('a capacity solver still defaults to a static fleet instead of requiring an explicit registry');
}

const schedulingShell = fs.readFileSync(path.join(appRoot, 'components/scheduling/scheduling-page-shell.tsx'), 'utf8');
const liveCreateDrawer = fs.readFileSync(path.join(appRoot, 'components/scheduling/live-appointment-create-drawer.tsx'), 'utf8');
if (!schedulingShell.includes('LiveSchedulingOverview')) fail('the scheduling route is not mounted on the live scheduling projection');
if (!liveCreateDrawer.includes("../../lib/office-booking-authority")) fail('the live create flow is not adapted to Office Booking Authority');

console.log(`Scheduling production boundary passed: ${entries.length} App Router entries cannot reach quarantined Copilot/browser solvers or import legacy solver symbols; core helpers require an explicit Van registry.`);
