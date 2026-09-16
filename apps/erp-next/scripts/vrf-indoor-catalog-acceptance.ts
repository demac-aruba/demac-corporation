import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defaultPublicVrfContent, normalizePublicVrfContent, clonePublicVrfContent } from '../lib/public-vrf-content';
import { defaultVrfIndoorUnits, normalizeVrfIndoorUnits, safeIndoorImageUrl } from '../lib/public-vrf-indoor';

const expectedIds = ['cassette', 'fan-coil', 'floor-ceiling', 'air-handler', 'mini-split'];
assert.deepEqual(defaultPublicVrfContent.indoorUnits.map((unit) => unit.id), expectedIds);
assert.deepEqual(defaultPublicVrfContent.indoorUnits.map((unit) => unit.title), ['Cassette Units', 'Fan Coil Units', 'Floor-Ceiling Units', 'Air Handlers', 'Mini Split Units']);
const legacy = [
  ...defaultVrfIndoorUnits.slice(0, 4).map(({ imageUrl, imageAlt, ...card }) => card),
  { id: 'split-unit', title: 'Split Units', description: 'Flexible indoor-unit option for smaller commercial zones.', detail: 'Offices · support spaces' },
  { id: 'wall-mounted', title: 'Wall-Mounted Split Units', description: 'Compact, familiar indoor units with independent zoning.', detail: 'Bedrooms · offices · smaller rooms' },
];
const before = JSON.stringify(legacy);
const migrated = normalizeVrfIndoorUnits(legacy);
assert.deepEqual(migrated, defaultVrfIndoorUnits, 'Legacy six cards become exactly the approved five');
assert.equal(JSON.stringify(legacy), before, 'Read-time migration does not mutate saved input');
assert.deepEqual(normalizeVrfIndoorUnits(migrated), migrated, 'Normalization is idempotent');
assert.deepEqual(normalizeVrfIndoorUnits([...legacy].reverse()), migrated, 'Canonical IDs, not array positions, choose images');
for (const input of [null, undefined, [], [null, 7, false], {}]) assert.deepEqual(normalizeVrfIndoorUnits(input), defaultVrfIndoorUnits);
const custom = { ...legacy[5], title: 'Custom wall unit label', description: 'Owner-managed description', detail: '', imageUrl: 'https://example.com/approved-product.webp', imageAlt: 'Owner-managed accessible description' };
const customized = normalizeVrfIndoorUnits([...legacy.slice(0, 5), custom]);
assert.equal(customized[4].id, 'mini-split');
assert.equal(customized[4].title, custom.title);
assert.equal(customized[4].description, custom.description);
assert.equal(customized[4].detail, '');
assert.equal(customized[4].imageUrl, custom.imageUrl);
assert.equal(customized[4].imageAlt, custom.imageAlt);
const canonical = { ...defaultVrfIndoorUnits[4], description: 'Canonical overrides legacy' };
assert.equal(normalizeVrfIndoorUnits([...legacy, canonical])[4].description, canonical.description);
const content = normalizePublicVrfContent({ ...defaultPublicVrfContent, indoorUnits: customized });
assert.deepEqual(clonePublicVrfContent(content).indoorUnits, customized, 'Manager clone/save boundary retains media and custom copy');
for (const key of ['hero', 'solutions', 'benefits', 'applications', 'process', 'services', 'trust', 'faq', 'finalCta'] as const) {
  assert.equal(JSON.stringify(content[key]), JSON.stringify(defaultPublicVrfContent[key]), `Unrelated section ${key} stays intact`);
}
for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', '//example.com/image.webp', '/\\example.com/image.webp', 'http://example.com/image.webp']) {
  assert.equal(safeIndoorImageUrl(url, '/fallback.webp'), '/fallback.webp');
}
assert.equal(safeIndoorImageUrl('/website/vrf/photo.webp'), '/website/vrf/photo.webp');
assert.equal(safeIndoorImageUrl('https://example.com/photo.webp'), 'https://example.com/photo.webp');
const digests = [
  'e08d9d3044af131960ab5f07cbba7e571dd30ae96c98ab8d4a27bb3cbac1b406',
  'ebfe4b6008a94a2e9ae44527b7203cab3f4b8047c4d300f50a6576fac1ef9c1f',
  'd9446af47770f5f7ec035ba4fae0ce2d74d34d52555249958b4c0dc333dd5782',
  '3920b11a3bb43b686bc05771ace0182b2386af51b19b474bb98e5ddf0039842f',
  '3778834435e1441fcf1ef84aebe5d5b496b55399a51f37664dfd921c8d8fefc9',
];
let total = 0;
for (const [index, card] of defaultVrfIndoorUnits.entries()) {
  const bytes = readFileSync(resolve('public', `.${card.imageUrl}`));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), digests[index], `${card.id}: exact verified binary, no corrupted upload`);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert(bytes.length < 10000, 'Each card image stays lightweight');
  total += bytes.length;
}
assert(total < 30000);
console.log(`VRF indoor acceptance passed: five canonical categories, legacy consolidation, manager round-trip, unchanged unrelated content and ${total} verified image bytes.`);
