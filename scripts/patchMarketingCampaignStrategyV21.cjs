const fs = require('fs');

// MARKETING_CAMPAIGN_STRATEGY_V21
// V21 connects the V1C Campaign Strategist to the Marketing workspace after
// V18 foundation + V19 visual analysis + V20 authenticated callable patches.

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Marketing V21 block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Marketing V21 anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const service = 'src/services/marketingStorage.ts';

replaceOnce(
  service,
  `export type MarketingUploadSession = {\n  id: string;\n  name: string;\n  campaignType: MarketingCampaignType;\n  status: MarketingUploadSessionStatus;\n  expectedAssetCount: number;\n  uploadedAssetCount: number;\n  failedAssetCount: number;\n  createdAt: string;\n  updatedAt: string;\n  createdByUserId: string;\n  createdByName: string;\n  analysisStatus?: MarketingAnalysisStatus;\n  analysisRequestedAt?: string;\n  analysisStartedAt?: string;\n  analysisCompletedAt?: string;\n  analysisFailedAt?: string;\n  analysisSourceKey?: string;\n  analysisModel?: string;\n  analysisError?: string;\n  analyzedAssetCount?: number;\n  usableAssetCount?: number;\n  primaryAssetId?: string | null;\n  bestAssetIds?: string[];\n  recommendedCampaignType?: MarketingCampaignType;\n};\n\nexport type MarketingAsset = {`,
  `export type MarketingUploadSession = {\n  id: string;\n  name: string;\n  campaignType: MarketingCampaignType;\n  status: MarketingUploadSessionStatus;\n  expectedAssetCount: number;\n  uploadedAssetCount: number;\n  failedAssetCount: number;\n  createdAt: string;\n  updatedAt: string;\n  createdByUserId: string;\n  createdByName: string;\n  analysisStatus?: MarketingAnalysisStatus;\n  analysisRequestedAt?: string;\n  analysisStartedAt?: string;\n  analysisCompletedAt?: string;\n  analysisFailedAt?: string;\n  analysisSourceKey?: string;\n  analysisModel?: string;\n  analysisError?: string;\n  analyzedAssetCount?: number;\n  usableAssetCount?: number;\n  primaryAssetId?: string | null;\n  bestAssetIds?: string[];\n  recommendedCampaignType?: MarketingCampaignType;\n  campaignStrategyStatus?: 'processing' | 'completed' | 'failed';\n  campaignStrategyRequestedAt?: string;\n  campaignStrategyCompletedAt?: string;\n  campaignStrategyFailedAt?: string;\n  campaignStrategyId?: string;\n  campaignStrategyError?: string;\n};\n\nexport type MarketingCampaign = {\n  id: string;\n  sessionId: string;\n  status: 'strategy_completed';\n  campaignType: MarketingCampaignType;\n  objective: string;\n  angle: string;\n  targetAction: string;\n  heroAssetId: string;\n  supportingAssetIds: string[];\n  copy: {\n    language: 'pap_aw';\n    headline: string;\n    subheadline: string;\n    primaryText: string;\n    cta: string;\n  };\n  visualDirection: {\n    heroTreatment: string;\n    hierarchy: string[];\n    overlayNotes: string[];\n    footerInstruction: string;\n  };\n  factPolicy: {\n    priceOrPromoIncluded: boolean;\n    factNotes: string[];\n  };\n  papiamentoValidationStatus: 'passed' | 'needs_review';\n  papiamentoUnknownWords: string[];\n  papiamentoRevisionAttempted: boolean;\n  approvedFactSnapshot?: Record<string, unknown>;\n  model?: string;\n  createdAt: string;\n  updatedAt: string;\n  generatedByUserId: string;\n};\n\nexport type MarketingAsset = {`,
  'export type MarketingCampaign = {',
);

insertAfter(
  service,
  `export async function listMarketingAssets() {\n  const assets = await listFirestoreCollection<MarketingAsset>('marketingAssets');\n  return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));\n}`,
  `\n\nexport async function listMarketingCampaigns() {\n  const campaigns = await listFirestoreCollection<MarketingCampaign>('marketingCampaigns');\n  return campaigns.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));\n}`,
  'export async function listMarketingCampaigns()',
);

insertAfter(
  service,
  `export async function requestMarketingAnalysis(sessionId: string) {\n  const session = await requireSession();\n  const endpoint = 'https://us-central1-demac-corporation.cloudfunctions.net/requestMarketingImageAnalysis';\n  const response = await fetch(endpoint, {\n    method: 'POST',\n    headers: {\n      Authorization: \`Bearer \${session.idToken}\`,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({ data: { sessionId } }),\n  });\n  const responseText = await response.text();\n  let payload: { data?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string; status?: string } } = {};\n  try { payload = responseText ? JSON.parse(responseText) : {}; } catch { /* handled below */ }\n  if (!response.ok || payload.error) {\n    const message = payload.error?.message || responseText.trim() || 'No se pudo ejecutar el análisis visual.';\n    throw new Error(\`\${message} (Marketing Agent \${response.status})\`);\n  }\n  return payload.data ?? payload.result ?? {};\n}`,
  `\n\nexport async function requestMarketingCampaignStrategy(sessionId: string) {\n  const session = await requireSession();\n  const endpoint = 'https://us-central1-demac-corporation.cloudfunctions.net/requestMarketingCampaignStrategy';\n  const response = await fetch(endpoint, {\n    method: 'POST',\n    headers: {\n      Authorization: \`Bearer \${session.idToken}\`,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({ data: { sessionId } }),\n  });\n  const responseText = await response.text();\n  let payload: { data?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string; status?: string } } = {};\n  try { payload = responseText ? JSON.parse(responseText) : {}; } catch { /* handled below */ }\n  if (!response.ok || payload.error) {\n    const message = payload.error?.message || responseText.trim() || 'No se pudo generar la estrategia de campaña.';\n    throw new Error(\`\${message} (Campaign Strategist \${response.status})\`);\n  }\n  return payload.data ?? payload.result ?? {};\n}`,
  'cloudfunctions.net/requestMarketingCampaignStrategy',
);

const screen = 'src/screens/MarketingScreen.tsx';

insertAfter(
  screen,
  '  requestMarketingAnalysis,',
  '\n  listMarketingCampaigns,\n  MarketingCampaign,\n  requestMarketingCampaignStrategy,',
  '  requestMarketingCampaignStrategy,',
);

insertAfter(
  screen,
  '  const [assets, setAssets] = useState<MarketingAsset[]>([]);',
  '\n  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([]);',
  'const [campaigns, setCampaigns]',
);

insertAfter(
  screen,
  '  const [analysisSubmitting, setAnalysisSubmitting] = useState(false);',
  '\n  const [strategySubmitting, setStrategySubmitting] = useState(false);',
  'const [strategySubmitting, setStrategySubmitting]',
);

replaceOnce(
  screen,
  `      const [nextSessions, nextAssets] = await Promise.all([\n        listMarketingUploadSessions(),\n        listMarketingAssets(),\n      ]);\n      setSessions(nextSessions);\n      setAssets(nextAssets);`,
  `      const [nextSessions, nextAssets, nextCampaigns] = await Promise.all([\n        listMarketingUploadSessions(),\n        listMarketingAssets(),\n        listMarketingCampaigns(),\n      ]);\n      setSessions(nextSessions);\n      setAssets(nextAssets);\n      setCampaigns(nextCampaigns);`,
  'const [nextSessions, nextAssets, nextCampaigns]',
);

insertAfter(
  screen,
  `  const selectedSession = useMemo(\n    () => sessions.find((session) => session.id === selectedSessionId),\n    [sessions, selectedSessionId],\n  );`,
  `\n  const selectedCampaign = useMemo(\n    () => campaigns.find((campaign) => campaign.sessionId === selectedSessionId),\n    [campaigns, selectedSessionId],\n  );`,
  'const selectedCampaign = useMemo',
);

insertAfter(
  screen,
  '  }, [analysisSubmitting, refresh, selectedAssets.length, selectedSession]);',
  `\n\n  const generateSelectedStrategy = useCallback(async () => {\n    if (!selectedSession || selectedSession.analysisStatus !== 'completed' || strategySubmitting) return;\n    setStrategySubmitting(true);\n    try {\n      await requestMarketingCampaignStrategy(selectedSession.id);\n      await refresh();\n      Alert.alert('Campaign Strategist', 'La estrategia, el copy en Papiamento y la dirección visual ya están disponibles.');\n    } catch (error) {\n      Alert.alert('No se pudo generar la campaña', error instanceof Error ? error.message : 'Error inesperado.');\n    } finally {\n      setStrategySubmitting(false);\n    }\n  }, [refresh, selectedSession, strategySubmitting]);`,
  'const generateSelectedStrategy = useCallback',
);

replaceOnce(
  screen,
  '<View style={styles.headerBadge}><Text style={styles.headerBadgeText}>V1B · VISUAL AI</Text></View>',
  '<View style={styles.headerBadge}><Text style={styles.headerBadgeText}>V1C · CAMPAIGN AI</Text></View>',
  'V1C · CAMPAIGN AI',
);

replaceOnce(
  screen,
  `                {selectedSession ? (\n                  <Pressable\n                    disabled={!selectedAssets.length || analysisSubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '')}\n                    style={[styles.analyzeButton, (!selectedAssets.length || analysisSubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '')) && styles.buttonDisabled]}\n                    onPress={() => void analyzeSelectedSession()}\n                  >\n                    <Text style={styles.analyzeButtonText}>{analysisSubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '') ? '✦ Analyzing photos…' : selectedSession.analysisStatus === 'completed' ? '✦ Re-analyze with Marketing Agent' : '✦ Analyze with Marketing Agent'}</Text>\n                  </Pressable>\n                ) : null}`,
  `                {selectedSession ? (\n                  <View style={styles.agentActionRow}>\n                    <Pressable\n                      disabled={!selectedAssets.length || analysisSubmitting || strategySubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '')}\n                      style={[styles.analyzeButton, (!selectedAssets.length || analysisSubmitting || strategySubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '')) && styles.buttonDisabled]}\n                      onPress={() => void analyzeSelectedSession()}\n                    >\n                      <Text style={styles.analyzeButtonText}>{analysisSubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '') ? '✦ Analyzing photos…' : selectedSession.analysisStatus === 'completed' ? '✦ Re-analyze photos' : '✦ Analyze photos'}</Text>\n                    </Pressable>\n                    <Pressable\n                      disabled={selectedSession.analysisStatus !== 'completed' || analysisSubmitting || strategySubmitting}\n                      style={[styles.strategyButton, (selectedSession.analysisStatus !== 'completed' || analysisSubmitting || strategySubmitting) && styles.buttonDisabled]}\n                      onPress={() => void generateSelectedStrategy()}\n                    >\n                      <Text style={styles.strategyButtonText}>{strategySubmitting || selectedSession.campaignStrategyStatus === 'processing' ? '◆ Building campaign…' : selectedCampaign ? '◆ Regenerate Campaign Strategy' : '◆ Generate Campaign Strategy'}</Text>\n                    </Pressable>\n                  </View>\n                ) : null}`,
  '◆ Generate Campaign Strategy',
);

replaceOnce(
  screen,
  `              </View>\n\n              {!selectedAssets.length ? (`,
  `              </View>\n\n              {selectedCampaign ? <CampaignStrategyCard campaign={selectedCampaign} assets={selectedAssets} /> : null}\n              {!selectedCampaign && selectedSession?.campaignStrategyStatus === 'failed' ? <Text style={styles.errorText}>Campaign Strategist: {selectedSession.campaignStrategyError || 'No se pudo generar la estrategia.'}</Text> : null}\n\n              {!selectedAssets.length ? (`,
  'CampaignStrategyCard campaign={selectedCampaign}',
);

replaceOnce(
  screen,
  "        {activeTab === 'campaigns' ? <CampaignsFoundation /> : null}",
  "        {activeTab === 'campaigns' ? <CampaignsFoundation campaigns={campaigns} assets={assets} /> : null}",
  'CampaignsFoundation campaigns={campaigns}',
);

replaceOnce(
  screen,
  "          ['Papiamento validation', false],",
  "          ['Campaign strategy + Papiamento copy', true],",
  "['Campaign strategy + Papiamento copy', true]",
);

insertAfter(
  screen,
  `}\n\nfunction AgentHome({ sessions, assets }: { sessions: MarketingUploadSession[]; assets: MarketingAsset[] }) {`,
  `\n\nfunction CampaignStrategyCard({ campaign, assets }: { campaign: MarketingCampaign; assets: MarketingAsset[] }) {\n  const hero = assets.find((asset) => asset.id === campaign.heroAssetId);\n  const validationPassed = campaign.papiamentoValidationStatus === 'passed';\n  return (\n    <View style={styles.strategyCard}>\n      <View style={styles.strategyHeader}>\n        <View>\n          <Text style={styles.foundationCardTag}>CAMPAIGN STRATEGY · {campaignLabels[campaign.campaignType].toUpperCase()}</Text>\n          <Text style={styles.strategyHeadline}>{campaign.copy.headline}</Text>\n        </View>\n        <View style={[styles.validationBadge, validationPassed ? styles.validationPassed : styles.validationReview]}>\n          <Text style={styles.validationBadgeText}>{validationPassed ? 'PAPIAMENTO PASS' : 'LANGUAGE REVIEW'}</Text>\n        </View>\n      </View>\n      <View style={styles.strategyBody}>\n        {hero ? <Image source={{ uri: hero.thumbnailUrl || hero.downloadUrl }} style={styles.strategyHero} resizeMode=\"cover\" /> : null}\n        <View style={styles.strategyCopy}>\n          <Text style={styles.strategySubheadline}>{campaign.copy.subheadline}</Text>\n          <Text style={styles.strategyPrimaryText}>{campaign.copy.primaryText}</Text>\n          <View style={styles.ctaPreview}><Text style={styles.ctaPreviewText}>{campaign.copy.cta}</Text></View>\n          <Text style={styles.strategyMetaLabel}>OBJECTIVE</Text>\n          <Text style={styles.strategyMetaText}>{campaign.objective}</Text>\n          <Text style={styles.strategyMetaLabel}>ANGLE</Text>\n          <Text style={styles.strategyMetaText}>{campaign.angle}</Text>\n        </View>\n      </View>\n      <View style={styles.strategyDetails}>\n        <View style={styles.strategyDetailColumn}>\n          <Text style={styles.strategyMetaLabel}>VISUAL DIRECTION</Text>\n          <Text style={styles.strategyMetaText}>{campaign.visualDirection.heroTreatment}</Text>\n          {campaign.visualDirection.hierarchy.map((item, index) => <Text key={\`hierarchy-\${index}\`} style={styles.strategyBullet}>• {item}</Text>)}\n        </View>\n        <View style={styles.strategyDetailColumn}>\n          <Text style={styles.strategyMetaLabel}>FACT GUARDRAILS</Text>\n          <Text style={styles.strategyMetaText}>{campaign.factPolicy.priceOrPromoIncluded ? 'Approved commercial offer included.' : 'No price or promotion added unless approved in Brand Center.'}</Text>\n          {campaign.factPolicy.factNotes.map((item, index) => <Text key={\`fact-\${index}\`} style={styles.strategyBullet}>• {item}</Text>)}\n          {campaign.papiamentoUnknownWords.length ? <Text style={styles.errorText}>Review words: {campaign.papiamentoUnknownWords.join(', ')}</Text> : null}\n        </View>\n      </View>\n    </View>\n  );\n}\n`,
  'function CampaignStrategyCard(',
);

replaceOnce(
  screen,
  `function CampaignsFoundation() {\n  return (\n    <View style={styles.foundationWrap}>\n      <Text style={styles.sectionTitle}>Campaign Library</Text>\n      <Text style={styles.muted}>Tipos iniciales que el agente reconocerá y aplicará automáticamente.</Text>\n      <View style={styles.foundationGrid}>\n        {(Object.keys(campaignLabels) as MarketingCampaignType[]).filter((key) => key !== 'other').map((key) => (\n          <View key={key} style={styles.foundationCard}>\n            <Text style={styles.foundationCardTag}>CAMPAIGN TEMPLATE</Text>\n            <Text style={styles.foundationCardTitle}>{campaignLabels[key]}</Text>\n            <Text style={styles.foundationCardText}>Estructura preparada para incorporar reglas, copy, composición y QA específicos.</Text>\n          </View>\n        ))}\n      </View>\n    </View>\n  );\n}`,
  `function CampaignsFoundation({ campaigns, assets }: { campaigns: MarketingCampaign[]; assets: MarketingAsset[] }) {\n  return (\n    <View style={styles.foundationWrap}>\n      <Text style={styles.sectionTitle}>Campaign Library</Text>\n      <Text style={styles.muted}>Estrategias generadas por el Marketing Agent a partir de fotos reales analizadas.</Text>\n      {!campaigns.length ? (\n        <View style={styles.emptyState}><Text style={styles.emptyIcon}>◎</Text><Text style={styles.emptyTitle}>Todavía no hay campañas generadas</Text><Text style={styles.emptyHelp}>Analiza una sesión de fotos y usa Generate Campaign Strategy.</Text></View>\n      ) : (\n        <View style={styles.foundationWrap}>\n          {campaigns.map((campaign) => <CampaignStrategyCard key={campaign.id} campaign={campaign} assets={assets.filter((asset) => asset.sessionId === campaign.sessionId)} />)}\n        </View>\n      )}\n    </View>\n  );\n}`,
  'Estrategias generadas por el Marketing Agent',
);

replaceOnce(
  screen,
  `  analyzeButton: { backgroundColor: colors.navy, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },\n  analyzeButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },`,
  `  agentActionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },\n  analyzeButton: { backgroundColor: colors.navy, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },\n  analyzeButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },\n  strategyButton: { backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },\n  strategyButtonText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },`,
  'strategyButton: { backgroundColor: colors.primary',
);

replaceOnce(
  screen,
  `  foundationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },`,
  `  strategyCard: { backgroundColor: '#F8FBFF', borderWidth: 1, borderColor: '#CFE1FA', borderRadius: 14, padding: 16, marginBottom: 18 },\n  strategyHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },\n  strategyHeadline: { color: colors.text, fontSize: 22, fontWeight: '900', marginTop: 5 },\n  validationBadge: { borderRadius: 12, paddingHorizontal: 8, paddingVertical: 5 },\n  validationPassed: { backgroundColor: colors.successLight },\n  validationReview: { backgroundColor: colors.warningLight },\n  validationBadgeText: { color: colors.text, fontSize: 7, fontWeight: '900' },\n  strategyBody: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, marginTop: 14, alignItems: 'flex-start' },\n  strategyHero: { width: 220, height: 220, borderRadius: 12, backgroundColor: '#EAF0F6' },\n  strategyCopy: { flex: 1, minWidth: 240 },\n  strategySubheadline: { color: colors.primaryDark, fontSize: 14, fontWeight: '900', lineHeight: 20 },\n  strategyPrimaryText: { color: colors.text, fontSize: 10, lineHeight: 16, marginTop: 8 },\n  ctaPreview: { alignSelf: 'flex-start', backgroundColor: '#16A34A', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, marginTop: 12 },\n  ctaPreviewText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900' },\n  strategyMetaLabel: { color: colors.muted, fontSize: 7, fontWeight: '900', letterSpacing: 0.7, marginTop: 12 },\n  strategyMetaText: { color: colors.text, fontSize: 9, lineHeight: 14, marginTop: 3 },\n  strategyDetails: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, borderTopWidth: 1, borderTopColor: '#DCE8F5', marginTop: 14, paddingTop: 12 },\n  strategyDetailColumn: { flex: 1, minWidth: 240 },\n  strategyBullet: { color: colors.muted, fontSize: 8, lineHeight: 13, marginTop: 4 },\n  foundationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 2 },`,
  'strategyCard: { backgroundColor:',
);

console.log('Marketing Campaign Strategy V21 UI applied.');
