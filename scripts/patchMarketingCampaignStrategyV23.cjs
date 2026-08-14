const fs = require('fs');

// MARKETING_CAMPAIGN_STRATEGY_V23
// V21's original insertion can land CampaignStrategyCard inside AgentHome because
// insertAfter appends after the function signature. V23 provides an explicit
// top-level card and repoints all campaign-card render sites to it.

const path = 'src/screens/MarketingScreen.tsx';
let text = fs.readFileSync(path, 'utf8');

text = text.replace(/<CampaignStrategyCard\b/g, '<MarketingCampaignStrategyCard');

if (!text.includes('function MarketingCampaignStrategyCard(')) {
  const anchor = 'function AgentHome({ sessions, assets }: { sessions: MarketingUploadSession[]; assets: MarketingAsset[] }) {';
  if (!text.includes(anchor)) throw new Error('Marketing V23 AgentHome anchor not found.');
  const component = `function MarketingCampaignStrategyCard({ campaign, assets }: { campaign: MarketingCampaign; assets: MarketingAsset[] }) {\n  const hero = assets.find((asset) => asset.id === campaign.heroAssetId);\n  const validationPassed = campaign.papiamentoValidationStatus === 'passed';\n  return (\n    <View style={styles.strategyCard}>\n      <View style={styles.strategyHeader}>\n        <View>\n          <Text style={styles.foundationCardTag}>CAMPAIGN STRATEGY · {campaignLabels[campaign.campaignType].toUpperCase()}</Text>\n          <Text style={styles.strategyHeadline}>{campaign.copy.headline}</Text>\n        </View>\n        <View style={[styles.validationBadge, validationPassed ? styles.validationPassed : styles.validationReview]}>\n          <Text style={styles.validationBadgeText}>{validationPassed ? 'PAPIAMENTO PASS' : 'LANGUAGE REVIEW'}</Text>\n        </View>\n      </View>\n      <View style={styles.strategyBody}>\n        {hero ? <Image source={{ uri: hero.thumbnailUrl || hero.downloadUrl }} style={styles.strategyHero} resizeMode=\"cover\" /> : null}\n        <View style={styles.strategyCopy}>\n          <Text style={styles.strategySubheadline}>{campaign.copy.subheadline}</Text>\n          <Text style={styles.strategyPrimaryText}>{campaign.copy.primaryText}</Text>\n          <View style={styles.ctaPreview}><Text style={styles.ctaPreviewText}>{campaign.copy.cta}</Text></View>\n          <Text style={styles.strategyMetaLabel}>OBJECTIVE</Text>\n          <Text style={styles.strategyMetaText}>{campaign.objective}</Text>\n          <Text style={styles.strategyMetaLabel}>ANGLE</Text>\n          <Text style={styles.strategyMetaText}>{campaign.angle}</Text>\n        </View>\n      </View>\n      <View style={styles.strategyDetails}>\n        <View style={styles.strategyDetailColumn}>\n          <Text style={styles.strategyMetaLabel}>VISUAL DIRECTION</Text>\n          <Text style={styles.strategyMetaText}>{campaign.visualDirection.heroTreatment}</Text>\n          {campaign.visualDirection.hierarchy.map((item, index) => (\n            <Text key={\`strategy-hierarchy-\${index}\`} style={styles.strategyBullet}>• {item}</Text>\n          ))}\n        </View>\n        <View style={styles.strategyDetailColumn}>\n          <Text style={styles.strategyMetaLabel}>FACT GUARDRAILS</Text>\n          <Text style={styles.strategyMetaText}>{campaign.factPolicy.priceOrPromoIncluded ? 'Approved commercial offer included.' : 'No price or promotion added unless approved in Brand Center.'}</Text>\n          {campaign.factPolicy.factNotes.map((item, index) => (\n            <Text key={\`strategy-fact-\${index}\`} style={styles.strategyBullet}>• {item}</Text>\n          ))}\n          {campaign.papiamentoUnknownWords.length ? <Text style={styles.errorText}>Review words: {campaign.papiamentoUnknownWords.join(', ')}</Text> : null}\n        </View>\n      </View>\n    </View>\n  );\n}\n\n`;
  text = text.replace(anchor, `${component}${anchor}`);
}

fs.writeFileSync(path, text);
console.log('Marketing Campaign Strategy V23 component scope fixed.');
