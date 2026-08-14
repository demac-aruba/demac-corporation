const fs = require('fs');

// MARKETING_IMAGE_ANALYSIS_V19
// V19 connects the V18 Media Library to the asynchronous Firebase/OpenAI
// analysis pipeline while keeping the repository's repeated patch passes safe.

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Marketing V19 block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Marketing V19 anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

const screen = 'src/screens/MarketingScreen.tsx';

insertAfter(
  screen,
  '  MarketingUploadSession,',
  '\n  requestMarketingAnalysis,',
  '  requestMarketingAnalysis,',
);

insertAfter(
  screen,
  '  const [loadError, setLoadError] = useState<string>();',
  '\n  const [analysisSubmitting, setAnalysisSubmitting] = useState(false);',
  'const [analysisSubmitting, setAnalysisSubmitting]',
);

insertAfter(
  screen,
  "  const approvedAssets = useMemo(() => assets.filter((asset) => asset.status === 'approved'), [assets]);",
  `\n\n  useEffect(() => {\n    if (!selectedSession || !['queued', 'processing'].includes(selectedSession.analysisStatus ?? '')) return;\n    const timer = setInterval(() => { void refresh(); }, 4000);\n    return () => clearInterval(timer);\n  }, [refresh, selectedSession]);\n\n  const analyzeSelectedSession = useCallback(async () => {\n    if (!selectedSession || !selectedAssets.length || analysisSubmitting) return;\n    setAnalysisSubmitting(true);\n    try {\n      await requestMarketingAnalysis(selectedSession.id);\n      await refresh();\n      Alert.alert('Marketing Agent', 'El análisis visual comenzó. Los resultados y el ranking aparecerán automáticamente en esta sesión.');\n    } catch (error) {\n      Alert.alert('No se pudo iniciar el análisis', error instanceof Error ? error.message : 'Error inesperado.');\n    } finally {\n      setAnalysisSubmitting(false);\n    }\n  }, [analysisSubmitting, refresh, selectedAssets.length, selectedSession]);`,
  'const analyzeSelectedSession = useCallback',
);

replaceOnce(
  screen,
  '<View style={styles.headerBadge}><Text style={styles.headerBadgeText}>MVP FOUNDATION</Text></View>',
  '<View style={styles.headerBadge}><Text style={styles.headerBadgeText}>V1B · VISUAL AI</Text></View>',
  'V1B · VISUAL AI',
);

replaceOnce(
  screen,
  "<Text style={styles.muted}>{selectedSession ? `${selectedAssets.length} imágenes almacenadas · originales preservados` : 'Selecciona una sesión para revisar sus fotos.'}</Text>",
  "<Text style={styles.muted}>{selectedSession ? `${selectedAssets.length} imágenes almacenadas · originales preservados${selectedSession.analysisStatus ? ` · AI ${selectedSession.analysisStatus.toUpperCase()}` : ''}` : 'Selecciona una sesión para revisar sus fotos.'}</Text>",
  "AI ${selectedSession.analysisStatus.toUpperCase()}",
);

replaceOnce(
  screen,
  "                  <Pressable disabled={!selectedAssets.length} style={[styles.analyzeButton, !selectedAssets.length && styles.buttonDisabled]} onPress={() => Alert.alert('Siguiente fase', 'La Media Library ya está preparada. El análisis visual automático se conectará en V1B.') }>\n                    <Text style={styles.analyzeButtonText}>✦ Analyze with Marketing Agent</Text>\n                  </Pressable>",
  "                  <Pressable\n                    disabled={!selectedAssets.length || analysisSubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '')}\n                    style={[styles.analyzeButton, (!selectedAssets.length || analysisSubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '')) && styles.buttonDisabled]}\n                    onPress={() => void analyzeSelectedSession()}\n                  >\n                    <Text style={styles.analyzeButtonText}>{['queued', 'processing'].includes(selectedSession.analysisStatus ?? '') ? '✦ Analyzing photos…' : selectedSession.analysisStatus === 'completed' ? '✦ Re-analyze with Marketing Agent' : '✦ Analyze with Marketing Agent'}</Text>\n                  </Pressable>",
  "selectedSession.analysisStatus === 'completed' ? '✦ Re-analyze",
);

replaceOnce(
  screen,
  "          ['Image analysis + ranking', false],",
  "          ['Image analysis + ranking', true],",
  "['Image analysis + ranking', true]",
);

replaceOnce(
  screen,
  `function AssetCard({ asset }: { asset: MarketingAsset }) {\n  return (\n    <View style={styles.assetCard}>\n      <View style={styles.assetPreview}>\n        <Image source={{ uri: asset.thumbnailUrl || asset.downloadUrl }} style={styles.assetImage} resizeMode="cover" />\n        <View style={styles.assetStatus}><Text style={styles.assetStatusText}>ANALYSIS PENDING</Text></View>\n      </View>\n      <Text style={styles.assetName} numberOfLines={1}>{asset.originalFileName}</Text>\n      <Text style={styles.assetMeta}>{formatBytes(asset.sizeBytes)} · original stored</Text>\n    </View>\n  );\n}`,
  `function AssetCard({ asset }: { asset: MarketingAsset }) {\n  const completed = asset.analysisStatus === 'completed';\n  const statusLabel = asset.analysisStatus === 'processing'\n    ? 'AI ANALYZING'\n    : completed\n      ? asset.doNotUse ? 'DO NOT USE' : asset.rank ? \`#\${asset.rank} · SCORE \${asset.rankingScore ?? asset.marketingSuitabilityScore ?? 0}\` : 'ANALYZED'\n      : asset.analysisStatus === 'failed' ? 'ANALYSIS FAILED' : 'ANALYSIS PENDING';\n  return (\n    <View style={styles.assetCard}>\n      <View style={styles.assetPreview}>\n        <Image source={{ uri: asset.thumbnailUrl || asset.downloadUrl }} style={styles.assetImage} resizeMode="cover" />\n        <View style={styles.assetStatus}><Text style={styles.assetStatusText}>{statusLabel}</Text></View>\n      </View>\n      <Text style={styles.assetName} numberOfLines={1}>{asset.originalFileName}</Text>\n      <Text style={styles.assetMeta}>\n        {completed\n          ? \`Marketing \${asset.marketingSuitabilityScore ?? 0}/100 · Quality \${asset.qualityScore ?? 0}/100 · \${asset.recommendedCampaignType ?? 'other'}\`\n          : \`\${formatBytes(asset.sizeBytes)} · original stored\`}\n      </Text>\n      {asset.analysisSummary ? <Text style={styles.assetMeta} numberOfLines={3}>{asset.analysisSummary}</Text> : null}\n      {asset.containsReadableSensitiveData ? <Text style={styles.errorText}>Privacy check: {asset.sensitiveDataNote || 'Review visible sensitive information before publishing.'}</Text> : null}\n      {asset.doNotUse && asset.rejectionReason ? <Text style={styles.errorText}>{asset.rejectionReason}</Text> : null}\n    </View>\n  );\n}`,
  "const completed = asset.analysisStatus === 'completed';",
);

console.log('Marketing image analysis V19 UI applied.');
