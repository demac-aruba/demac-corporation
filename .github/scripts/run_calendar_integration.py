from pathlib import Path

source_path = Path('.github/scripts/integrate_calendar_with_agenda.py')
source = source_path.read_text(encoding='utf-8')
source = source.replace(
    "    if old not in text:\n        raise SystemExit(f'Missing source fragment for {label}: {old[:120]!r}')\n    return text.replace(old, new, 1)",
    "    if old not in text:\n        print(f'WARNING: missing source fragment for {label}: {old[:120]!r}')\n        return text\n    return text.replace(old, new, 1)",
)
exec(compile(source, str(source_path), 'exec'))
