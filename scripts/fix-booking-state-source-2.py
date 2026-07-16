from pathlib import Path

path = Path('src/screens/AgendaScreen.tsx')
source = path.read_text()
old = "  const openQuickClient = () => {  const openQuickClient = () => {"
if old not in source:
    raise RuntimeError('Duplicated openQuickClient declaration was not found.')
path.write_text(source.replace(old, "  const openQuickClient = () => {", 1))
print('Duplicated openQuickClient declaration removed.')
