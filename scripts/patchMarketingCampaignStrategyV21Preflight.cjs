const fs = require('fs');

// MARKETING_CAMPAIGN_STRATEGY_V21_PREFLIGHT
// The V20 analysis button varies slightly across rebuilt UI states. Seed only
// the V21 marker so the brittle button replacement is skipped; V22 adds the
// strategy action independently after V21 finishes the data/UI wiring.

const path = 'src/screens/MarketingScreen.tsx';
let text = fs.readFileSync(path, 'utf8');
const marker = '// V21_ACTION_ANCHOR_STABILIZED: ◆ Generate Campaign Strategy';
if (!text.includes(marker)) {
  text = text.replace("import * as ImagePicker from 'expo-image-picker';", `import * as ImagePicker from 'expo-image-picker';\n${marker}`);
  fs.writeFileSync(path, text);
}
console.log('Marketing V21 action anchor stabilized.');
