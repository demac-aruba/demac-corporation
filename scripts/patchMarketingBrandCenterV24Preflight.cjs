const fs = require('fs');

// MARKETING_BRAND_CENTER_V24_PREFLIGHT
// Normalizes the legacy placeholder style so V24 can inject its editor styles
// deterministically. BrandFoundation is replaced by V24, so this old style is
// retained only as a safe patch anchor.

const path = 'src/screens/MarketingScreen.tsx';
let text = fs.readFileSync(path, 'utf8');
const expected = "  brandRules: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: 'hidden' },";
const legacy = "  brandRules: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border, borderRadius: 14, padding: 4, marginTop: 2 },";
if (!text.includes(expected) && text.includes(legacy)) {
  text = text.replace(legacy, expected);
  fs.writeFileSync(path, text);
}
console.log('Marketing Brand Center V24 style anchor normalized.');
