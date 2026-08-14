const fs = require('fs');

// MARKETING_V1C_REPEAT_BUILD_PREFLIGHT
// `typecheck` and `build:web` each run patch:all. Once V21 upgrades the badge
// from V1B to V1C, V19's header replacement marker no longer exists on the
// second pass. Preserve a harmless V1B marker comment only for repeat builds.

const path = 'src/screens/MarketingScreen.tsx';
let text = fs.readFileSync(path, 'utf8');
if (text.includes('V1C · CAMPAIGN AI') && !text.includes('// REPEAT_BUILD_MARKER: V1B · VISUAL AI')) {
  const anchor = "import * as ImagePicker from 'expo-image-picker';";
  if (!text.includes(anchor)) throw new Error('Marketing repeat-build preflight import anchor not found.');
  text = text.replace(anchor, `${anchor}\n// REPEAT_BUILD_MARKER: V1B · VISUAL AI`);
  fs.writeFileSync(path, text);
}
console.log('Marketing V1C repeat-build preflight checked.');
