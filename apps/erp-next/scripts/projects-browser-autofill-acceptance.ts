import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const guard = readFileSync(join(root, 'components/projects/projects-browser-autofill-guard.tsx'), 'utf8');
const projectsPage = readFileSync(join(root, 'app/(erp)/projects/page.tsx'), 'utf8');
const directPlannerPage = readFileSync(join(root, 'app/(erp)/projects/phase-planner/page.tsx'), 'utf8');
const workspace = readFileSync(join(root, 'components/projects/projects-phase-workspace-v2.tsx'), 'utf8');

assert.match(guard, /setAttribute\('autocomplete', 'off'\)/, 'Projects forms must disable browser form-history suggestions.');
assert.match(guard, /MutationObserver/, 'Dynamically mounted Project and Phase dialogs must receive the same autocomplete policy.');
assert.match(guard, /data-lpignore/, 'Third-party autofill managers must be asked to ignore ERP business fields.');
assert.match(guard, /data-1p-ignore/, '1Password-style autofill must be suppressed on ERP business fields.');
assert.match(guard, /data-bwignore/, 'Bitwarden-style autofill must be suppressed on ERP business fields.');
assert.match(projectsPage, /data-projects-autofill-scope/, 'The Projects route must scope the browser-autofill guard.');
assert.match(projectsPage, /ProjectsBrowserAutofillGuard/, 'The Projects route must mount the browser-autofill guard.');
assert.match(directPlannerPage, /ProjectsBrowserAutofillGuard/, 'The direct Phase Planner route must use the same guard.');
assert.match(workspace, /role="combobox"/, 'The canonical CRM customer picker must remain an ERP-owned combobox.');
assert.match(workspace, /customerResults/, 'ERP customer matches must remain visible after browser autocomplete is disabled.');
assert.match(workspace, /Create .*New customer|New customer/, 'Explicit new-customer creation must remain available when CRM has no match.');

console.log('Projects browser-autofill acceptance passed: browser history and password-manager menus are suppressed while the ERP CRM customer dropdown remains active.');
