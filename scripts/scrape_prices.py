"""Holt aktuelle Bierpreise direkt aus den Online-Sortimenten der Ketten.

    python scripts/scrape_prices.py            # alle Ketten
    python scripts/scrape_prices.py spar billa # nur diese

Schreibt pro Kette data/sources/auto-<kette>.json und baut danach
data/chain-prices.json neu (scripts/build_chain_prices.py).
"""
import importlib
import json
import os
import pkgutil
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scrapers  # noqa: E402


def main(names):
    available = [m.name for m in pkgutil.iter_modules(scrapers.__path__) if m.name != 'common']
    todo = names or available
    ok = True
    for name in todo:
        if name not in available:
            print(f'{name}: unbekannt (verfügbar: {", ".join(available)})')
            ok = False
            continue
        try:
            items = importlib.import_module(f'scrapers.{name}').scrape()
        except Exception as e:  # eine kaputte Kette soll die anderen nicht aufhalten
            print(f'{name}: FEHLER {e!r}')
            ok = False
            continue
        if not items:
            print(f'{name}: keine Preise gefunden — alte Datei bleibt erhalten')
            ok = False
            continue
        path = os.path.join(ROOT, 'data', 'sources', f'auto-{name}.json')
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(items, f, ensure_ascii=False, indent=0)
        print(f'{name}: {len(items)} Preise')
    import build_chain_prices
    build_chain_prices.main()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
