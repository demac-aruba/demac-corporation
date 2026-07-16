from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
source = path.read_text()
old = "  return (\n  return (\n"
if old not in source:
    raise RuntimeError('Duplicate return marker was not found.')
path.write_text(source.replace(old, "  return (\n", 1))
print('Duplicate agenda return removed.')
