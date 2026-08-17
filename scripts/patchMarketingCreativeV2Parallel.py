from pathlib import Path

path = Path('functions/marketingCreativeBuilderV2.js')
source = path.read_text()

old_signature = "async function renderVariant({ sessionId, creativeId, concept, heroBuffer, exact, hard, core, variantIndex, revisionInstructions = [], suffix = '' }) {"
new_signature = "async function renderVariant({ sessionId, creativeId, concept, heroBuffer, exact, hard, core, variantIndex, revisionInstructions = [], suffix = '', reportProgress = true }) {"
if source.count(old_signature) != 1:
    raise SystemExit(f'renderVariant signature anchor count={source.count(old_signature)}')
source = source.replace(old_signature, new_signature)

replacements = [
    (
        "  await setProgress(sessionId, `render_${concept.id}${suffix}`, progressBase, `Generating ${concept.name}${suffix ? ' revision' : ''} with GPT Image 2…`, { currentVariant: concept.id });",
        "  if (reportProgress) await setProgress(sessionId, `render_${concept.id}${suffix}`, progressBase, `Generating ${concept.name}${suffix ? ' revision' : ''} with GPT Image 2…`, { currentVariant: concept.id });",
    ),
    (
        "  await setProgress(sessionId, `layout_${concept.id}${suffix}`, progressBase + 8, `Applying exact DEMAC typography to ${concept.name}…`, { currentVariant: concept.id });",
        "  if (reportProgress) await setProgress(sessionId, `layout_${concept.id}${suffix}`, progressBase + 8, `Applying exact DEMAC typography to ${concept.name}…`, { currentVariant: concept.id });",
    ),
    (
        "  await setProgress(sessionId, `qa_${concept.id}${suffix}`, progressBase + 13, `Running agency-quality QA on ${concept.name}…`, { currentVariant: concept.id });",
        "  if (reportProgress) await setProgress(sessionId, `qa_${concept.id}${suffix}`, progressBase + 13, `Running agency-quality QA on ${concept.name}…`, { currentVariant: concept.id });",
    ),
]
for old, new in replacements:
    if source.count(old) != 1:
        raise SystemExit(f'progress anchor count={source.count(old)}: {old[:80]}')
    source = source.replace(old, new)

old_loop = """  const variants = [];
  for (let index = 0; index < artDirection.concepts.length; index += 1) {
    variants.push(await renderVariant({ sessionId, creativeId, concept: artDirection.concepts[index], heroBuffer, exact, hard, core, variantIndex: index }));
  }

  await setProgress(sessionId, 'compare', 80, 'Comparing creative quality, agency feel and scroll-stopping power…');"""
new_loop = """  await setProgress(
    sessionId,
    'render_variants_parallel',
    24,
    'Generating three premium GPT Image 2 variants in parallel…',
    { totalVariants: artDirection.concepts.length },
  );
  const variants = await Promise.all(
    artDirection.concepts.map((concept, index) => renderVariant({
      sessionId,
      creativeId,
      concept,
      heroBuffer,
      exact,
      hard,
      core,
      variantIndex: index,
      reportProgress: false,
    })),
  );

  await setProgress(
    sessionId,
    'compare',
    80,
    'Three variants ready. Comparing creative quality, agency feel and scroll-stopping power…',
    { completedVariants: variants.length },
  );"""
if source.count(old_loop) != 1:
    raise SystemExit(f'sequential loop anchor count={source.count(old_loop)}')
source = source.replace(old_loop, new_loop)

if source.count('Promise.all(\n    artDirection.concepts.map') != 1:
    raise SystemExit('parallel variant map assertion failed')
if source.count('reportProgress: false') != 1:
    raise SystemExit('reportProgress assertion failed')

path.write_text(source)
print('Marketing Creative V2 initial variants patched to run in parallel.')
