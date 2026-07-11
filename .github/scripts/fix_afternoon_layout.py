from pathlib import Path

# Trigger the one-time layout correction after the workflow is present on the branch.
path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')

replacements = {
    "const LUNCH_GAP = 44;\nconst AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) + LUNCH_GAP;\nconst SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP;":
    "const LUNCH_GAP = 44;\nconst AFTERNOON_START_GAP = 12;\nconst AFTERNOON_HEADER_TOP = GROUP_HEADER_HEIGHT + morningSlots.length * (SLOT_HEIGHT + SLOT_GAP) + LUNCH_GAP;\nconst SCHEDULE_HEIGHT = GROUP_HEADER_HEIGHT * 2 + allSlots.length * SLOT_HEIGHT + (allSlots.length - 1) * SLOT_GAP + LUNCH_GAP + AFTERNOON_START_GAP;",
    "function scheduleSlotTop(index: number) {\n  return GROUP_HEADER_HEIGHT + index * (SLOT_HEIGHT + SLOT_GAP) + (index >= morningSlots.length ? GROUP_HEADER_HEIGHT + LUNCH_GAP : 0);\n}":
    "function scheduleSlotTop(index: number) {\n  const afternoonOffset = index >= morningSlots.length ? GROUP_HEADER_HEIGHT + LUNCH_GAP + AFTERNOON_START_GAP : 0;\n  return GROUP_HEADER_HEIGHT + index * (SLOT_HEIGHT + SLOT_GAP) + afternoonOffset;\n}",
    "return slots * SLOT_HEIGHT + (slots - 1) * SLOT_GAP + (crossesLunch ? GROUP_HEADER_HEIGHT + LUNCH_GAP : 0);":
    "return slots * SLOT_HEIGHT + (slots - 1) * SLOT_GAP + (crossesLunch ? GROUP_HEADER_HEIGHT + LUNCH_GAP + AFTERNOON_START_GAP : 0);",
    "slotTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, alignItems: 'center' },":
    "slotTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 6, alignItems: 'center', minHeight: 18, marginBottom: 2 },",
    "clientName: { color: colors.text, fontWeight: '900', fontSize: 12, marginTop: 7 },":
    "clientName: { color: colors.text, fontWeight: '900', fontSize: 12, lineHeight: 16, minHeight: 16, marginTop: 5 },",
    "mergedAppointment: { position: 'absolute', left: 12, right: 12, borderRadius: 8, borderWidth: 1, borderColor: '#B9D7FF', backgroundColor: colors.infoLight, padding: 10, justifyContent: 'flex-start', zIndex: 3, overflow: 'hidden' },":
    "mergedAppointment: { position: 'absolute', left: 12, right: 12, borderRadius: 8, borderWidth: 1, borderColor: '#B9D7FF', backgroundColor: colors.infoLight, padding: 10, paddingTop: 12, justifyContent: 'flex-start', zIndex: 3, overflow: 'hidden' },"
}

for old, new in replacements.items():
    if old not in text:
        raise SystemExit(f'Expected source fragment not found: {old[:80]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
