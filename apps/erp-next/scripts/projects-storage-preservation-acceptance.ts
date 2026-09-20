import assert from 'node:assert/strict';
import { BROWSER_PROJECTS_PREVIEW_KEY, createProjectsPreviewState, commitBrowserProjectsPreviewMutation, requireStoredProjectForBooking } from '../lib/browser-projects';
import { loadProjectsWithoutSamples, saveProjectsWithoutSamples, commitProjectsWithoutSamples, sanitizeProjectsState } from '../lib/project-record-sanitizer';

async function main() {
  const records = new Map<string, string>(); let writes = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { writes++; records.set(key, value); },
  } } });
  const seed = createProjectsPreviewState().projects[0];
  const modifiedSample = { ...seed, expenses: [...seed.expenses, { id: 'MANUAL-TEST', amount: 123.45, status: 'Approved', description: 'Synthetic user addition' }] };
  const normal = { ...seed, id: 'USER-PROJECT', projectNumber: 'PRJ-USER', expenses: [] };
  const good = { version: 1 as const, selectedProjectId: normal.id, projects: [normal], preservedExtension: { source: 'synthetic original evidence' } };
  const originals: unknown[] = [
    { ...good, projects: [modifiedSample, normal] },
    { ...good, projects: [normal, { ...normal, description: 'Duplicate with different manual data' }] },
    { ...good, projects: [normal, { id: 'LEGACY', expenses: [{ amount: 99 }] }] },
    { version: 2, projects: [normal] },
  ];
  for (const source of [...originals.map(value => JSON.stringify(value)), '{"projects":invalid-json']) {
    records.set(BROWSER_PROJECTS_PREVIEW_KEY, source); writes = 0;
    const loaded = loadProjectsWithoutSamples();
    assert.equal(loaded.recoveryRequired, true);
    assert.equal(writes, 0, 'Viewing Projects must not rewrite originals');
    assert.equal(records.get(BROWSER_PROJECTS_PREVIEW_KEY), source);
    assert.equal(saveProjectsWithoutSamples(good), false);
    await assert.rejects(commitProjectsWithoutSamples(good, () => good), /recovery review/);
    assert.equal(writes, 0, 'Later selection or mutation must not drop hidden originals');
    assert.equal(records.get(BROWSER_PROJECTS_PREVIEW_KEY), source);
  }
  records.set(BROWSER_PROJECTS_PREVIEW_KEY, JSON.stringify(good)); writes = 0;
  for (const source of [...originals.slice(1).map(value => JSON.stringify(value)), '{"projects":invalid-json']) {
    records.set(BROWSER_PROJECTS_PREVIEW_KEY, source); writes = 0;
    assert.throws(() => requireStoredProjectForBooking(normal.id, normal.customerId, normal.siteId), /recovery review/);
    await assert.rejects(commitBrowserProjectsPreviewMutation(good, latest => latest), /recovery review/);
    assert.equal(writes, 0); assert.equal(records.get(BROWSER_PROJECTS_PREVIEW_KEY), source);
  }
  const service = { ...normal, type: 'Service Project', materialBudget: 123.45 };
  const rawLegacy = { ...good, projects: [modifiedSample, service] };
  records.set(BROWSER_PROJECTS_PREVIEW_KEY, JSON.stringify(rawLegacy)); writes = 0;
  requireStoredProjectForBooking(service.id, service.customerId, service.siteId);
  await commitBrowserProjectsPreviewMutation(good, latest => latest);
  assert.deepEqual(JSON.parse(records.get(BROWSER_PROJECTS_PREVIEW_KEY)!), rawLegacy, 'Legacy writer must preserve modified samples, Service budget and extensions');
  assert.throws(() => requireStoredProjectForBooking('MISSING', service.customerId, service.siteId), /original stored Project/);
  assert.throws(() => requireStoredProjectForBooking(service.id, 'WRONG-CUSTOMER', service.siteId), /original stored Project/);
  records.set(BROWSER_PROJECTS_PREVIEW_KEY, JSON.stringify(good)); writes = 0;
  assert.equal(loadProjectsWithoutSamples().recoveryRequired, false);
  assert.equal(writes, 0);
  const updated = await commitProjectsWithoutSamples(good, latest => ({ ...latest, projects: latest.projects.map(project => ({ ...project, description: 'Explicit edit' })) }));
  assert.equal(updated.projects[0].description, 'Explicit edit');
  assert.deepEqual(JSON.parse(records.get(BROWSER_PROJECTS_PREVIEW_KEY)!).preservedExtension, good.preservedExtension);
  // Stale selection input cannot overwrite a newer manual entry.
  const newer = { ...updated, projects: [{ ...updated.projects[0], expenses: modifiedSample.expenses }] };
  records.set(BROWSER_PROJECTS_PREVIEW_KEY, JSON.stringify(newer));
  assert.equal(saveProjectsWithoutSamples(good), true);
  assert.deepEqual(JSON.parse(records.get(BROWSER_PROJECTS_PREVIEW_KEY)!).projects[0].expenses, modifiedSample.expenses);
  assert.equal(sanitizeProjectsState(originals[0]).removedIds[0], modifiedSample.id, 'Sample-ID rows are only hidden from display, not deleted from storage');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: () => { throw Error('storage unavailable'); } } } });
  const unavailable = loadProjectsWithoutSamples();
  assert.equal(unavailable.recoveryRequired, true); assert.match(unavailable.sourceError!, /not an empty/);
  delete (globalThis as { window?: unknown }).window;
  console.log('PASS: originals preserved on reads and writes; malformed, duplicate, modified sample and unavailable storage fail closed; valid updates and stale selection preserve evidence.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
