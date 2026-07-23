const fs = require('fs');

const screenPath = 'src/screens/InventoryScreenV4.tsx';
let screen = fs.readFileSync(screenPath, 'utf8');

screen = screen.replace("import { uploadInventoryThumbnail } from '../services/inventoryThumbnailStorage';\n", '');
screen = screen.replace(
  "  const [thumbnailBusy, setThumbnailBusy] = useState(false);\n  const [thumbnailProgress, setThumbnailProgress] = useState('');\n",
  '',
);
screen = screen.replace(
  "  const assetsMissingThumbnails = selectedAssets.filter((asset) => asset.latestPhotoUrl && !currentThumbnailUrl(asset));\n",
  '',
);

const migrationPattern = /\n  async function optimizeExistingThumbnails\(\) \{[\s\S]*?\n  \}\n  async function registerTool\(\) \{/;
if (!migrationPattern.test(screen)) {
  throw new Error('No se encontró la migración antigua de miniaturas para retirarla.');
}
screen = screen.replace(migrationPattern, '\n  async function registerTool() {');

const oldSection = `            <SectionTitle
              title={\`Herramientas de \${selectedVan.name}\`}
              subtitle="Pulsa una herramienta para abrir su perfil, condición, observaciones y acciones."
              action={currentUser?.role === 'admin' && assetsMissingThumbnails.length ? (
                <Button
                  compact
                  variant="secondary"
                  label={thumbnailBusy ? \`Optimizando \${thumbnailProgress}\` : \`Optimizar miniaturas (\${assetsMissingThumbnails.length})\`}
                  disabled={thumbnailBusy}
                  onPress={() => void optimizeExistingThumbnails()}
                />
              ) : undefined}
            />`;
const newSection = `            <SectionTitle
              title={\`Herramientas de \${selectedVan.name}\`}
              subtitle="Pulsa una herramienta para abrir su perfil, condición, observaciones y acciones."
            />`;
if (!screen.includes(oldSection)) {
  throw new Error('No se encontró el botón antiguo de optimización para retirarlo.');
}
screen = screen.replace(oldSection, newSection);

screen = screen.replaceAll(
  'thumbnailUrl={photo.thumbnailDownloadUrl} originalUrl={photo.downloadUrl}',
  'thumbnailUrl={thumbnailProxyUrl(photo.downloadUrl)} originalUrl={photo.downloadUrl}',
);

for (const forbidden of [
  'uploadInventoryThumbnail',
  'optimizeExistingThumbnails',
  'assetsMissingThumbnails',
  'thumbnailBusy',
  'thumbnailProgress',
  "from '../services/inventoryThumbnailStorage'",
]) {
  if (screen.includes(forbidden)) throw new Error(`Referencia obsoleta restante: ${forbidden}`);
}
fs.writeFileSync(screenPath, screen);

const packagePath = 'package.json';
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
delete packageJson.scripts['patch:inventory'];
packageJson.scripts['patch:all'] = 'npm run patch:payroll';
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

const obsoleteFiles = [
  'src/services/inventoryThumbnailStorage.ts',
  'scripts/runInventoryUnitPatch.cjs',
  'scripts/apply_inventory_unit_patch.py',
  'scripts/fixInventoryThumbnailPatchIdempotency.cjs',
  'scripts/patchInventorySafeThumbnailsV2.cjs',
  'scripts/patchInventoryThumbnailHardening.cjs',
  'scripts/patchInventoryThumbnailDownloadFix.cjs',
  'scripts/patchInventoryThumbnailStorageV2.cjs',
  'scripts/fixInventoryThumbnailServerPatchIdempotency.cjs',
  'scripts/patchInventoryThumbnailReliability.cjs',
  'scripts/patchInventoryThumbnailServer.cjs',
  'scripts/patchInventoryThumbnailProxyOnly.cjs',
  '.github/workflows/export-inventory-generated.yml',
];
for (const path of obsoleteFiles) {
  if (fs.existsSync(path)) fs.unlinkSync(path);
}

// This script is intentionally one-time and removes itself after consolidating the source.
fs.unlinkSync(__filename);
console.log('Inventory source consolidated and obsolete thumbnail code removed.');
