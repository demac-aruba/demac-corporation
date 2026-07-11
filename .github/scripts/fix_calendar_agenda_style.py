from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')
if 'closedSlotReason:' not in text:
    old = "  unavailableText: { color: colors.danger, fontWeight: '900', fontSize: 12, marginTop: 5 },"
    new = old + "\n  closedSlotReason: { color: colors.muted, fontSize: 9, lineHeight: 12, marginTop: 5, textAlign: 'center' },"
    if old not in text:
        raise SystemExit('Unable to find unavailableText style')
    text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
