import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const typography = readFileSync(join(root, 'components/projects/projects-typography-contract.module.css'), 'utf8');
const projectsPage = readFileSync(join(root, 'app/(erp)/projects/page.tsx'), 'utf8');
const directPlannerPage = readFileSync(join(root, 'app/(erp)/projects/phase-planner/page.tsx'), 'utf8');
const erpLayout = readFileSync(join(root, 'app/(erp)/layout.tsx'), 'utf8');
const provider = readFileSync(join(root, 'components/accessibility/text-size-provider.tsx'), 'utf8');
const settings = readFileSync(join(root, 'components/system-settings-workspace.tsx'), 'utf8');

assert.match(erpLayout, /AccessibilityTextProvider/, 'Every ERP module must remain inside the shared accessibility text provider.');
assert.match(settings, /TextSizeControl/, 'System Settings must retain the per-user Text Size control.');
assert.match(provider, /loadBrowserUserPreferences\(principal\.userId\)/, 'Text size must load for the signed-in operator.');
assert.match(provider, /saveBrowserUserPreferences\(principal\.userId/, 'Text size must save for the signed-in operator.');
assert.match(provider, /--demac-accessibility-text-offset/, 'The provider must retain the shared accessibility offset variable.');
assert.match(provider, /element\.closest\('h1,h2,h3'\)/, 'Page and section headings must keep their designed size.');
assert.match(projectsPage, /typography\.scope/, 'The normal Projects route must apply the shared Projects typography contract.');
assert.match(directPlannerPage, /typography\.scope/, 'The direct Phase Planner route must apply the same typography contract.');
assert.match(projectsPage, /data-demac-projects-typography="operational"/, 'Projects must expose an explicit operational typography scope.');
assert.doesNotMatch(projectsPage, /data-demac-text-scale="ignore"/, 'Projects operational text must not opt out of the per-user accessibility setting.');
assert.match(typography, /\[role='dialog'\] h2[\s\S]*font-size:\s*20px/, 'Project dialog titles must retain the ERP modal hierarchy.');
assert.match(typography, /:where\(input, select, textarea\)[\s\S]*font-size:\s*12px/, 'Operational form controls must use a readable Standard baseline.');
assert.doesNotMatch(typography, /\.scope\s+h1\s*\{/, 'The Projects typography contract must not override the global H1 design.');

const declaredPixelSizes = [...typography.matchAll(/font-size:\s*([0-9]+(?:\.[0-9]+)?)px/g)]
  .map((match) => Number(match[1]));
assert.ok(declaredPixelSizes.length > 0, 'The typography contract must declare explicit approved baselines.');
assert.ok(
  declaredPixelSizes.every((size) => size >= 9),
  `Projects must not introduce micro typography below 9px. Found: ${declaredPixelSizes.filter((size) => size < 9).join(', ')}`,
);

console.log('Projects typography acceptance passed: readable ERP baselines, shared per-user +0–+4 px scaling, fixed heading hierarchy, and consistent normal/direct routes verified.');
