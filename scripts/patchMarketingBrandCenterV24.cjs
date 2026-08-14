const fs = require('fs');

// MARKETING_BRAND_CENTER_V24
// Turns the static Brand Center placeholder into the authoritative editable
// source for DEMAC marketing facts and approved Aruba Papiamento ad phrases.

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Marketing V24 block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertBefore(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Marketing V24 anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${insertion}${anchor}`);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Marketing V24 anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const service = 'src/services/marketingStorage.ts';

insertBefore(
  service,
  'export type MarketingAsset = {',
  `export type MarketingBrandSettings = {\n  id: 'default';\n  companyName: string;\n  brandName: string;\n  whatsapp: string;\n  primaryContact: string;\n  primaryColor: string;\n  secondaryColor: string;\n  style: string;\n  language: string;\n  defaultFormat: string;\n  footerRule: string;\n  realPhotoRule: string;\n  approvedClaims: string[];\n  approvedProducts: string[];\n  approvedOffers: string[];\n  approvedPapiamentoPhrases: string[];\n  campaignNotes: string[];\n  updatedAt?: string;\n  updatedByUserId?: string;\n  updatedByName?: string;\n};\n\n`,
  'export type MarketingBrandSettings = {',
);

insertAfter(
  service,
  `export async function listMarketingCampaigns() {\n  const campaigns = await listFirestoreCollection<MarketingCampaign>('marketingCampaigns');\n  return campaigns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));\n}`,
  `\n\nexport async function loadMarketingBrandSettings() {\n  const settings = await listFirestoreCollection<MarketingBrandSettings>('marketingBrandSettings');\n  return settings.find((item) => item.id === 'default');\n}\n\nexport async function saveMarketingBrandSettings(settings: MarketingBrandSettings) {\n  await saveFirestoreDocument('marketingBrandSettings', settings);\n  await saveFirestoreDocument('papiamentoCorrections', {\n    id: 'marketing-brand-approved-phrases',\n    sectionKey: 'marketing_brand_center',\n    sourceText: 'DEMAC approved marketing phrases',\n    generatedText: '',\n    correctedText: settings.approvedPapiamentoPhrases.join('\\n'),\n    active: true,\n    createdAt: settings.updatedAt || new Date().toISOString(),\n    updatedAt: settings.updatedAt || new Date().toISOString(),\n    approvedByUserId: settings.updatedByUserId || '',\n    approvedByName: settings.updatedByName || '',\n  });\n}`,
  'export async function saveMarketingBrandSettings(',
);

const screen = 'src/screens/MarketingScreen.tsx';

insertAfter(
  screen,
  "import { colors } from '../theme';",
  "\nimport { DEFAULT_MARKETING_BRAND_SETTINGS } from '../data/marketingBrandDefaults';",
  "DEFAULT_MARKETING_BRAND_SETTINGS } from '../data/marketingBrandDefaults'",
);

insertAfter(
  screen,
  '  MarketingCampaignType,',
  '\n  MarketingBrandSettings,\n  loadMarketingBrandSettings,\n  saveMarketingBrandSettings,',
  '  saveMarketingBrandSettings,',
);

replaceOnce(
  screen,
  "        {activeTab === 'brand' ? <BrandFoundation /> : null}",
  "        {activeTab === 'brand' ? <BrandCenter /> : null}",
  "activeTab === 'brand' ? <BrandCenter />",
);

replaceOnce(
  screen,
  `function BrandFoundation() {\n  return (\n    <View style={styles.foundationWrap}>\n      <Text style={styles.sectionTitle}>Brand Center</Text>\n      <Text style={styles.muted}>Reglas iniciales visibles para validar que el agente está trabajando con la identidad correcta.</Text>\n      <View style={styles.brandRules}>\n        <Rule label=\"Brand\" value=\"DEMAC Professional Cooling Solutions\" />\n        <Rule label=\"Primary color\" value=\"Royal Blue\" />\n        <Rule label=\"Default language\" value=\"Papiamento\" />\n        <Rule label=\"Primary CTA\" value=\"WhatsApp\" />\n        <Rule label=\"WhatsApp\" value=\"564-26-25\" />\n        <Rule label=\"Default format\" value=\"1:1 square · high resolution\" />\n        <Rule label=\"Footer rule\" value=\"Reserve clean bottom margin; never recreate the original footer\" />\n        <Rule label=\"Real photos\" value=\"Preserve authenticity and the installed equipment\" />\n      </View>\n    </View>\n  );\n}`,
  `type BrandEditorState = {\n  companyName: string;\n  brandName: string;\n  whatsapp: string;\n  primaryContact: string;\n  primaryColor: string;\n  secondaryColor: string;\n  style: string;\n  language: string;\n  defaultFormat: string;\n  footerRule: string;\n  realPhotoRule: string;\n  approvedClaims: string;\n  approvedProducts: string;\n  approvedOffers: string;\n  approvedPapiamentoPhrases: string;\n  campaignNotes: string;\n};\n\nfunction lines(value: string) {\n  return value.split(/\\r?\\n/).map((item) => item.trim()).filter(Boolean);\n}\n\nfunction brandEditorFromSettings(settings: Partial<MarketingBrandSettings> = {}): BrandEditorState {\n  const defaults = DEFAULT_MARKETING_BRAND_SETTINGS;\n  return {\n    companyName: settings.companyName ?? defaults.companyName,\n    brandName: settings.brandName ?? defaults.brandName,\n    whatsapp: settings.whatsapp ?? defaults.whatsapp,\n    primaryContact: settings.primaryContact ?? defaults.primaryContact,\n    primaryColor: settings.primaryColor ?? defaults.primaryColor,\n    secondaryColor: settings.secondaryColor ?? defaults.secondaryColor,\n    style: settings.style ?? defaults.style,\n    language: settings.language ?? defaults.language,\n    defaultFormat: settings.defaultFormat ?? defaults.defaultFormat,\n    footerRule: settings.footerRule ?? defaults.footerRule,\n    realPhotoRule: settings.realPhotoRule ?? defaults.realPhotoRule,\n    approvedClaims: (settings.approvedClaims ?? [...defaults.approvedClaims]).join('\\n'),\n    approvedProducts: (settings.approvedProducts ?? [...defaults.approvedProducts]).join('\\n'),\n    approvedOffers: (settings.approvedOffers ?? [...defaults.approvedOffers]).join('\\n'),\n    approvedPapiamentoPhrases: (settings.approvedPapiamentoPhrases ?? [...defaults.approvedPapiamentoPhrases]).join('\\n'),\n    campaignNotes: (settings.campaignNotes ?? [...defaults.campaignNotes]).join('\\n'),\n  };\n}\n\nfunction BrandCenter() {\n  const { currentUser } = useAppState();\n  const [editor, setEditor] = useState<BrandEditorState>(() => brandEditorFromSettings());\n  const [loadingBrand, setLoadingBrand] = useState(true);\n  const [savingBrand, setSavingBrand] = useState(false);\n  const [brandSaved, setBrandSaved] = useState(false);\n  const [brandExists, setBrandExists] = useState(false);\n  const [brandError, setBrandError] = useState<string>();\n\n  const loadBrand = useCallback(async () => {\n    setLoadingBrand(true);\n    setBrandError(undefined);\n    try {\n      const stored = await loadMarketingBrandSettings();\n      setBrandExists(Boolean(stored));\n      setEditor(brandEditorFromSettings(stored));\n    } catch (error) {\n      setBrandError(error instanceof Error ? error.message : 'No se pudo cargar Brand Center.');\n    } finally {\n      setLoadingBrand(false);\n    }\n  }, []);\n\n  useEffect(() => { void loadBrand(); }, [loadBrand]);\n\n  const update = useCallback((key: keyof BrandEditorState, value: string) => {\n    setBrandSaved(false);\n    setEditor((current) => ({ ...current, [key]: value }));\n  }, []);\n\n  const resetDefaults = useCallback(() => {\n    setEditor(brandEditorFromSettings());\n    setBrandSaved(false);\n  }, []);\n\n  const saveBrand = useCallback(async () => {\n    if (!currentUser || savingBrand) return;\n    setSavingBrand(true);\n    setBrandError(undefined);\n    try {\n      const now = new Date().toISOString();\n      const settings: MarketingBrandSettings = {\n        id: 'default',\n        companyName: editor.companyName.trim(),\n        brandName: editor.brandName.trim(),\n        whatsapp: editor.whatsapp.trim(),\n        primaryContact: editor.primaryContact.trim(),\n        primaryColor: editor.primaryColor.trim(),\n        secondaryColor: editor.secondaryColor.trim(),\n        style: editor.style.trim(),\n        language: editor.language.trim(),\n        defaultFormat: editor.defaultFormat.trim(),\n        footerRule: editor.footerRule.trim(),\n        realPhotoRule: editor.realPhotoRule.trim(),\n        approvedClaims: lines(editor.approvedClaims),\n        approvedProducts: lines(editor.approvedProducts),\n        approvedOffers: lines(editor.approvedOffers),\n        approvedPapiamentoPhrases: lines(editor.approvedPapiamentoPhrases),\n        campaignNotes: lines(editor.campaignNotes),\n        updatedAt: now,\n        updatedByUserId: currentUser.id,\n        updatedByName: currentUser.name,\n      };\n      await saveMarketingBrandSettings(settings);\n      setBrandExists(true);\n      setBrandSaved(true);\n      Alert.alert('Brand Center', 'Reglas y hechos aprobados guardados. El Marketing Agent usará esta versión desde ahora.');\n    } catch (error) {\n      setBrandError(error instanceof Error ? error.message : 'No se pudo guardar Brand Center.');\n    } finally {\n      setSavingBrand(false);\n    }\n  }, [currentUser, editor, savingBrand]);\n\n  const listField = (label: string, key: keyof BrandEditorState, help: string, danger = false) => (\n    <View style={styles.brandField}>\n      <Text style={[styles.brandFieldLabel, danger && styles.brandDangerLabel]}>{label}</Text>\n      <Text style={styles.brandFieldHelp}>{help}</Text>\n      <TextInput\n        multiline\n        value={editor[key]}\n        onChangeText={(value) => update(key, value)}\n        placeholder=\"Una entrada por línea\"\n        placeholderTextColor=\"#98A2B3\"\n        style={[styles.brandTextArea, danger && styles.brandOfferArea]}\n        textAlignVertical=\"top\"\n      />\n    </View>\n  );\n\n  if (loadingBrand) return <View style={styles.foundationWrap}><Text style={styles.muted}>Cargando Brand Center…</Text></View>;\n\n  return (\n    <View style={styles.foundationWrap}>\n      <View style={styles.brandCenterHeader}>\n        <View style={styles.brandCenterHeaderText}>\n          <Text style={styles.sectionTitle}>Brand Center · Approved Marketing Facts</Text>\n          <Text style={styles.muted}>Esta es la fuente autorizada que usa el Marketing Agent. Los datos editables viven en Firestore, no dentro del prompt.</Text>\n        </View>\n        <View style={[styles.brandStateBadge, brandExists ? styles.brandStateLive : styles.brandStateDraft]}>\n          <Text style={styles.brandStateText}>{brandExists ? 'LIVE CONFIG' : 'DEFAULTS · NOT SAVED'}</Text>\n        </View>\n      </View>\n\n      {brandError ? <Text style={styles.errorText}>{brandError}</Text> : null}\n      {brandSaved ? <Text style={styles.brandSavedText}>✓ Saved · Campaign Strategist and Papiamento validator will use this configuration.</Text> : null}\n\n      <View style={styles.brandEditorGrid}>\n        <View style={styles.brandEditorCard}>\n          <Text style={styles.foundationCardTag}>IDENTITY + CONTACT</Text>\n          <BrandInput label=\"Company name\" value={editor.companyName} onChangeText={(value) => update('companyName', value)} />\n          <BrandInput label=\"Short brand\" value={editor.brandName} onChangeText={(value) => update('brandName', value)} />\n          <BrandInput label=\"Primary contact\" value={editor.primaryContact} onChangeText={(value) => update('primaryContact', value)} />\n          <BrandInput label=\"WhatsApp\" value={editor.whatsapp} onChangeText={(value) => update('whatsapp', value)} />\n          <BrandInput label=\"Default language\" value={editor.language} onChangeText={(value) => update('language', value)} />\n        </View>\n\n        <View style={styles.brandEditorCard}>\n          <Text style={styles.foundationCardTag}>VISUAL SYSTEM</Text>\n          <BrandInput label=\"Primary color\" value={editor.primaryColor} onChangeText={(value) => update('primaryColor', value)} />\n          <BrandInput label=\"Secondary color\" value={editor.secondaryColor} onChangeText={(value) => update('secondaryColor', value)} />\n          <BrandInput label=\"Style\" value={editor.style} onChangeText={(value) => update('style', value)} multiline />\n          <BrandInput label=\"Default format\" value={editor.defaultFormat} onChangeText={(value) => update('defaultFormat', value)} multiline />\n          <BrandInput label=\"Footer rule\" value={editor.footerRule} onChangeText={(value) => update('footerRule', value)} multiline />\n          <BrandInput label=\"Real-photo rule\" value={editor.realPhotoRule} onChangeText={(value) => update('realPhotoRule', value)} multiline />\n        </View>\n      </View>\n\n      <View style={styles.brandListsGrid}>\n        {listField('Approved Papiamento phrases', 'approvedPapiamentoPhrases', 'Una frase aprobada por línea. Al guardar, este banco también alimenta el validador de Papiamento del Strategist.')}\n        {listField('Approved claims', 'approvedClaims', 'Solo afirmaciones comerciales que DEMAC puede publicar exactamente como hechos.')}\n        {listField('Approved products / exact facts', 'approvedProducts', 'Producto, BTU, precio y especificaciones deben permanecer exactos. Una variante por línea.')}\n        {listField('ACTIVE approved offers / promotions', 'approvedOffers', 'Vacío significa: NO hay promoción activa. El agente no puede inventar ni reutilizar una oferta anterior.', true)}\n        {listField('Campaign notes', 'campaignNotes', 'Reglas operativas de marketing que el Strategist debe considerar.')}\n      </View>\n\n      <View style={styles.brandActions}>\n        <Pressable disabled={savingBrand} onPress={resetDefaults} style={styles.secondaryButton}><Text style={styles.secondaryButtonText}>Restore DEMAC defaults</Text></Pressable>\n        <Pressable disabled={savingBrand || !currentUser} onPress={() => void saveBrand()} style={[styles.primaryButton, (savingBrand || !currentUser) && styles.buttonDisabled]}>\n          <Text style={styles.primaryButtonText}>{savingBrand ? 'Saving…' : 'Save Brand Center'}</Text>\n        </Pressable>\n      </View>\n    </View>\n  );\n}\n\nfunction BrandInput({ label, value, onChangeText, multiline = false }: { label: string; value: string; onChangeText: (value: string) => void; multiline?: boolean }) {\n  return (\n    <View style={styles.brandInputWrap}>\n      <Text style={styles.brandFieldLabel}>{label}</Text>\n      <TextInput\n        value={value}\n        onChangeText={onChangeText}\n        multiline={multiline}\n        style={[styles.input, multiline && styles.brandSmallTextArea]}\n        textAlignVertical={multiline ? 'top' : 'center'}\n      />\n    </View>\n  );\n}`,
  'function BrandCenter() {',
);

replaceOnce(
  screen,
  "          ['Art direction + rendering', false],",
  "          ['Brand Center + approved facts', true],\n          ['Art direction + rendering', false],",
  "['Brand Center + approved facts', true]",
);

insertBefore(
  screen,
  `  brandRules: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },`,
  `  brandCenterHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' },\n  brandCenterHeaderText: { flex: 1, minWidth: 260 },\n  brandStateBadge: { borderRadius: 12, paddingHorizontal: 9, paddingVertical: 6 },\n  brandStateLive: { backgroundColor: colors.successLight },\n  brandStateDraft: { backgroundColor: colors.warningLight },\n  brandStateText: { color: colors.text, fontSize: 7, fontWeight: '900', letterSpacing: 0.5 },\n  brandSavedText: { color: colors.success, fontSize: 9, fontWeight: '800', marginTop: 10 },\n  brandEditorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },\n  brandEditorCard: { flex: 1, minWidth: 300, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 15 },\n  brandInputWrap: { marginTop: 11 },\n  brandFieldLabel: { color: colors.text, fontSize: 8, fontWeight: '900', marginBottom: 5 },\n  brandFieldHelp: { color: colors.muted, fontSize: 8, lineHeight: 12, marginBottom: 7 },\n  brandSmallTextArea: { minHeight: 72, paddingTop: 9 },\n  brandListsGrid: { gap: 12 },\n  brandField: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 14 },\n  brandTextArea: { minHeight: 118, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: colors.text, backgroundColor: '#FBFCFE', fontSize: 9, lineHeight: 14 },\n  brandDangerLabel: { color: colors.danger },\n  brandOfferArea: { borderColor: '#F0B8B8', backgroundColor: '#FFF9F9' },\n  brandActions: { flexDirection: 'row', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 9 },\n`,
  'brandCenterHeader: {',
);

console.log('Marketing Brand Center V24 applied.');
