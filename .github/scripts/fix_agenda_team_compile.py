from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
text = path.read_text(encoding='utf-8')
old = "const [vanId, setVanId] = useState(vans[0]?.id ?? '');"
new = "const [vanId, setVanId] = useState(teamVans[0]?.id ?? legacyVans[0]?.id ?? '');"
if old not in text:
    raise SystemExit('Agenda van initialization fragment not found')
path.write_text(text.replace(old, new, 1), encoding='utf-8')
