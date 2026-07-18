const fs = require('fs');
const path = 'src/services/firebase.ts';
let text = fs.readFileSync(path, 'utf8');
const marker = 'export async function deleteFirestoreDocument(collectionPath: string, documentId: string): Promise<void> {\n';
if (!text.includes(marker)) throw new Error('firebase delete marker not found');
const addition = `export async function updateFirestoreDocument(\n  collectionPath: string,\n  documentId: string,\n  changes: Record<string, unknown>,\n): Promise<void> {\n  const session = await requireFirebaseSession();\n  const fields = encodeFirestoreFields(changes);\n  const fieldPaths = Object.keys(fields);\n  if (!fieldPaths.length) return;\n\n  const updateMask = fieldPaths\n    .map((fieldPath) => \`updateMask.fieldPaths=\${encodeURIComponent(fieldPath)}\`)\n    .join('&');\n  const response = await fetch(\n    \`\${getFirestoreBaseUrl()}/\${collectionPath}/\${encodeURIComponent(documentId)}?\${updateMask}\`,\n    {\n      method: 'PATCH',\n      headers: {\n        Authorization: \`Bearer \${session.idToken}\`,\n        'Content-Type': 'application/json',\n      },\n      body: JSON.stringify({ fields }),\n    },\n  );\n\n  const payload = await response.json();\n  if (!response.ok) throw new Error(payload?.error?.message ?? \`No se pudo actualizar \${collectionPath}/\${documentId}.\`);\n}\n\n`;
text = text.replace(marker, addition + marker);
fs.writeFileSync(path, text);
