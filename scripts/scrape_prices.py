"""Holt aktuelle Bierpreise direkt aus den Online-Sortimenten der Ketten.

    python scripts/scrape_prices.py            # alle Ketten
    python scripts/scrape_prices.py spar billa # nur diese

Schreibt pro Kette data/sources/auto-<kette>.json und baut danach
data/chain-prices.json neu (scripts/build_chain_prices.py).

Gesundheit: Liefert eine Kette nichts oder weniger als die Hälfte der letzten
Woche, bleiben die alten Daten stehen und es gibt eine Warnung (im GitHub-Job
als gelbe Meldung). Am Ende steht ein Bericht pro Kette mit Änderung zur Vorwoche.
"""
import importlib
import json
import os
import pkgutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scrapers  # noqa: E402

DROP = 0.5   # unter diesem Anteil der Vorwoche gilt eine Kette als eingebrochen
MIN_OLD = 10  # bei sehr kleinen Ketten schwankt die Zahl normal stark


def verdict(old, new):
    """→ (Daten übernehmen?, Status). old/new = Anzahl Preise vorher/jetzt; new None = Fehler."""
    if new is None:
        return False, 'Fehler, alte Daten bleiben'
    if new == 0:
        return False, 'nichts gefunden, alte Daten bleiben'
    if old >= MIN_OLD and new < old * DROP:
        return False, f'eingebrochen ({new} statt {old}), alte Daten bleiben'
    return True, 'ok'


def warn(msg):
    # GitHub zeigt "::warning::" als gelbe Meldung im Lauf; lokal ist es eine normale Zeile.
    print(f'::warning::{msg}' if os.environ.get('GITHUB_ACTIONS') else f'WARNUNG: {msg}')


def main(names):
    available = [m.name for m in pkgutil.iter_modules(scrapers.__path__) if m.name != 'common']
    todo = names or available
    ok = True
    rows = []
    for name in todo:
        if name not in available:
            print(f'{name}: unbekannt (verfügbar: {", ".join(available)})')
            ok = False
            continue
        path = os.path.join(ROOT, 'data', 'sources', f'auto-{name}.json')
        try:
            with open(path, encoding='utf-8') as f:
                old = len(json.load(f))
        except (OSError, ValueError):
            old = 0
        try:
            items = importlib.import_module(f'scrapers.{name}').scrape() or []
        except Exception as e:  # eine kaputte Kette soll die anderen nicht aufhalten
            print(f'{name}: FEHLER {e!r}')
            items = None
        take, status = verdict(old, None if items is None else len(items))
        if take:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(items, f, ensure_ascii=False, indent=0)
        else:
            warn(f'{name}: {status}')
            ok = False
        rows.append((name, old, None if items is None else len(items), status))

    report = ['| Kette | Vorher | Jetzt | Änderung | Status |', '|---|---:|---:|---:|---|']
    for name, old, new, status in rows:
        diff = '' if new is None else f'{new - old:+d}'
        report.append(f'| {name} | {old} | {"–" if new is None else new} | {diff} | {status} |')
    print('\n'.join(report))
    summary = os.environ.get('GITHUB_STEP_SUMMARY')
    if summary:
        with open(summary, 'a', encoding='utf-8') as f:
            f.write('### Bierpreise\n\n' + '\n'.join(report) + '\n')

    import build_chain_prices
    build_chain_prices.main()
    return 0 if ok else 1


if __name__ == '__main__':
    assert verdict(100, 60)[0] and not verdict(100, 40)[0] and verdict(5, 1)[0], 'Selbsttest verdict'
    assert not verdict(100, 0)[0] and not verdict(0, None)[0] and verdict(0, 7)[0], 'Selbsttest verdict'
    sys.exit(main(sys.argv[1:]))
