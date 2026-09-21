'use strict';
const path = require('node:path');

// Next 16's Windows export writes nested segment paths where the browser requests
// dot-separated __next segment names. Index only files that actually exist; never
// return HTML or another segment as a successful response for a missing asset.
function assetUrls(relativePath) {
  const normalized = relativePath.replaceAll('\\', '/');
  const marker = normalized.indexOf('/__next.');
  if (marker < 0 || !normalized.endsWith('.txt')) return [`/${normalized}`];
  return [...new Set([`/${normalized}`, `/${normalized.slice(0, marker + 1)}${normalized.slice(marker + 1).replaceAll('/', '.')}`])];
}

function indexStaticAssets(root, fs) {
  const assets = new Map();
  for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    for (const url of assetUrls(path.relative(root, file))) {
      if (assets.has(url) && assets.get(url) !== file) throw new Error(`Ambiguous exported asset: ${url}`);
      assets.set(url, file);
    }
  }
  return assets;
}
module.exports = { assetUrls, indexStaticAssets };
