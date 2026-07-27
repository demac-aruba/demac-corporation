const fs = require('fs');

function replaceOnce(path, oldText, newText, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(oldText)) throw new Error(`Required report output patch block not found in ${path}: ${marker}`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

function insertAfter(path, anchor, insertion, marker) {
  let text = fs.readFileSync(path, 'utf8');
  if (text.includes(marker)) return;
  if (!text.includes(anchor)) throw new Error(`Required report output patch anchor not found in ${path}: ${marker}`);
  text = text.replace(anchor, `${anchor}${insertion}`);
  fs.writeFileSync(path, text);
}

replaceOnce(
  'src/types.ts',
  "  sizeBytes: number;\n  note?: string;",
  "  sizeBytes: number;\n  thumbnailStoragePath?: string;\n  thumbnailUrl?: string;\n  thumbnailContentType?: string;\n  thumbnailSizeBytes?: number;\n  note?: string;",
  'thumbnailStoragePath?: string;',
);

insertAfter(
  'src/state/AppState.tsx',
  "  addWorkOrderEvidence: (evidence: WorkOrderEvidence) => Promise<OperationResult>;",
  "\n  updateWorkOrderEvidence: (id: string, changes: Partial<WorkOrderEvidence>) => Promise<OperationResult>;",
  'updateWorkOrderEvidence: (id: string',
);

insertAfter(
  'src/state/AppState.tsx',
  "  const addWorkOrderEvidence = async (evidence: WorkOrderEvidence): Promise<OperationResult> => {\n    if (currentUser?.authProvider !== 'firebase') {\n      setWorkOrderEvidence((previous) => [evidence, ...previous.filter((item) => item.id !== evidence.id)]);\n      return { ok: true };\n    }\n    try {\n      await saveFirestoreDocument('workOrderEvidence', evidence);\n      setWorkOrderEvidence((previous) => [evidence, ...previous.filter((item) => item.id !== evidence.id)]);\n      setDataError(null);\n      setLastSyncedAt(new Date().toISOString());\n      return { ok: true };\n    } catch (error) {\n      const message = friendlyDataError(error);\n      setDataError(message);\n      return { ok: false, message };\n    }\n  };",
  "\n\n  const updateWorkOrderEvidence = async (id: string, changes: Partial<WorkOrderEvidence>): Promise<OperationResult> => {\n    const existing = workOrderEvidence.find((item) => item.id === id);\n    if (!existing) return { ok: false, message: 'La evidencia fotográfica ya no existe.' };\n    const patch = { ...changes, updatedAt: changes.updatedAt ?? new Date().toISOString() };\n    const updated = { ...existing, ...patch };\n    if (currentUser?.authProvider !== 'firebase') {\n      setWorkOrderEvidence((previous) => previous.map((item) => item.id === id ? updated : item));\n      return { ok: true };\n    }\n    try {\n      await updateFirestoreDocument('workOrderEvidence', id, patch as Record<string, unknown>);\n      setWorkOrderEvidence((previous) => previous.map((item) => item.id === id ? updated : item));\n      setDataError(null);\n      setLastSyncedAt(new Date().toISOString());\n      return { ok: true };\n    } catch (error) {\n      const message = friendlyDataError(error);\n      setDataError(message);\n      return { ok: false, message };\n    }\n  };",
  'const updateWorkOrderEvidence = async',
);

insertAfter(
  'src/state/AppState.tsx',
  "    addWorkOrderEvidence,",
  "\n    updateWorkOrderEvidence,",
  '    updateWorkOrderEvidence,',
);

const shellFile = 'src/components/AppShell.tsx';
replaceOnce(
  shellFile,
  "  const [activeScreen, setActiveScreen] = useState<ScreenKey>(defaultScreen);",
  "  const requestedScreen = useMemo(() => {\n    if (typeof window === 'undefined') return undefined;\n    const value = new URLSearchParams(window.location.search).get('screen') as ScreenKey | null;\n    return value && availableItems.some((item) => item.key === value) ? value : undefined;\n  }, [availableItems]);\n  const [activeScreen, setActiveScreen] = useState<ScreenKey>(requestedScreen ?? defaultScreen);",
  'const requestedScreen = useMemo',
);

const reviewFile = 'src/screens/OfficeReportReviewScreen.tsx';
let reviewText = fs.readFileSync(reviewFile, 'utf8');
reviewText = reviewText.replace(
  "fieldValue: { color: colors.text, lineHeight: 18, whiteSpace: 'pre-wrap' as any },",
  "fieldValue: { color: colors.text, lineHeight: 18 },",
);
fs.writeFileSync(reviewFile, reviewText);

console.log('Report PDF, routing and thumbnail state patches applied.');
