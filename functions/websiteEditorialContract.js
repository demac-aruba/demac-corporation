'use strict';
// Shared by the renderer, editor and privileged writer. This is a CONTENT
// allowlist, never an arbitrary object-path / DOM / HTML mutation interface.
const defaults = require('./websiteVrfDefaults.json');
const PAGE = Object.freeze({ id: 'vrf', name: 'VRF Systems', route: '/services/vrf-systems/', draftId: 'publicVrfPageDraft', publishedId: 'publicVrfPagePublished', publicPath: 'public-website/vrf/published.json' });
const GROUPS = ['solutions', 'benefits', 'indoorUnits', 'applications', 'process', 'services', 'faq'];
const oldHero = new Set(['/website/hero/hero-hospitality.webp', 'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?auto=format&fit=crop&fm=webp&q=88&w=2200', 'https://images.unsplash.com/photo-1775629632806-165d644178c0?auto=format&fit=crop&fm=webp&q=88&w=2200']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const record = (value) => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const text = (value, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const optional = (value, fallback) => typeof value === 'string' ? value.trim() : fallback;
function imageUrl(value, fallback = '', allowPreview = false) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  const url = value.trim();
  if (url.length > 4096 || /[\u0000-\u001f\\]/.test(url)) return fallback;
  if (allowPreview && (/^blob:/.test(url) || /^data:image\/(png|jpeg|webp);base64,/.test(url))) return url;
  if (url.startsWith('/') && !url.startsWith('//') && !url.split(/[?#]/)[0].split('/').includes('..')) return url;
  try { const parsed = new URL(url); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? url : fallback; } catch { return fallback; }
}
function normalizeCards(value, bases, limit) {
  const list = Array.isArray(value) && value.length ? value.slice(0, limit) : bases;
  return list.map((raw, i) => {
    const item = record(raw), base = bases.find((b) => b.id === item.id) || bases[i] || bases[bases.length - 1];
    const out = { id: text(item.id, base.id), title: text(item.title, base.title), description: text(item.description, base.description) };
    for (const key of ['detail', 'imageAlt']) { const v = optional(item[key], base[key]); if (v !== undefined) out[key] = v; }
    const image = imageUrl(item.imageUrl, base.imageUrl); if (image) out.imageUrl = image;
    return out;
  });
}
function normalizeIndoor(value) {
  const source = Array.isArray(value) ? value.map(record) : [];
  return defaults.indoorUnits.map((base) => {
    const aliases = base.id === 'mini-split' ? ['mini-split', 'wall-mounted', 'split-unit'] : [base.id];
    const sourceItem = aliases.map((id) => source.find((x) => x.id === id)).find(Boolean) || {};
    const item = { ...sourceItem, id: base.id };
    if (base.id === 'mini-split') {
      if (['Split Units', 'Wall-Mounted Split Units'].includes(item.title)) item.title = base.title;
      if (['Flexible indoor-unit option for smaller commercial zones.', 'Compact, familiar indoor units with independent zoning.'].includes(item.description)) item.description = base.description;
      if (item.detail === 'Offices · support spaces') item.detail = base.detail;
    }
    return normalizeCards([item], [base], 1)[0];
  });
}
function normalizeVrf(value, id = PAGE.publishedId) {
  const source = record(value), out = clone(defaults);
  out.id = id;
  out.version = Math.max(1, Number(source.version) || defaults.version);
  for (const section of ['hero', 'trust', 'finalCta']) {
    const raw = record(source[section]), base = defaults[section];
    for (const key of Object.keys(base)) {
      if (key.endsWith('Cta')) { const link = record(raw[key]); out[section][key] = { label: text(link.label, base[key].label), href: text(link.href, base[key].href) }; }
      else if (key === 'imageUrl') out[section][key] = imageUrl(raw[key], base[key]);
      else if (key === 'bullets') out[section][key] = Array.isArray(raw[key]) && raw[key].length ? raw[key].slice(0, 8).map((v, i) => text(v, base[key][i] || 'Local support')) : clone(base[key]);
      else out[section][key] = text(raw[key], base[key]);
    }
  }
  if (oldHero.has(out.hero.imageUrl)) { out.hero.imageUrl = defaults.hero.imageUrl; out.hero.imagePosition = defaults.hero.imagePosition; }
  if (!record(source.hero).mobileImagePosition) out.hero.mobileImagePosition = out.hero.imagePosition;
  if (out.trust.imageUrl === 'https://images.unsplash.com/photo-1621905251189-08b45d6a269e?auto=format&fit=crop&fm=webp&q=86&w=1400') out.trust.imageUrl = defaults.trust.imageUrl;
  for (const key of Object.keys(defaults).filter((k) => typeof defaults[k] === 'string' && k !== 'id')) out[key] = text(source[key], defaults[key]);
  for (const group of GROUPS) out[group] = group === 'indoorUnits' ? normalizeIndoor(source[group]) : normalizeCards(source[group], defaults[group], group === 'solutions' ? 3 : group === 'faq' ? 8 : 6);
  for (const key of Object.keys(defaults.editorial)) out.editorial[key] = text(record(source.editorial)[key], defaults.editorial[key]);
  for (const key of ['updatedAt', 'updatedBy', 'publishedAt', 'publishedBy', 'publicationId']) if (typeof source[key] === 'string') out[key] = source[key];
  return out;
}
function descriptors(content) {
  const fields = [];
  const add = (key, label, group, kind = 'text', max = 2500) => fields.push({ key, label, group, kind, max });
  for (const key of ['eyebrow', 'title', 'accent', 'description']) add(`hero.${key}`, `Hero ${key}`, 'Hero', 'text', key === 'description' ? 2500 : 240);
  add('hero.imageUrl', 'Hero image', 'Hero', 'image', 4096);
  add('hero.imagePosition', 'Desktop focal point', 'Hero', 'position', 64);
  add('hero.mobileImagePosition', 'Phone focal point', 'Hero', 'position', 64);
  for (const key of ['solutionsHeading', 'solutionsIntro', 'benefitsHeading', 'indoorHeading', 'indoorIntro', 'applicationsHeading', 'processHeading', 'servicesHeading', 'faqHeading']) add(key, key.replace(/([A-Z])/g, ' $1'), 'Section headings');
  for (const group of GROUPS) for (const item of content[group] || []) {
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(item.id)) continue;
    add(`${group}.${item.id}.title`, `${item.title} · title`, group, 'text', 240);
    add(`${group}.${item.id}.description`, `${item.title} · description`, group);
    if ('detail' in item) add(`${group}.${item.id}.detail`, `${item.title} · ideal for`, group, 'text', 600);
    if (['solutions', 'indoorUnits', 'applications'].includes(group)) {
      add(`${group}.${item.id}.imageUrl`, `${item.title} · image`, group, 'image', 4096);
      add(`${group}.${item.id}.imageAlt`, `${item.title} · image description`, group, 'text', 240);
    }
  }
  for (const key of ['eyebrow', 'title', 'description']) { add(`trust.${key}`, `Local expertise · ${key}`, 'Local expertise'); add(`finalCta.${key}`, `Final section · ${key}`, 'Final section'); }
  add('trust.imageUrl', 'Local expertise image', 'Local expertise', 'image', 4096);
  add('finalCta.imageUrl', 'Final section background', 'Final section', 'image', 4096);
  (content.trust.bullets || []).forEach((_, i) => add(`trust.bullets.${i}`, `Local benefit ${i + 1}`, 'Local expertise', 'text', 400));
  for (const key of Object.keys(defaults.editorial)) add(`editorial.${key}`, key.replace(/([A-Z])/g, ' $1'), 'Supporting copy');
  return fields;
}
function location(document, key) {
  const parts = key.split('.');
  if (GROUPS.includes(parts[0])) { const item = document[parts[0]].find((x) => x.id === parts[1]); return [item, parts[2]]; }
  if (parts[0] === 'trust' && parts[1] === 'bullets') return [document.trust.bullets, Number(parts[2])];
  return parts.length === 1 ? [document, parts[0]] : [document[parts[0]], parts[1]];
}
function values(document) { return Object.fromEntries(descriptors(document).map((field) => { const [owner, key] = location(document, field.key); return [field.key, typeof owner?.[key] === 'string' ? owner[key] : '']; })); }
function applyChanges(document, changes, options = {}) {
  if (!Array.isArray(changes) || changes.length > 250) throw new Error('Invalid editorial change set.');
  const allowed = new Map(descriptors(document).map((field) => [field.key, field]));
  const output = clone(document), seen = new Set();
  for (const change of changes) {
    const field = allowed.get(change?.key);
    if (!field || seen.has(field.key) || typeof change.value !== 'string') throw new Error('This field is not editable.');
    seen.add(field.key);
    const value = change.value.trim();
    if (value.length > field.max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`${field.label} is too long or contains invalid characters.`);
    if (field.kind === 'image' && !imageUrl(value, '', options.allowPreviewImages === true)) throw new Error('Choose a valid website image.');
    if (field.kind === 'position' && !/^(?:\d{1,2}(?:\.\d+)?%|100%|left|center|right) (?:\d{1,2}(?:\.\d+)?%|100%|top|center|bottom)$/.test(value)) throw new Error('Choose a valid image focal point.');
    if (field.kind === 'text' && !value && !field.key.endsWith('.detail') && !field.key.endsWith('.imageAlt')) throw new Error('This text cannot be empty.');
    const [owner, key] = location(output, field.key); owner[key] = value;
  }
  return output;
}
module.exports = { PAGE, defaults, normalizeVrf, normalizeIndoor, descriptors, values, applyChanges, imageUrl };
