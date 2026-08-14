const fs = require('fs');

// MARKETING_CALLABLE_V20
// V20 replaces the unreliable Firestore/Eventarc activation with an explicit
// authenticated callable request while preserving the V1B analysis engine.

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Marketing V20 block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

const service = 'src/services/marketingStorage.ts';
replaceOnce(
  service,
  `export async function requestMarketingAnalysis(sessionId: string) {\n  const now = new Date().toISOString();\n  await updateMarketingUploadSession(sessionId, {\n    analysisStatus: 'queued',\n    analysisRequestedAt: now,\n    analysisError: undefined,\n    updatedAt: now,\n  });\n}`,
  `export async function requestMarketingAnalysis(sessionId: string) {\n  const session = await requireSession();\n  const endpoint = 'https://us-central1-demac-corporation.cloudfunctions.net/requestMarketingImageAnalysis';\n  const response = await fetch(endpoint, {\n    method: 'POST',\n    headers: {\n      Authorization: \`Bearer \${session.idToken}\`,\n      'Content-Type': 'application/json',\n    },\n    body: JSON.stringify({ data: { sessionId } }),\n  });\n  const responseText = await response.text();\n  let payload: { data?: Record<string, unknown>; result?: Record<string, unknown>; error?: { message?: string; status?: string } } = {};\n  try { payload = responseText ? JSON.parse(responseText) : {}; } catch { /* handled below */ }\n  if (!response.ok || payload.error) {\n    const message = payload.error?.message || responseText.trim() || 'No se pudo ejecutar el análisis visual.';\n    throw new Error(\`\${message} (Marketing Agent \${response.status})\`);\n  }\n  return payload.data ?? payload.result ?? {};\n}`,
  "cloudfunctions.net/requestMarketingImageAnalysis",
);

const screen = 'src/screens/MarketingScreen.tsx';
replaceOnce(
  screen,
  "      Alert.alert('Marketing Agent', 'El análisis visual comenzó. Los resultados y el ranking aparecerán automáticamente en esta sesión.');",
  "      Alert.alert('Marketing Agent', 'Análisis visual completado. El ranking y las recomendaciones ya están disponibles en esta sesión.');",
  "Análisis visual completado. El ranking",
);
replaceOnce(
  screen,
  "<Text style={styles.analyzeButtonText}>{['queued', 'processing'].includes(selectedSession.analysisStatus ?? '') ? '✦ Analyzing photos…' : selectedSession.analysisStatus === 'completed' ? '✦ Re-analyze with Marketing Agent' : '✦ Analyze with Marketing Agent'}</Text>",
  "<Text style={styles.analyzeButtonText}>{analysisSubmitting || ['queued', 'processing'].includes(selectedSession.analysisStatus ?? '') ? '✦ Analyzing photos…' : selectedSession.analysisStatus === 'completed' ? '✦ Re-analyze with Marketing Agent' : '✦ Analyze with Marketing Agent'}</Text>",
  "analysisSubmitting || ['queued', 'processing']",
);

console.log('Marketing callable V20 applied.');
