from pathlib import Path

path = Path('src/screens/ClientsScreen.tsx')
text = path.read_text(encoding='utf-8')
if text.startswith('\\\n'):
    text = text[2:]
elif text.startswith('\\'):
    text = text[1:]
path.write_text(text, encoding='utf-8')
for filename in ('validation-typecheck.log', 'validation-build.log', 'scripts/retry-pr39.txt'):
    target = Path(filename)
    if target.exists():
        target.unlink()
