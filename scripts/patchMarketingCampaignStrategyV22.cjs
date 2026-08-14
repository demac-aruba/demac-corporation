const fs = require('fs');

// MARKETING_CAMPAIGN_STRATEGY_V22
// Adds the V1C launch action without depending on the exact V20 analyze-button
// markup. Runs after V21 has wired campaign data, callbacks and styles.

function insertBefore(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Marketing V22 anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${insertion}${anchor}`);
  fs.writeFileSync(path, text);
}

const screen = 'src/screens/MarketingScreen.tsx';
insertBefore(
  screen,
  '              {selectedCampaign ? <CampaignStrategyCard campaign={selectedCampaign} assets={selectedAssets} /> : null}',
  `              {selectedSession?.analysisStatus === 'completed' ? (\n                <View style={styles.strategyLaunchRow}>\n                  <Pressable\n                    disabled={analysisSubmitting || strategySubmitting || selectedSession.campaignStrategyStatus === 'processing'}\n                    style={[styles.strategyButton, (analysisSubmitting || strategySubmitting || selectedSession.campaignStrategyStatus === 'processing') && styles.buttonDisabled]}\n                    onPress={() => void generateSelectedStrategy()}\n                  >\n                    <Text style={styles.strategyButtonText}>{strategySubmitting || selectedSession.campaignStrategyStatus === 'processing' ? '◆ Building campaign…' : selectedCampaign ? '◆ Regenerate Campaign Strategy' : '◆ Generate Campaign Strategy'}</Text>\n                  </Pressable>\n                </View>\n              ) : null}\n`,
  'style={styles.strategyLaunchRow}',
);

const text = fs.readFileSync(screen, 'utf8');
if (!text.includes('strategyLaunchRow:')) {
  const anchor = "  strategyButton: { backgroundColor: colors.primary, borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 },";
  if (!text.includes(anchor)) throw new Error('Marketing V22 strategyButton style anchor not found.');
  fs.writeFileSync(screen, text.replace(anchor, `  strategyLaunchRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 14 },\n${anchor}`));
}

console.log('Marketing Campaign Strategy V22 launch action applied.');
